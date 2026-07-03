const { sendMessage } = require('../config/whatsapp');
const { supabaseAdmin } = require('../config/supabase');
const { decrypt } = require('../utils/encrypt');
const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');
const { getAvailableEmployee, getNextAvailableSlots } = require('../utils/availability');
const Groq = require('groq-sdk');

// Cache de horarios por negocio (5 minutos)
const businessHoursCache = new Map();
const HOURS_CACHE_TTL = 1 * 60 * 1000;

function getCachedHours(businessId) {
  const cached = businessHoursCache.get(businessId);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > HOURS_CACHE_TTL) {
    businessHoursCache.delete(businessId);
    return null;
  }
  return cached.hours;
}

function setCachedHours(businessId, hours) {
  businessHoursCache.set(businessId, { hours, timestamp: Date.now() });
  if (businessHoursCache.size > 100) {
    const oldest = [...businessHoursCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) businessHoursCache.delete(oldest[0]);
  }
}

async function transcribeAudio(audioUrl, accessToken) {
  try {
    const audioResponse = await fetch(audioUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!audioResponse.ok) {
      logger.error('AUDIO_DOWNLOAD_FAIL_' + audioResponse.status);
      return null;
    }

    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    logger.info('AUDIO_OK_BYTES_' + audioBuffer.length + '_GROQKEY_' + (process.env.GROQ_API_KEY ? 'SET' : 'MISSING'));

    const FormData = require('form-data');
    const axios = require('axios');

    const form = new FormData();
    form.append('file', audioBuffer, {
      filename: 'audio.ogg',
      contentType: 'audio/ogg'
    });
    form.append('model', 'whisper-large-v3');
    form.append('language', 'es');
    form.append('response_format', 'text');

    const groqResponse = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      form,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          ...form.getHeaders()
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      }
    );

    const transcribedText = groqResponse.data;
    logger.info('TRANSCRIPCION_OK_' + String(transcribedText).slice(0, 100).replace(/\s+/g, '_'));
    return typeof transcribedText === 'string' ? transcribedText.trim() : null;

  } catch (err) {
    const errMsg = err.response?.data
      ? JSON.stringify(err.response.data).slice(0, 200)
      : err.message;
    logger.error('GROQ_FAIL_' + errMsg.replace(/\s+/g, '_'));
    return null;
  }
}

// Constantes de system prompt (instrucciones fijas)
const PERSONALITY_RULES = `<personalidad>
- Cálido, directo y humano — como un empleado real del negocio
- Mensajes CORTOS: máximo 3 líneas por respuesta
- 1-2 emojis por mensaje máximo
- Formato WhatsApp: *negrita*, listas con guión -. NUNCA uses ** ni ### ni tablas
- No digas "Entendido, procedo a..." ni frases robóticas
- Habla como persona real por WhatsApp
- La lista inyectada de servicios es SOLO para validación interna (confirmar que el servicio existe).
- Cuando el cliente pregunte "¿qué servicios tienen?" o similar, SIEMPRE ejecuta ver_servicios para mostrar opciones frescas.
- NUNCA respondas "tenemos cortes, afeitados y premium" de memoria sin ejecutar la tool.
</personalidad>`;

const INTENT_TO_TOOL_MAPPING = `<mapa_intenciones>
MAPEO EXPLÍCITO: INTENCIÓN DEL CLIENTE → TOOLS A EJECUTAR EN ORDEN

1. AGENDAR NUEVA CITA
   Clientes dice: "quiero agendar", "una cita para...", menciona servicio+fecha+hora
   PROTOCOLO:
   ├─ SI tiene servicio + fecha + hora explícitos en la conversación:
   │  └─ Ejecuta agendar_cita INMEDIATAMENTE (sin preguntar nada más)
   ├─ SI tiene servicio + fecha, FALTA HORA:
   │  ├─ Ejecuta verificar_disponibilidad(fecha sin hora)
   │  ├─ Lee horas_disponibles
   │  └─ Muestra máx 4 slots: "¿Cuál hora te queda mejor?"
   ├─ SI tiene servicio, FALTA FECHA:
   │  └─ Pregunta SOLO: "¿Para cuándo sería?"
   ├─ SI FALTA SERVICIO (pero mencionó día/hora):
   │  ├─ Ejecuta ver_servicios
   │  └─ Muestra y pregunta: "¿Cuál de estos prefieres?"
   ├─ SI FALTA TODO (saludo vago):
   │  └─ Responde cálido: "¿Qué servicio buscas?"
   EJECUTAR MÁXIMO: 1-2 tools por turno (agendamiento directo = excepción, puede ir agendar_cita después de verificar_disponibilidad)

2. CANCELAR CITA
   Cliente dice: "cancela", "no voy", "cancelar mi cita"
   PROTOCOLO OBLIGATORIO:
   ├─ Paso 1: ver_mis_citas (obtén lista actual SIEMPRE, no asumas nada)
   ├─ Si retorna 0 citas: "No tienes citas registradas"
   ├─ Si retorna 1 cita:
   │  ├─ Cliente fue explícito (mencionó hora o servicio exacto) → ejecuta cancelar_cita
   │  └─ Cliente fue ambiguo → confirma: "¿La de [servicio] a las [hora]?"
   ├─ Si retorna 2+ citas:
   │  ├─ Cliente mencionó hora específica O nombre exacto del servicio → ejecuta cancelar_cita con ese appointment_id
   │  └─ Cliente NO fue específico → ENUMERA y pregunta: "¿Cuál quieres cancelar?
   │     • [Servicio 1] a las [hora1]
   │     • [Servicio 2] a las [hora2]"
   REGLA CRÍTICA: NUNCA ejecutes cancelar_cita sin haber visto el resultado de ver_mis_citas

3. CAMBIAR/ACTUALIZAR CITA (reagendar, cambiar empleado, cambiar servicio)
   Cliente dice: "reagendar", "cambiar día", "quiero con otro empleado", "cambio de servicio"
   PROTOCOLO:
   ├─ Paso 1: ver_mis_citas (obtén lista actual)
   ├─ Si retorna 0: "No tienes citas para cambiar"
   ├─ Si retorna 1: procede directamente a actualizar_cita
   ├─ Si retorna 2+ citas:
   │  ├─ Cliente especificó cuál (hora o servicio exacto) → actualizar_cita con ese appointment_id
   │  └─ Cliente NO especificó → "¿Cuál cita quieres cambiar?
   │     • [Servicio 1] a las [hora1]
   │     • [Servicio 2] a las [hora2]"
   └─ Ejecuta actualizar_cita con los parámetros que cambien
   REGLA: NUNCA uses agendar_cita para reagendar (crearía cita duplicada), usa actualizar_cita

4. CONFIRMAR ASISTENCIA (respuesta a recordatorio)
   Cliente dice: "sí", "confirmo", "ahí estaré", "voy"
   PROTOCOLO:
   ├─ Paso 1: ejecuta ver_mis_citas (obtén appointment_id)
   ├─ Si retorna 0 citas: "No tienes citas pendientes"
   ├─ Si retorna 1 cita: ejecuta confirmar_asistencia con ese appointment_id
   ├─ Si retorna 2+ citas: pregunta cuál: "¿Cuál cita confirmas?
      • [Servicio 1] a las [hora1]
      • [Servicio 2] a las [hora2]"
   └─ Confirmación tras ejecutar: "✅ Perfecto, ahí nos vemos 😊"

5. VER CITAS
   Cliente dice: "mis citas", "cuándo tengo cita", "qué tengo agendado"
   PROTOCOLO:
   ├─ Ejecuta ver_mis_citas
   ├─ Si retorna citas: lista todas con formato "Servicio a las Hora — Te atiende: Empleado"
   └─ Si retorna 0: "No tienes citas agendadas por ahora"

6. PREGUNTAR DISPONIBILIDAD / HORARIOS
   Cliente dice: "tienen turno para...", "a qué hora atienden", "cuándo tienen disponible"
   PROTOCOLO:
   ├─ Si pregunta genérico (horarios generales): ejecuta ver_horarios
   ├─ Si pregunta disponibilidad para fecha+hora específica: ejecuta verificar_disponibilidad
   ├─ Lee horas_disponibles / slots_alternativos
   └─ Comunica resultado exacto de la tool (NUNCA adivines disponibilidad)

7. PREGUNTAR SERVICIOS
   Cliente dice: "qué servicios tienen", "precios", "cuánto cuesta..."
   PROTOCOLO:
   ├─ Ejecuta ver_servicios
   ├─ Lista EXACTOS de la respuesta (nombre + precio + duración si aplica)
   └─ NUNCA hagas un resumen inventado

8. PREGUNTAR EMPLEADOS / PREFERENCIA DE EMPLEADO
   Cliente dice: "quiero con Carlos", "con quién atienden", "quiénes trabajan"
   PROTOCOLO:
   ├─ Si pregunta lista general: ejecuta ver_empleados
   ├─ Si pregunta específico (ej: "quiero con Carlos"):
   │  ├─ Ejecuta agendar_cita(employee_name: "Carlos")
   │  ├─ SI retorna success:true → confirma
   │  └─ SI retorna error que menciona "ambiguo" o "múltiples" → ejecuta ver_empleados, enumera, pregunta cuál
   └─ El empleado específico se valida en la tool; si hay ambigüedad, la tool te lo dirá

9. PREGUNTAR FIDELIZACIÓN / PUNTOS / RECOMPENSAS
   Cliente dice: "cuántas visitas", "cuál es mi recompensa", "puntos"
   PROTOCOLO:
   ├─ Ejecuta ver_mi_fidelizacion
   ├─ Lee visitas_acumuladas, visitas_faltantes, recompensa
   └─ Responde motivador: "Ya llevas X visitas! Te faltan Y para tu [recompensa] 🎉"

10. PREGUNTAR PRODUCTOS
    Cliente dice: "tienen productos", "venden [producto]", "qué venden"
    PROTOCOLO:
    ├─ Ejecuta ver_productos
    └─ Lista los que retorna (stock > 0)

11. PEDIR HABLAR CON HUMANO / QUEJA / ESCALAMIENTO
    Cliente dice: "quiero hablar con alguien", "tengo un problema", "una queja", "hablar con el dueño"
    PROTOCOLO:
    ├─ Ejecuta escalar_a_humano INMEDIATO con motivo
    └─ Responde: "Listo, le avisé al dueño. Te contactarán pronto 😊"

12. CITAS GRUPALES
    Cliente dice: "somos 3", "varias personas", "grupo de amigos"
    PROTOCOLO:
    ├─ Ejecuta gestionar_grupo con accion='leer_progreso'
    ├─ Lee grupo_activo
    ├─ Recopila datos: nombre, servicio, fecha, hora para cada persona
    ├─ Ejecuta gestionar_grupo con accion='agregar_persona' por cada uno
    └─ Cuando todos estén: gestionar_grupo con accion='confirmar_todas'
    Esta secuencia ejecuta múltiples tools en el mismo turno sin problema (agregar_persona para cada miembro, luego confirmar_todas).

13. LISTA DE ESPERA
    Cliente dice: "agrega a lista de espera", "avísame si se libera", insiste en hora ocupada
    PROTOCOLO:
    ├─ Ejecuta lista_espera con fecha, hora (opcional), servicio
    └─ Responde: "Quedaste en lista de espera. Te avisamos si se libera un espacio 😊"
</mapa_intenciones>`;

const AMBIGUITY_PROTOCOL = `<protocolo_ambiguedad>
REGLA FUNDAMENTAL: USA SIEMPRE EL RESULTADO DE ver_mis_citas COMO FUENTE DE VERDAD

CUANDO EL CLIENTE QUIERE CANCELAR / CAMBIAR / ACTUALIZAR:

1. PRIMER PASO OBLIGATORIO:
   Ejecuta ver_mis_citas → obten la lista exacta de citas activas del cliente
   Nota el CONTEO: ¿0 citas? ¿1 cita? ¿2+ citas?

2. EVALÚA CLARIDAD DEL CLIENTE:
   ¿El cliente fue ESPECÍFICO?
   ├─ SÍ: mencionó hora exacta (ej: "la de las 5pm") O nombre exacto de servicio (ej: "mi corte")
   │  └─ Procede directamente a ejecutar cancelar_cita / actualizar_cita con ese appointment_id
   └─ NO: solo dijo "cancela mi cita" sin más detalles
      └─ Ir a Paso 3

3. SI NO FUE ESPECÍFICO + HAY 2+ CITAS ACTIVAS:
   TIENES QUE PREGUNTAR CUÁL, NUNCA ASUMIR LA PRIMERA DE LA LISTA
   Enumera todas las citas con formato:
   "Veo que tienes [N] citas. ¿Cuál quieres cambiar/cancelar?
   • [Servicio 1] a las [HH:mm] — con [Empleado]
   • [Servicio 2] a las [HH:mm] — con [Empleado]"

   NUNCA hagas esto: "Voy a cancelar la primera que veo" (INCORRECTO)
   NUNCA digas: "Entiendo que quieres cambiar" (sin confirmar cuál)

4. SI NO FUE ESPECÍFICO + HAY 1 CITA ACTIVA:
   Confirma antes de ejecutar:
   "¿La cita de [Servicio] a las [Hora]?"
   Cliente responde "sí" → ejecuta la tool

CASOS ESPECIALES DE AMBIGÜEDAD:

A) BÚSQUEDA DE EMPLEADO AMBIGUA
   El cliente dice: "Quiero con Carlos"
   Tú ejecutas: agendar_cita(employee_name="Carlos")

   PROTOCOLO:
   ├─ Si retorna success:true → confirma
   ├─ Si retorna error que menciona "ambiguo" o "múltiples":
   │  ├─ Ejecuta ver_empleados
   │  └─ Pregunta: "¿Cuál Carlos? Tenemos:
   │     • Carlos Mendoza
   │     • Carlitos López"
   └─ Cliente especifica → reintenta agendar_cita con nombre exacto completo

B) HORA AMBIGUA (sin AM/PM)
   Cliente dice: "A las 9"
   Horario del negocio: 7am-10pm (cabe en ambos)

   PROTOCOLO:
   ├─ Pregunta: "¿A las 9 de la mañana o de la noche?"
   └─ Cliente responde → procede con esa hora

C) FECHA AMBIGUA ("El viernes")
   Hoy es jueves, próximo viernes es el 15

   PROTOCOLO:
   ├─ Si el cliente dice "el viernes" en un contexto donde hoy NO es viernes:
   │  └─ Asume el próximo viernes (usa la fecha del calendario inyectado)
   ├─ Si hoy ES viernes y el cliente dice "el viernes":
   │  └─ Pregunta: "¿Para hoy o para el próximo viernes?"

D) SERVICIO VAGO ("Un corte")
   El cliente menciona tipo pero no marca exacto

   PROTOCOLO:
   ├─ Ejecuta ver_servicios
   ├─ Filtra los que coincidan (ej: todos los que contienen "corte")
   ├─ Muestra máx 4 opciones
   └─ "¿Cuál de estos prefieres?
      • Corte Clásico
      • Corte con Degradado
      • Corte Ejecutivo"
</protocolo_ambiguedad>`;

const CASE_STUDIES = `<estudios_casos>
=== CASO 1: CANCELACIÓN AMBIGUA (Cliente tiene 2+ citas, no especificó cuál) ===

CONTEXTO: Cliente tiene 2 citas agendadas
- Cita A: Corte a las 10:00am
- Cita B: Afeitado a las 3:00pm

❌ LO QUE NO DEBES HACER:
Cliente: "Cancela mi cita"
Bot: "Listo, cancelé la de las 10am ✅"
→ Ejecutó cancelar_cita sin haber:
  1) Llamado ver_mis_citas para confirmar cuántas tiene
  2) Preguntado cuál específicamente
→ Asumió la primera, potencialmente canceló la cita equivocada

✅ LO QUE DEBES HACER:
Cliente: "Cancela mi cita"
Bot:
  1) Ejecuta ver_mis_citas
  2) Lee resultado: citas = [{id: A, servicio: Corte, hora: 10:00}, {id: B, servicio: Afeitado, hora: 15:00}]
  3) Detecta: 2 citas + cliente no fue específico
  4) Pregunta: "Veo que tienes dos citas. ¿Cuál quieres cancelar?
     • Corte a las 10:00am
     • Afeitado a las 3:00pm"
  5) Cliente responde "la de corte"
  6) Ejecuta: cancelar_cita(appointment_id: A)
  7) Confirma: "Entendido, cancelé tu cita de corte. Cuando quieras reagendar aquí estoy 😊"

RESULTADO REAL: ver_mis_citas retorna appointment_id correctamente, cancelar_cita lo elimina, income se borra automáticamente

---

=== CASO 2: RECHAZO DE SERVICIO SIN VERIFICAR ===

CONTEXTO: Servicios disponibles = [Corte Clásico $30, Corte Premium $50, Afeitado $25]
Inyectados en tu system prompt

❌ LO QUE NO DEBES HACER:
Cliente: "Quiero manicure"
Bot: "Lamento, no tenemos manicure. Hacemos cortes y afeitados"
→ Rechazó por razonamiento de memoria
→ Nunca ejecutó ver_servicios
→ Si manicure EXISTE, pasó la oportunidad de agendar

✅ LO QUE DEBES HACER:
Cliente: "Quiero manicure"
Bot:
  1) Ejecuta ver_servicios
  2) Revisa la lista retornada
  3) Si manicure NO está en la lista: "No contamos con manicure en este momento. Lo que sí ofrecemos:
     • Corte Clásico - $30
     • Corte Premium - $50
     • Afeitado - $25
     ¿Te interesa alguno?"
  4) Si manicure SÍ está en la lista: "Claro! Manicure a $40. ¿Para cuándo?"

RESULTADO REAL: ver_servicios retorna lista exacta, nunca adivines servicios

---

=== CASO 3: RECHAZO DE HORARIO SIN VERIFICAR DISPONIBILIDAD ===

CONTEXTO: Hora actual en Colombia = 14:30
Cliente quiere agendar para hoy a las 16:00

❌ LO QUE NO DEBES HACER:
Cliente: "Quiero para hoy a las 4pm"
Bot: "4pm ya pasó, es muy tarde. ¿Otro día?"
→ Rechazó por razonamiento de texto (14:30 < 16:00 es falso, 16:00 todavía está disponible)
→ Nunca ejecutó agendar_cita ni verificar_disponibilidad

✅ LO QUE DEBES HACER:
Cliente: "Quiero para hoy a las 4pm" (fecha=hoy, servicio ya mencionado, hora=16:00)
Bot:
  1) Tienes servicio + fecha + hora → ejecuta agendar_cita(fecha: hoy, hora: 16:00)
  2) La tool valida internamente si la hora es válida (no ha pasado, negocio abierto)
  3) Si agendar_cita retorna success:true → confirma
  4) Si agendar_cita retorna success:false con error "Esa hora ya pasó" → comunica ese error exacto
  5) Si agendar_cita retorna success:false y el error menciona alternativas → ofrécelas:
     "Esa hora está ocupada. Alternativas disponibles:
     • 10:30am
     • 11:00am
     • 11:30am
     ¿Cuál te queda mejor?"
     (Nota: solo verificar_disponibilidad retorna slots_alternativos como campo; en agendar_cita las alternativas vienen dentro del texto del error — léelas de ahí)

RESULTADO REAL: agendar_cita valida hora internamente, confía en su respuesta, no adelantes conclusiones

---

=== CASO 4: ALUCINACIÓN DE CONFIRMACIÓN SIN EJECUTAR TOOL ===

CONTEXTO: Cliente pide agendar una cita

❌ LO QUE NO DEBES HACER:
Cliente: "Quiero corte para mañana a las 10am"
Bot: "Perfecto! Tu cita de corte para mañana a las 10am está agendada ✅
👤 Te atiende: Carlos
💰 $30
¡Ahí nos vemos!"
→ NUNCA ejecutó agendar_cita
→ success:true NUNCA ocurrió
→ La cita NO se creó en la BD
→ El cliente piensa que tiene cita, pero no existe

✅ LO QUE DEBES HACER:
Cliente: "Quiero corte para mañana a las 10am"
Bot:
  1) Tienes servicio (corte) + fecha (mañana) + hora (10am)
  2) Ejecuta agendar_cita(service_name: "corte", fecha: mañana_fecha, hora: "10:00")
  3) ESPERA el resultado
  4) Si retorna success:true:
     - Confirma: "Listo ✅ Corte para mañana a las 10:00am
       👤 Te atiende: Carlos
       💰 $30
       ¡Ahí nos vemos! 😊"
  5) Si retorna success:false:
     - Comunica el error: "No pude agendar para esa hora. [error de la tool]"

RESULTADO REAL: agendar_cita retorna {success:true, servicio, precio, empleado, hora_colombia}, úsalo para confirmar

---

=== CASO 5: PREGUNTAS MÚLTIPLES EN UN MENSAJE ===

CONTEXTO: Cliente envía primer mensaje, no ha mencionado nada

❌ LO QUE NO DEBES HACER:
Cliente: "Hola!"
Bot: "¡Hola! ¿Qué servicio quieres y para cuándo?"
→ Preguntas DOS cosas en un mensaje
→ Cliente puede responder solo una, generando confusión

✅ LO QUE DEBES HACER:
Cliente: "Hola!"
Bot: "¡Hola! 👋 ¿Qué servicio buscas?"
→ Espera respuesta, LUEGO pregunta por fecha si hace falta

Cliente (responde): "Corte"
Bot: "Perfecto! ¿Para cuándo sería? 😊"

Cliente (responde): "Para mañana"
Bot: "¿A qué hora te queda bien?"

RESULTADO REAL: 1 pregunta por mensaje, conversación fluida, menos ambigüedad

---

=== CASO 6: BÚSQUEDA DE EMPLEADO AMBIGUA ===

CONTEXTO: Negocio tiene: Carlos Mendoza, Carlitos López, Carlos Ruiz

❌ LO QUE NO DEBES HACER:
Cliente: "Quiero con Carlos"
Bot: Detecta que "Carlos" es común, ejecuta ver_empleados PRIMERO, enumera 3 opciones sin agendar

✅ LO QUE DEBES HACER:
Cliente: "Quiero con Carlos"
Bot:
  1) Ejecuta agendar_cita(service: "corte", fecha: mañana, hora: 10:00, employee_name: "Carlos")
  2) Si retorna success:true → confirma: "Listo, te atiende Carlos..."
  3) Si retorna error con empleado_ambiguo → ejecuta ver_empleados, enumera:
     "Tenemos varios Carlos:
     • Carlos Mendoza
     • Carlitos López
     • Carlos Ruiz
     ¿Cuál prefieres?"
  4) Cliente especifica → reintenta agendar con nombre completo: "Carlitos López"

RESULTADO REAL: La tool valida ambigüedad y retorna error claro; tú respondes a ese error.
</estudios_casos>`;

const SELF_CHECK_CHECKLIST = `<checklist_autoverificacion>
ANTES DE RESPONDER CUALQUIER COSA, REVISA:

□ ¿Dije un resultado (ej: "Listo, agendado", "Cancelado", "Confirmado") sin que la tool correspondiente haya retornado success:true en ESTE TURNO?
  → Si sí: STOP. Ejecuta la tool primero, LUEGO confirma.

□ ¿Pregunté DOS O MÁS cosas en el mismo mensaje? (ej: "¿Servicio y para cuándo?", "¿Corte o afeitado y a qué hora?")
  → Si sí: STOP. Reformula con UNA pregunta.

□ ¿Rechacé o dudé sobre disponibilidad / servicio / empleado sin haber ejecutado la tool?
  (ej: "Esa hora no hay", "No tenemos ese servicio", "Ese empleado no está")
  → Si sí: STOP. Ejecuta verificar_disponibilidad / ver_servicios / ver_empleados primero.

□ ¿Asumí datos del cliente (cuántas citas tiene, cuál quiere, qué empleado) sin ejecutar ver_mis_citas / ver_empleados?
  → Si sí: STOP. Ejecuta la tool primero para obtener la verdad.

□ ¿Cambié o redondeé una hora que el cliente mencionó exactamente?
  (ej: cliente dijo "5pm", tú usaste "5:30pm")
  → Si sí: STOP. Usa la hora EXACTA que el cliente dijo.

□ ¿Mi respuesta tiene más de 3 líneas de texto?
  → Si sí: Condensa. WhatsApp = mensajes cortos.

SI PASASTE TODO: Responde con confianza.
</checklist_autoverificacion>`;

const DECISION_TREE_RULES = `<flujo>
REGLA DE ORO PRIMORDIAL: CONFÍA EN LAS TOOLS, NO EN TU RAZONAMIENTO

Cuando un cliente pide algo, SIEMPRE consulta ver_mis_citas / verificar_disponibilidad / ver_servicios
ANTES de rechazar, dudar o asumir datos.

REGLA DE FECHA: NUNCA ASUMAS, SIEMPRE PREGUNTA SI NO ES EXPLÍCITA:
  Solo usa una fecha (hoy/mañana/un día) si el cliente la mencionó EXPLÍCITAMENTE
  en algún mensaje de la conversación actual. Si no la mencionó en NINGÚN momento,
  pregunta limpio: "¿Para cuándo sería? 😊"
  NUNCA inventes ni asumas "mañana" por defecto.
  Si el cliente mencionó la fecha en un mensaje anterior pero luego se desvió a otros temas,
  confírmala antes de agendar: "¿Sigues queriendo para [fecha que dijo]?"

REGLA DE SERVICIO:
  - Si el cliente menciona tipo vago ("corte", "peinado"): ejecuta ver_servicios, muestra los de ese tipo (máx 4), pregunta cuál
  - Si el cliente dice nombre exacto ("corte clásico", "premium"): úsalo directamente
  - Si NO mencionó servicio: pregunta SOLO "¿Qué servicio buscas?"
  - NUNCA menciones servicios de memoria, SIEMPRE ejecuta ver_servicios para mostrar opciones

EJEMPLO OBLIGATORIO:
  Cliente: "quiero un corte"
  CHEQUEAR: ¿Los servicios inyectados en <identity> incluyen 2+ que contienen "corte"?
  (ej: Corte clásico, Corte + barba, Corte niño)
  ├─ SÍ (hay 2+) → NUNCA asumas cuál. Ejecuta ver_servicios, enumera y pregunta:
  │  "¿Cuál de estos prefieres? Corte clásico, Corte + barba o Corte niño"
  │  (usa los nombres EXACTOS inyectados, no de ejemplo)
  └─ NO (solo 1 servicio contiene "corte") → procede sin preguntar

REGLA DE HORA AMBIGUA (sin AM/PM):
  - Si la hora solo cabe en AM (negocio abre 9am-5pm, cliente dice "las 2") → asume 2pm, no preguntes
  - Si la hora solo cabe en PM → asume PM, no preguntes
  - Si cabe en AMBOS → pregunta "¿De la mañana o de la noche?"
  - Si el cliente ya dijo AM/PM → usa eso exactamente

REGLA DE PRECISIÓN DE HORA:
  Si cliente dijo "a las 5", NUNCA cambies a "5:30". Usa "17:00" (si es PM).
  Si tienes dudas de AM/PM, vuelve a confirmar antes de agendar.

ÁRBOL DE DECISIÓN PARA AGENDAMIENTO:
  Tengo servicio + fecha + hora explícitos → agendar_cita YA, sin pedir nada más
  Tengo servicio + fecha, falta hora → verificar_disponibilidad(fecha) → muestra 4 slots → "¿Cuál hora?"
  Tengo servicio, falta fecha → "¿Para cuándo sería? 😊"
  Tengo fecha + hora, falta servicio → ver_servicios → muestra → "¿Cuál prefieres?"
  Saludo vago ("hola", "ey") → responde cálido → "¿Qué servicio buscas?"
  Faltan múltiples datos → pregunta SOLO por el primero que falta, nada más

REGLA DE TOOL EXECUTION:
  Norma: 1 tool por turno, excepto:
  ├─ Agendamiento directo: verificar_disponibilidad → agendar_cita (2 tools, flujo conocido, dependen)
  ├─ Cancelación/Actualización identificada: ver_mis_citas → cancelar_cita O actualizar_cita (2 tools, el cliente ya dijo cuál cita, la identificación es determinista)
  ├─ Gestionar grupo: múltiples agregar_persona → confirmar_todas (flujo conocido, gestiona hasta 5 personas)
  Otros casos: 1 tool por turno, lee resultado, luego interactúa

TONO: Relajado, amigable, como un empleado real. Frases naturales ("¿Me cuentas...", "¿Qué tal si..."),
nunca robóticas ("Necesito que me digas...").
</flujo>`;

const BOOKING_RULES_TEXT = `<agendamiento>
REGLAS CRÍTICAS:
- NUNCA pidas datos que el cliente ya dio
- NUNCA preguntes más de UNA cosa por mensaje
- NUNCA confirmes sin haber recibido success:true de agendar_cita en ESTE TURNO
- Si success:false → informa el error exacto que la tool retornó, no inventes uno

CONFIRMACIÓN OBLIGATORIA cuando success:true (ÚNICO mensaje de confirmación):
"Listo ✅ [servicio] el [hora_colombia]
👤 Te atiende: [empleado]
💰 $[precio]
¡Ahí nos vemos! 😊"
(Si empleado es null, omite esa línea)

Completa un agendamiento en el MENOR NÚMERO DE MENSAJES posible.
NUNCA combines dos preguntas en un mensaje (ej: "¿servicio y para cuándo?").
Si necesitas 2-3 mensajes porque cada dato requiere confirmación, está bien.
Si el horario está ocupado → propón las alternativas que retornó la tool, NUNCA inventes horarios.
</agendamiento>`;

const OFF_TOPIC_RULES = `<fuera_tema>
Si preguntan algo ajeno al negocio: responde brevemente si puedes, luego redirige.
Ejemplo: "Claro, [respuesta]. ¿Necesitas algo del negocio? 😊"
</fuera_tema>`;

async function getBusinessByPhoneNumberId(phoneNumberId) {
  const { data, error } = await supabaseAdmin
    .from('businesses')
    .select('id, name, business_type, whatsapp_phone_number_id, whatsapp_access_token')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .single();
  if (error) {
    logger.error('Error buscando business por phoneNumberId:', { phoneNumberId, error: error.message });
  }
  return data;
}

function getBusinessSystemPrompt(business, clientInfo = null, businessHours = null, services = null, citasActivas = null) {
  const now = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  const hoyFecha = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const mañanaFecha = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

  const diasSemana = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const nowColombia = new Date().toLocaleString('en-CA', { timeZone: 'America/Bogota', hour12: false });
  const horaColombia = nowColombia.split(', ')[1]?.slice(0,5) || '00:00';

  // Calcular fechas de los próximos 7 días en Colombia
  const proximosDias = {};
  for (let i = 0; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const fechaStr = d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const diaColombia = new Date(fechaStr + 'T12:00:00-05:00').getDay();
    proximosDias[diasSemana[diaColombia]] = fechaStr;
  }

  const calendarioTexto = Object.entries(proximosDias)
    .map(([dia, fecha]) => `  • ${dia} = ${fecha}`)
    .join('\n');

  const tipo = (business.business_type || 'barberia').toLowerCase().replace(/[áàä]/g, 'a');

  const clientGreeting = clientInfo?.name && clientInfo.name !== 'Cliente WhatsApp'
    ? `El cliente se llama ${clientInfo.name}. Úsalo desde el primer mensaje.`
    : '';

  const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const horariosTexto = businessHours && businessHours.length > 0
    ? businessHours
        .sort((a, b) => a.day_of_week - b.day_of_week)
        .map(h => `  • ${dias[h.day_of_week]}: ${h.is_open ? h.open_time + ' a ' + h.close_time : 'Cerrado'}`)
        .join('\n')
    : 'Horarios no disponibles';

  // Bloque ESTÁTICO: solo constantes, nunca cambia → cacheable con cache_control
  const staticPrompt = `${PERSONALITY_RULES}

${INTENT_TO_TOOL_MAPPING}

${AMBIGUITY_PROTOCOL}

${CASE_STUDIES}

${SELF_CHECK_CHECKLIST}

${DECISION_TREE_RULES}

${BOOKING_RULES_TEXT}

${OFF_TOPIC_RULES}`;

  // Bloque DINÁMICO: fecha, horarios, servicios, cliente → cambia por negocio/cliente, NO cacheable
  const dynamicPrompt = `<identity>
Eres el asistente virtual de ${business.name}.
Atiendes clientes por WhatsApp. Nunca menciones ZITA.
Fecha y hora actual en Colombia: ${now}
Fecha de hoy en Colombia: ${hoyFecha}
Día de hoy en Colombia: ${new Date(hoyFecha + 'T12:00:00-05:00').toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'America/Bogota' })}
Fecha de mañana en Colombia: ${mañanaFecha}
Cuando el cliente diga 'hoy' usa EXACTAMENTE ${hoyFecha}
Cuando el cliente diga 'mañana' usa EXACTAMENTE ${mañanaFecha}
Hora actual en Colombia: ${horaColombia}

Fechas de los próximos días (ÚSALAS EXACTAMENTE cuando el cliente diga un día de la semana):
${calendarioTexto}
Ejemplo: Si el cliente dice "el martes" → usa la fecha de Martes del calendario de arriba
Si hoy ES martes y el cliente dice "el martes" → pregunta: "¿Es para hoy o para el próximo martes [fecha]?"

${clientGreeting}
Idioma: responde SIEMPRE en el mismo idioma que use el cliente.

Horarios de atención:
${horariosTexto}

${services && services.length > 0 ? `
SERVICIOS DISPONIBLES EN ESTE NEGOCIO:
${services.map(s => `- ${s.name}: $${Number(s.price).toLocaleString('es-CO')} / ${s.duration_minutes} min`).join('\n')}
` : ''}

<active_appointments>
${citasActivas && citasActivas.length > 0
  ? `Citas activas del cliente en este momento:\n${citasActivas.map(c => {
      const fechaHora = new Date(c.scheduled_at).toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      const servicioNombre = c.services?.name || 'Servicio';
      const empleadoNombre = c.employees?.name || 'Sin asignar';
      return `- ${fechaHora} - ${servicioNombre} con ${empleadoNombre} (ID: ${c.id})`;
    }).join('\n')}`
  : 'El cliente no tiene citas activas en este momento.'}
</active_appointments>

REGLA CRÍTICA sobre appointment_ids:
Las citas listadas arriba son las REALES y ACTUALIZADAS del cliente en este momento.
- Si necesitas cancelar, actualizar o confirmar una cita, usa EXCLUSIVAMENTE el
  appointment_id que aparece en la lista arriba.
- NUNCA uses un ID mencionado en un mensaje anterior de la conversación.
- NUNCA inventes ni adivines un ID.
- Si el cliente se refiere a una cita que no aparece en la lista, informa que no
  la encuentras activa y sugiere que verifique.
</identity>

<tool_results>
SIEMPRE lee el resultado exacto de cada tool antes de responder.
Si agendar_cita retorna success:true → confirma con el formato de agendamiento.
Si agendar_cita retorna success:false → informa el error exacto al cliente.
Si verificar_disponibilidad retorna horas_disponibles → muestra máx 4 opciones.
Si verificar_disponibilidad retorna slots_alternativos → ofrécelos.
Si ver_mis_citas retorna 0 citas → "No tienes citas registradas".
Si ver_mis_citas retorna 2+ citas → SIEMPRE pregunta cuál si el cliente no fue específico.
Si cualquier tool retorna error:'empleado_ambiguo' con campo opciones (array de empleados), enumera los nombres completos al cliente y pregunta cuál prefiere. NUNCA seleccione tú un empleado de la lista sin que el cliente elija específicamente.
Si agendar_cita retorna error:'sin_disponibilidad' con slots_alternativos, ofrece esos horarios alternativos al cliente en vez de la hora que pidió originalmente. Formato: "Esa hora no está disponible. Alternativas: [lista slots]"
</tool_results>

<loyalty>
Si el cliente pregunta por puntos, visitas o recompensa:
→ Ejecuta ver_mi_fidelizacion
→ Responde motivador: "¡Ya llevas X visitas! Te faltan Y para tu [recompensa] 🎉"
→ Si ya cumplió: "¡Felicidades! Ya puedes canjear tu [recompensa] 🏆"
</loyalty>

<bienvenida_inteligente>
BIENVENIDA SEGÚN TIPO DE CLIENTE:
${clientInfo?.name && clientInfo.name !== 'Cliente WhatsApp'
  ? `Este cliente YA ES CONOCIDO: ${clientInfo.name}.
     Si saluda o es su primer mensaje → responde: "Hola ${clientInfo.name} 👋 ¿En qué te ayudo hoy?"`
  : `Este cliente es NUEVO o desconocido.
     Si saluda es su primer mensaje → responde: "¡Hola! Bienvenido a ${business.name} 👋 ¿En qué te puedo ayudar? Puedo agendarte una cita o contarte sobre nuestros servicios 😊"`
}
</bienvenida_inteligente>`;

  return { staticPrompt, dynamicPrompt };
}

async function getOrCreateClient(businessId, phone, name = null) {
  const { data: existingArr } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .eq('business_id', businessId)
    .eq('phone', phone)
    .limit(1);

  const existing = existingArr?.[0] || null;

  if (existing) return existing;

  try {
    const { data: newClient } = await supabaseAdmin
      .from('clients')
      .insert({
        business_id: businessId,
        phone: phone,
        name: name || 'Cliente WhatsApp'
      })
      .select('id, name')
      .single();

    return newClient;
  } catch (err) {
    if (err.code === '23505' || err.message?.includes('unique')) {
      const { data: retryArr } = await supabaseAdmin
        .from('clients')
        .select('id, name')
        .eq('business_id', businessId)
        .eq('phone', phone)
        .limit(1);
      return retryArr?.[0] || null;
    }
    throw err;
  }
}

async function getConversationHistory(businessId, clientPhone) {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_conversations')
    .select('messages')
    .eq('business_id', businessId)
    .eq('client_phone', clientPhone)
    .maybeSingle();

  if (error) {
    logger.error('Error recuperando historial:', error.message);
    return [];
  }

  return data?.messages || [];
}

async function saveConversationHistory(businessId, clientPhone, messages) {
  const mensajesLimpios = [];

  for (const m of messages) {
    if (typeof m.content === 'string' && m.content.trim()) {
      mensajesLimpios.push({ role: m.role, content: m.content });
    } else if (Array.isArray(m.content)) {
      const textos = m.content
        .filter(c => c.type === 'text' && c.text?.trim())
        .map(c => c.text)
        .join(' ');
      if (textos) {
        mensajesLimpios.push({ role: m.role, content: textos });
      }
    }
  }

  const { error } = await supabaseAdmin
    .from('whatsapp_conversations')
    .upsert({
      business_id: businessId,
      client_phone: clientPhone,
      messages: mensajesLimpios.slice(-8)
    }, { onConflict: 'business_id,client_phone' });

  if (error) logger.error('Error guardando historial:', error.message);
}

async function processChatbotMessage(businessId, clientPhone, messageText, history, business, clientInfo = null) {
  logger.info('Procesando mensaje del chatbot', { businessId, clientPhone, messageLength: messageText.length, historyLength: history.length });

  let businessHours = getCachedHours(businessId);
  if (!businessHours) {
    const { data: hoursData } = await supabaseAdmin
      .from('business_hours')
      .select('day_of_week, open_time, close_time, is_open')
      .eq('business_id', businessId)
      .order('day_of_week');
    businessHours = hoursData;
    if (hoursData) setCachedHours(businessId, hoursData);
  }

  let services = null;
  const { data: servicesData } = await supabaseAdmin
    .from('services')
    .select('name, price, duration_minutes')
    .eq('business_id', businessId)
    .eq('active', true)
    .order('name');
  services = servicesData;

  let citasActivas = [];
  try {
    const { data: clienteParaCitas } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('business_id', businessId)
      .eq('phone', clientPhone)
      .single();

    if (clienteParaCitas) {
      const { data: citasData, error: citasError } = await supabaseAdmin
        .from('appointments')
        .select('id, scheduled_at, status, services(name), employees(name)')
        .eq('business_id', businessId)
        .eq('client_id', clienteParaCitas.id)
        .in('status', ['pending', 'confirmed'])
        .order('scheduled_at', { ascending: true })
        .limit(10);

      if (citasError) {
        logger.error('Error consultando citas activas del cliente:', citasError.message);
      } else {
        citasActivas = citasData || [];
      }
    }
  } catch (err) {
    logger.error('Error inesperado consultando citas activas del cliente:', err.message);
    citasActivas = [];
  }

  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { staticPrompt, dynamicPrompt } = getBusinessSystemPrompt(business, clientInfo, businessHours || [], services || [], citasActivas);

  const tools = [
    {
      name: 'ver_servicios',
      description: 'Ver todos los servicios disponibles con precios y duración',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'verificar_disponibilidad',
      description: 'Verificar si hay disponibilidad en una fecha y hora',
      input_schema: {
        type: 'object',
        properties: {
          fecha: { type: 'string', description: 'Fecha YYYY-MM-DD' },
          hora: { type: 'string', description: 'Hora HH:mm' }
        },
        required: ['fecha']
      }
    },
    {
      name: 'agendar_cita',
      description: 'Agendar una cita para el cliente',
      input_schema: {
        type: 'object',
        properties: {
          service_name: { type: 'string' },
          fecha: { type: 'string', description: 'YYYY-MM-DD' },
          hora: { type: 'string', description: 'HH:mm' },
          client_name: { type: 'string', description: 'Nombre del cliente (opcional)' },
          employee_name: { type: 'string', description: 'Nombre del empleado preferido por el cliente (opcional)' }
        },
        required: ['service_name', 'fecha', 'hora']
      }
    },
    {
      name: 'ver_mis_citas',
      description: 'Ver las citas del cliente',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'cancelar_cita',
      description: 'Cancelar una cita del cliente',
      input_schema: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' }
        },
        required: ['appointment_id']
      }
    },
    {
      name: 'actualizar_cita',
      description: 'Actualizar una cita existente — cambiar empleado, hora, fecha o servicio',
      input_schema: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'ID de la cita a actualizar' },
          employee_name: { type: 'string', description: 'Nuevo empleado (opcional)' },
          nueva_fecha: { type: 'string', description: 'Nueva fecha YYYY-MM-DD (opcional)' },
          nueva_hora: { type: 'string', description: 'Nueva hora HH:mm (opcional)' },
          nuevo_servicio: { type: 'string', description: 'Nombre del nuevo servicio si el cliente quiere cambiarlo (opcional)' }
        },
        required: ['appointment_id']
      }
    },
    {
      name: 'ver_productos',
      description: 'Ver productos disponibles en el negocio para venta',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'ver_mi_fidelizacion',
      description: 'Ver visitas acumuladas y progreso hacia recompensa del cliente',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'ver_empleados',
      description: 'Ver empleados disponibles para que el cliente pueda escoger con quién quiere su cita',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'ver_horarios',
      description: 'Ver horarios de atención del negocio y días cerrados próximos. Usar cuando el cliente pregunte a qué hora abren, si atienden un día específico, o cuándo están disponibles.',
      input_schema: {
        type: 'object',
        properties: {
          dia: { type: 'string', description: 'Día específico a consultar (opcional). Ej: lunes, martes' }
        }
      }
    },
    {
      name: 'confirmar_asistencia',
      description: 'Confirma la asistencia del cliente a su próxima cita. Cambiar estado de pending a confirmed. Usar cuando el cliente diga "sí voy", "confirmo", "ahí estaré", "sí" en respuesta a un recordatorio.',
      input_schema: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'ID de la cita a confirmar (obtener de ver_mis_citas)' }
        },
        required: ['appointment_id']
      }
    },
    {
      name: 'lista_espera',
      description: 'Agrega al cliente a la lista de espera para una fecha/hora específica cuando no hay disponibilidad. El negocio lo contactará si se libera un espacio.',
      input_schema: {
        type: 'object',
        properties: {
          fecha: { type: 'string', description: 'Fecha YYYY-MM-DD deseada' },
          hora: { type: 'string', description: 'Hora HH:mm deseada (opcional)' },
          servicio: { type: 'string', description: 'Servicio deseado' }
        },
        required: ['fecha']
      }
    },
    {
      name: 'escalar_a_humano',
      description: 'Notificar al dueño del negocio cuando el cliente quiere hablar con un humano, tiene una queja o un problema grave',
      input_schema: {
        type: 'object',
        properties: {
          motivo: { type: 'string', description: 'Motivo del escalamiento — qué dijo el cliente' }
        },
        required: ['motivo']
      }
    },
    {
      name: 'gestionar_grupo',
      description: 'Gestionar citas grupales — guardar progreso, agregar personas al grupo y agendar todas las citas cuando estén completas',
      input_schema: {
        type: 'object',
        properties: {
          accion: {
            type: 'string',
            enum: ['leer_progreso', 'agregar_persona', 'confirmar_todas', 'limpiar'],
            description: 'leer_progreso: ver estado actual del grupo | agregar_persona: agregar una persona al grupo | confirmar_todas: agendar todas las citas pendientes | limpiar: cancelar el grupo'
          },
          persona: {
            type: 'object',
            description: 'Datos de la persona a agregar (solo para accion=agregar_persona)',
            properties: {
              nombre: { type: 'string' },
              servicio: { type: 'string' },
              fecha: { type: 'string', description: 'YYYY-MM-DD' },
              hora: { type: 'string', description: 'HH:mm' }
            }
          }
        },
        required: ['accion']
      }
    }
  ];

  async function executeChatbotTool(toolName, toolInput) {
    try {
      switch(toolName) {
        case 'ver_servicios': {
          const { data } = await supabaseAdmin
            .from('services')
            .select('name, price, duration_minutes')
            .eq('business_id', businessId)
            .eq('active', true)
            .order('name');

          const unicos = [];
          const nombres = new Set();
          data?.forEach(s => {
            if (!nombres.has(s.name)) {
              nombres.add(s.name);
              unicos.push(s);
            }
          });

          return { servicios: unicos };
        }

        case 'verificar_disponibilidad': {
          const { data: horariosNegocio } = await supabaseAdmin
            .from('business_hours')
            .select('open_time, close_time, is_open, day_of_week')
            .eq('business_id', businessId);

          const fechaDate = new Date(toolInput.fecha + 'T12:00:00-05:00');
          const diaSemana = fechaDate.getDay();
          const horarioDia = horariosNegocio?.find(h => h.day_of_week === diaSemana);

          if (!horarioDia?.is_open) {
            return {
              disponible: false,
              cerrado: true,
              mensaje: 'El negocio está cerrado ese día'
            };
          }

          // Verificar días cerrados especiales (festivos)
          const { data: diaCerradoEsp } = await supabaseAdmin
            .from('business_closed_days')
            .select('reason')
            .eq('business_id', businessId)
            .eq('date', toolInput.fecha)
            .maybeSingle();

          if (diaCerradoEsp) {
            return {
              disponible: false,
              cerrado: true,
              festivo: true,
              razon: diaCerradoEsp.reason,
              mensaje: `Ese dia estamos cerrados: ${diaCerradoEsp.reason}`
            };
          }

          const { data: empleados } = await supabaseAdmin
            .from('employees')
            .select('id, name')
            .eq('business_id', businessId)
            .eq('is_active', true);

          if (!empleados?.length) {
            return { disponible: false, mensaje: 'No hay empleados disponibles' };
          }

          const { data: citasDia } = await supabaseAdmin
            .from('appointments')
            .select('employee_id, scheduled_at, services(duration_minutes)')
            .eq('business_id', businessId)
            .in('status', ['confirmed', 'pending'])
            .gte('scheduled_at', toolInput.fecha + 'T00:00:00-05:00')
            .lte('scheduled_at', toolInput.fecha + 'T23:59:59-05:00');

          // Calcular slots ocupados por empleado
          const [aperturaH, aperturaM] = horarioDia.open_time.split(':').map(Number);
          const [cierreH, cierreM] = horarioDia.close_time.split(':').map(Number);
          const aperturaMin = aperturaH * 60 + aperturaM;
          const cierreMin = cierreH * 60 + cierreM;

          // Generar todos los slots del día cada 30 min
          const todosSlots = [];
          for (let m = aperturaMin; m < cierreMin; m += 30) {
            const h = Math.floor(m / 60).toString().padStart(2, '0');
            const min = (m % 60).toString().padStart(2, '0');
            todosSlots.push(`${h}:${min}`);
          }

          // Si el cliente especificó hora, verificar esa hora específica
          if (toolInput.hora) {
            const [horaH, horaM] = toolInput.hora.split(':').map(Number);
            const horaMin = horaH * 60 + horaM;

            if (horaMin < aperturaMin || horaMin >= cierreMin) {
              return {
                disponible: false,
                fuera_horario: true,
                mensaje: `Fuera de horario. Atendemos de ${horarioDia.open_time} a ${horarioDia.close_time}.`
              };
            }

            const horaReservadaMs = new Date(`${toolInput.fecha}T${toolInput.hora}:00-05:00`).getTime();
            const ocupados = new Set(
              citasDia?.filter(c => {
                const inicio = new Date(c.scheduled_at).getTime();
                const duracion = (c.services?.duration_minutes || 30) * 60 * 1000;
                return horaReservadaMs >= inicio && horaReservadaMs < (inicio + duracion);
              }).map(c => c.employee_id)
            );

            const hayDisponible = empleados.some(e => !ocupados.has(e.id));

            if (hayDisponible) {
              return { disponible: true, fecha: toolInput.fecha, hora: toolInput.hora };
            } else {
              // Buscar próximos slots disponibles
              const slotsLibres = [];
              for (const slot of todosSlots) {
                if (slot <= toolInput.hora) continue;
                const slotMs = new Date(`${toolInput.fecha}T${slot}:00-05:00`).getTime();
                const ocupadosSlot = new Set(
                  citasDia?.filter(c => {
                    const inicio = new Date(c.scheduled_at).getTime();
                    const duracion = (c.services?.duration_minutes || 30) * 60 * 1000;
                    return slotMs >= inicio && slotMs < (inicio + duracion);
                  }).map(c => c.employee_id)
                );
                if (empleados.some(e => !ocupadosSlot.has(e.id))) {
                  slotsLibres.push(slot);
                }
                if (slotsLibres.length >= 3) break;
              }
              return {
                disponible: false,
                slots_alternativos: slotsLibres,
                mensaje: `Ese horario está ocupado. Alternativas: ${slotsLibres.join(', ')}`
              };
            }
          }

          // Sin hora específica: analizar disponibilidad del día completo
          const horasOcupadasPorTodos = [];
          for (const slot of todosSlots) {
            const slotMs = new Date(`${toolInput.fecha}T${slot}:00-05:00`).getTime();
            const ocupadosSlot = new Set(
              citasDia?.filter(c => {
                const inicio = new Date(c.scheduled_at).getTime();
                const duracion = (c.services?.duration_minutes || 30) * 60 * 1000;
                return slotMs >= inicio && slotMs < (inicio + duracion);
              }).map(c => c.employee_id)
            );
            const todosOcupados = empleados.every(e => ocupadosSlot.has(e.id));
            if (todosOcupados) horasOcupadasPorTodos.push(slot);
          }

          if (horasOcupadasPorTodos.length === 0) {
            return {
              disponible: true,
              dia_libre: true,
              horario: `${horarioDia.open_time} a ${horarioDia.close_time}`,
              mensaje: `Todo el día está disponible de ${horarioDia.open_time} a ${horarioDia.close_time}`
            };
          }

          const slotsLibresDia = todosSlots.filter(s => !horasOcupadasPorTodos.includes(s));
          return {
            disponible: slotsLibresDia.length > 0,
            horario: `${horarioDia.open_time} a ${horarioDia.close_time}`,
            horas_no_disponibles: horasOcupadasPorTodos,
            horas_disponibles: slotsLibresDia,
            mensaje: slotsLibresDia.length > 0
              ? `Hay disponibilidad. No podemos a las: ${horasOcupadasPorTodos.join(', ')}`
              : 'No hay disponibilidad ese día'
          };
        }

        case 'agendar_cita': {
          const { data: servicios } = await supabaseAdmin
            .from('services')
            .select('id, name, price')
            .eq('business_id', businessId)
            .ilike('name', `%${toolInput.service_name}%`)
            .eq('active', true)
            .limit(1);

          const servicio = servicios?.[0];
          if (!servicio) return { success: false, error: 'Servicio no encontrado' };

          const [yearF, monthF, dayF] = toolInput.fecha.split('-').map(Number);
          const tempDate = new Date(yearF, monthF - 1, dayF);
          const diaDeLaSemana = tempDate.getDay();

          const { data: horario } = await supabaseAdmin
            .from('business_hours')
            .select('open_time, close_time, is_open')
            .eq('business_id', businessId)
            .eq('day_of_week', diaDeLaSemana)
            .maybeSingle();

          if (!horario?.is_open) {
            return { success: false, error: 'Ese día estamos cerrados.' };
          }

          // Verificar días cerrados especiales (festivos)
          const { data: diaCerrado } = await supabaseAdmin
            .from('business_closed_days')
            .select('reason')
            .eq('business_id', businessId)
            .eq('date', toolInput.fecha)
            .maybeSingle();

          if (diaCerrado) {
            return {
              success: false,
              error: `Ese día estamos cerrados: ${diaCerrado.reason}. ¿Te agendo otro día?`
            };
          }

          const [horaH, horaM] = toolInput.hora.split(':').map(Number);
          const appointmentMinutes = horaH * 60 + horaM;
          const [aperturaH, aperturaM] = horario.open_time.split(':').map(Number);
          const aperturaMinutes = aperturaH * 60 + aperturaM;
          const [cierreH, cierreM] = horario.close_time.split(':').map(Number);
          const cierreMinutes = cierreH * 60 + cierreM;

          if (appointmentMinutes < aperturaMinutes || appointmentMinutes >= cierreMinutes) {
            return {
              success: false,
              error: `Fuera de horario. Atendemos de ${horario.open_time} a ${horario.close_time}.`
            };
          }

          // Validar que la hora no haya pasado si es hoy
          const hoyCol = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
          if (toolInput.fecha === hoyCol) {
            const ahoraCol = new Date().toLocaleString('en-CA', {
              timeZone: 'America/Bogota',
              hour12: false
            });
            const horaActual = ahoraCol.split(', ')[1]?.slice(0,5) || '00:00';
            const [haH, haM] = horaActual.split(':').map(Number);
            const minutosAhora = haH * 60 + haM;
            if (appointmentMinutes <= minutosAhora) {
              return {
                success: false,
                error: `Esa hora ya pasó hoy. Puedes agendar desde las ${horaActual} en adelante.`
              };
            }
          }

          // Si el cliente pidió un empleado específico, intentar asignarlo
          let empleadoDisponible = null;
          if (toolInput.employee_name) {
            const { data: empMatches } = await supabaseAdmin
              .from('employees')
              .select('id, name')
              .eq('business_id', businessId)
              .eq('is_active', true)
              .ilike('name', `%${toolInput.employee_name}%`);

            // Si hay 2+ matches, retorna error de ambigüedad
            if (empMatches && empMatches.length > 1) {
              return {
                success: false,
                error: 'empleado_ambiguo',
                opciones: empMatches.map(e => ({ id: e.id, name: e.name }))
              };
            }

            const empPref = empMatches && empMatches.length === 1 ? empMatches[0] : null;

            if (empPref) {
              // Verificar si está disponible en ese horario
              const horaReservadaMs = new Date(`${toolInput.fecha}T${toolInput.hora}:00-05:00`).getTime();
              const { data: citasEmp } = await supabaseAdmin
                .from('appointments')
                .select('scheduled_at, services(duration_minutes)')
                .eq('business_id', businessId)
                .eq('employee_id', empPref.id)
                .in('status', ['confirmed', 'pending'])
                .gte('scheduled_at', `${toolInput.fecha}T00:00:00-05:00`)
                .lte('scheduled_at', `${toolInput.fecha}T23:59:59-05:00`);

              const ocupado = citasEmp?.some(c => {
                const inicio = new Date(c.scheduled_at).getTime();
                const duracion = (c.services?.duration_minutes || 30) * 60 * 1000;
                return horaReservadaMs >= inicio && horaReservadaMs < (inicio + duracion);
              });

              if (!ocupado) {
                empleadoDisponible = empPref;
              } else {
                return {
                  success: false,
                  error: `${empPref.name} no está disponible a esa hora. ¿Quieres con otro empleado disponible?`
                };
              }
            }
          }

          if (!empleadoDisponible) {
            empleadoDisponible = await getAvailableEmployee(businessId, toolInput.fecha, toolInput.hora);
          }
          if (!empleadoDisponible) {
            // Nadie disponible: busca slots alternativos ese mismo día y rechaza
            const { data: horariosNegocio } = await supabaseAdmin
              .from('business_hours')
              .select('open_time, close_time, is_open, day_of_week')
              .eq('business_id', businessId);

            const fechaDate = new Date(toolInput.fecha + 'T12:00:00-05:00');
            const diaSemana = fechaDate.getDay();
            const horarioDia = horariosNegocio?.find(h => h.day_of_week === diaSemana);

            if (!horarioDia?.is_open) {
              return { success: false, error: 'Ese día estamos cerrados.' };
            }

            // Obtener citas ese día
            const { data: citasDia } = await supabaseAdmin
              .from('appointments')
              .select('employee_id, scheduled_at, services(duration_minutes)')
              .eq('business_id', businessId)
              .in('status', ['confirmed', 'pending'])
              .gte('scheduled_at', toolInput.fecha + 'T00:00:00-05:00')
              .lte('scheduled_at', toolInput.fecha + 'T23:59:59-05:00');

            // Generar slots libres (lógica de verificar_disponibilidad)
            const [aperturaH2, aperturaM2] = horarioDia.open_time.split(':').map(Number);
            const [cierreH2, cierreM2] = horarioDia.close_time.split(':').map(Number);
            const aperturaMin2 = aperturaH2 * 60 + aperturaM2;
            const cierreMin2 = cierreH2 * 60 + cierreM2;

            const todosSlots = [];
            for (let m = aperturaMin2; m < cierreMin2; m += 30) {
              const h = Math.floor(m / 60).toString().padStart(2, '0');
              const min = (m % 60).toString().padStart(2, '0');
              todosSlots.push(`${h}:${min}`);
            }

            // Obtener empleados
            const { data: empleados } = await supabaseAdmin
              .from('employees')
              .select('id, name')
              .eq('business_id', businessId)
              .eq('is_active', true);

            // Buscar slots libres (después de la hora solicitada)
            const slotsLibres = [];

            for (const slot of todosSlots) {
              if (slot <= toolInput.hora) continue;
              const slotMs = new Date(`${toolInput.fecha}T${slot}:00-05:00`).getTime();
              const ocupadosSlot = new Set(
                citasDia?.filter(c => {
                  const inicio = new Date(c.scheduled_at).getTime();
                  const duracion = (c.services?.duration_minutes || 30) * 60 * 1000;
                  return slotMs >= inicio && slotMs < (inicio + duracion);
                }).map(c => c.employee_id)
              );
              if (empleados.some(e => !ocupadosSlot.has(e.id))) {
                slotsLibres.push(slot);
              }
              if (slotsLibres.length >= 3) break;
            }

            return {
              success: false,
              error: 'sin_disponibilidad',
              slots_alternativos: slotsLibres.length > 0 ? slotsLibres : [],
              mensaje: slotsLibres.length > 0
                ? `No hay disponibilidad a las ${toolInput.hora}. Alternativas: ${slotsLibres.join(', ')}`
                : 'No hay disponibilidad ese día.'
            };
          }

          let { data: clienteExistente } = await supabaseAdmin
            .from('clients')
            .select('id, name')
            .eq('business_id', businessId)
            .eq('phone', clientPhone)
            .maybeSingle();

          if (!clienteExistente && toolInput.client_name) {
            const { data: porNombre } = await supabaseAdmin
              .from('clients')
              .select('id, name')
              .eq('business_id', businessId)
              .ilike('name', `%${toolInput.client_name}%`)
              .limit(1);
            clienteExistente = porNombre?.[0] || null;
          }

          if (!clienteExistente) {
            const { data: nuevoCliente } = await supabaseAdmin
              .from('clients')
              .insert({
                business_id: businessId,
                name: toolInput.client_name || 'Cliente WhatsApp',
                phone: clientPhone
              })
              .select('id, name')
              .single();
            clienteExistente = nuevoCliente;
          } else if (toolInput.client_name && clienteExistente.name === 'Cliente WhatsApp') {
            await supabaseAdmin
              .from('clients')
              .update({ name: toolInput.client_name })
              .eq('id', clienteExistente.id);
            clienteExistente.name = toolInput.client_name;
            if (clientInfo && toolInput.client_name) {
              clientInfo.name = toolInput.client_name;
            }
          }

          const scheduled_at = `${toolInput.fecha}T${toolInput.hora}:00-05:00`;

          // Validar límite de citas del mes
          const { PLANS } = require('../config/plans');
          const { data: bizPlan } = await supabaseAdmin
            .from('businesses')
            .select('plan')
            .eq('id', businessId)
            .single();

          const planbot = bizPlan.plan || 'estandar';
          const limitebot = PLANS[planbot].max_appointments_month;

          if (limitebot !== -1) {
            const _tzbot = require('../utils/timezone').getTimezone();
            const _offbot = require('../utils/timezone').getOffsetForTz(_tzbot);
            const mesActualbot = new Date().toLocaleDateString('en-CA', { timeZone: _tzbot }).slice(0, 7);
            const inicioMesbot = `${mesActualbot}-01T00:00:00${_offbot}`;
            const [yrbot, mobot] = mesActualbot.split('-').map(Number);
            const ultimoDiabot = new Date(yrbot, mobot, 0).getDate();
            const finMesbot = `${mesActualbot}-${String(ultimoDiabot).padStart(2, '0')}T23:59:59${_offbot}`;

            const { count: countbot } = await supabaseAdmin
              .from('appointments')
              .select('id', { count: 'exact', head: true })
              .eq('business_id', businessId)
              .gte('scheduled_at', inicioMesbot)
              .lte('scheduled_at', finMesbot)
              .neq('status', 'cancelled');

            if (countbot >= limitebot) {
              return { success: false, error: 'Lo siento, el negocio ha alcanzado su límite de citas este mes.' };
            }
          }

          const { data, error } = await supabaseAdmin
            .from('appointments')
            .insert({
              business_id: businessId,
              client_id: clienteExistente?.id || null,
              service_id: servicio.id,
              scheduled_at,
              status: 'confirmed',
              source: 'whatsapp',
              price: servicio.price,
              employee_id: empleadoDisponible.id
            })
            .select('id, scheduled_at')
            .single();

          if (error) return { success: false, error: error.message };

          if (data) {
            try {
              await supabaseAdmin
                .from('employees')
                .update({ last_appointment_at: new Date().toISOString() })
                .eq('id', empleadoDisponible.id);
            } catch (empErr) {
              logger.error('Error actualizando employee:', empErr.message);
            }

            // Notificar al dueño de la nueva cita
            try {
              const { data: negocioNotif } = await supabaseAdmin
                .from('businesses')
                .select('phone, name, whatsapp_phone_number_id')
                .eq('id', businessId)
                .single();

              if (negocioNotif?.phone) {
                const clienteNombre = data && clienteExistente?.name && clienteExistente.name !== 'Cliente WhatsApp'
                  ? clienteExistente.name
                  : 'Cliente nuevo';

                const horaFormateadaNotif = new Date(`${toolInput.fecha}T${toolInput.hora}:00-05:00`)
                  .toLocaleString('es-CO', {
                    timeZone: 'America/Bogota',
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                  });

                const empleadoNombreNotif = empleadoDisponible?.name && empleadoDisponible.name !== 'Sin asignar'
                  ? ` — ${empleadoDisponible.name}`
                  : '';

                const mensajeDueno = `📅 *Nueva cita por WhatsApp*\n\n` +
                  `👤 *Cliente:* ${clienteNombre}\n` +
                  `📱 *Teléfono:* ${clientPhone}\n` +
                  `✂️ *Servicio:* ${servicio.name}${empleadoNombreNotif}\n` +
                  `🕐 *Fecha y hora:* ${horaFormateadaNotif}\n` +
                  `💰 *Precio:* $${servicio.price.toLocaleString('es-CO')}`;

                const businessTokenNotif = business?.whatsapp_access_token
                  ? require('../utils/encrypt').decrypt(business.whatsapp_access_token)
                  : process.env.WHATSAPP_ACCESS_TOKEN;

                await sendMessage(
                  negocioNotif.phone,
                  mensajeDueno,
                  businessTokenNotif,
                  negocioNotif.whatsapp_phone_number_id || business.whatsapp_phone_number_id
                );

                logger.info('Notificación enviada al dueño por nueva cita WhatsApp');
              }
            } catch (notifErr) {
              logger.error('Error notificando al dueño: ' + notifErr.message);
            }
          }

          const horaFormateada = new Date(scheduled_at).toLocaleString('es-CO', {
            timeZone: 'America/Bogota',
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          });
          return {
            success: true,
            servicio: servicio.name,
            precio: servicio.price,
            empleado: empleadoDisponible?.name && empleadoDisponible.name !== 'Sin asignar' ? empleadoDisponible.name : null,
            scheduled_at,
            hora_colombia: horaFormateada
          };
        }

        case 'ver_mis_citas': {
          const { data: clienteDB } = await supabaseAdmin
            .from('clients')
            .select('id')
            .eq('business_id', businessId)
            .eq('phone', clientPhone)
            .single();

          if (!clienteDB) return { citas: [], message: 'No tienes citas registradas' };

          const hoy = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
          const { data } = await supabaseAdmin
            .from('appointments')
            .select('id, scheduled_at, status, services(name, price), employees(name)')
            .eq('business_id', businessId)
            .eq('client_id', clienteDB.id)
            .neq('status', 'cancelled')
            .gte('scheduled_at', hoy + 'T00:00:00-05:00')
            .order('scheduled_at');

          const citasFormateadas = (data || []).map(c => {
            const horaCol = new Date(c.scheduled_at).toLocaleString('es-CO', {
              timeZone: 'America/Bogota',
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            });
            return {
              id: c.id,
              servicio: c.services?.name,
              precio: c.services?.price,
              empleado: c.employees?.name || null,
              fecha_hora_colombia: horaCol,
              status: c.status
            };
          });
          return { citas: citasFormateadas };
        }

        case 'cancelar_cita': {
          await supabaseAdmin
            .from('income')
            .delete()
            .eq('appointment_id', toolInput.appointment_id)
            .eq('business_id', businessId);

          const { data, error } = await supabaseAdmin
            .from('appointments')
            .update({ status: 'cancelled' })
            .eq('id', toolInput.appointment_id)
            .eq('business_id', businessId)
            .select('id');

          if (error) return { success: false, error: error.message };
          if (!data || data.length === 0) {
            return { success: false, error: 'Cita no encontrada' };
          }

          return { success: true };
        }

        case 'ver_productos': {
          const { data } = await supabaseAdmin
            .from('products')
            .select('name, price, stock')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .gt('stock', 0)
            .order('name');

          return { productos: data || [] };
        }

        case 'ver_mi_fidelizacion': {
          const { data: clienteData } = await supabaseAdmin
            .from('clients')
            .select('id')
            .eq('business_id', businessId)
            .eq('phone', clientPhone)
            .maybeSingle();

          if (!clienteData) {
            return { visitas_acumuladas: 0, visitas_faltantes: null, message: 'Aún no tienes visitas registradas con nosotros' };
          }

          const clienteId = clienteData.id;

          const { data: loyalty } = await supabaseAdmin
            .from('client_loyalty')
            .select('loyalty_visits, total_visits')
            .eq('business_id', businessId)
            .eq('client_id', clienteId)
            .maybeSingle();

          const { data: config } = await supabaseAdmin
            .from('loyalty_config')
            .select('visits_for_reward, reward_service_id, services(name)')
            .eq('business_id', businessId)
            .maybeSingle();

          const visitas = loyalty?.loyalty_visits || 0;
          const meta = config?.visits_for_reward || 10;
          const faltan = Math.max(0, meta - visitas);
          const servicio_gratis = config?.services?.name || 'servicio gratis';

          return {
            visitas_acumuladas: visitas,
            visitas_para_recompensa: meta,
            visitas_faltantes: faltan,
            recompensa: servicio_gratis,
            listo_para_canjear: faltan === 0
          };
        }

        case 'ver_empleados': {
          const { data: empleados } = await supabaseAdmin
            .from('employees')
            .select('id, name')
            .eq('business_id', businessId)
            .eq('is_active', true);

          return { empleados: empleados || [] };
        }

        case 'ver_horarios': {
          const { data: horarios } = await supabaseAdmin
            .from('business_hours')
            .select('day_of_week, open_time, close_time, is_open')
            .eq('business_id', businessId)
            .order('day_of_week');

          const diasNombres = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

          const horariosFormateados = (horarios || []).map(h => ({
            dia: diasNombres[h.day_of_week],
            abierto: h.is_open,
            apertura: h.open_time,
            cierre: h.close_time
          }));

          const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
          const en30 = new Date(Date.now() + 30*86400000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
          const { data: diasCerrados } = await supabaseAdmin
            .from('business_closed_days')
            .select('date, reason')
            .eq('business_id', businessId)
            .gte('date', hoy)
            .lte('date', en30)
            .order('date');

          if (toolInput.dia) {
            const diaLower = toolInput.dia.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
            const horarioDia = horariosFormateados.find(h =>
              h.dia.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(diaLower)
            );
            return { horario_dia: horarioDia || null, dias_cerrados: diasCerrados || [] };
          }

          return { horarios: horariosFormateados, dias_cerrados: diasCerrados || [] };
        }

        case 'confirmar_asistencia': {
          const { data, error } = await supabaseAdmin
            .from('appointments')
            .update({ status: 'confirmed' })
            .eq('id', toolInput.appointment_id)
            .eq('business_id', businessId)
            .select('id');

          if (error) return { success: false, error: error.message };
          if (!data || data.length === 0) {
            return { success: false, error: 'Cita no encontrada' };
          }
          return { success: true, message: 'Asistencia confirmada correctamente' };
        }

        case 'lista_espera': {
          try {
            const { data: clienteWait } = await supabaseAdmin
              .from('clients')
              .select('id, name')
              .eq('business_id', businessId)
              .eq('phone', clientPhone)
              .limit(1);

            const { error } = await supabaseAdmin
              .from('waitlist')
              .insert({
                business_id: businessId,
                client_id: clienteWait?.[0]?.id || null,
                client_phone: clientPhone,
                client_name: clienteWait?.[0]?.name || 'Cliente WhatsApp',
                desired_date: toolInput.fecha,
                desired_time: toolInput.hora || null,
                desired_service: toolInput.servicio || null,
                status: 'waiting',
                created_at: new Date().toISOString()
              });

            if (error) {
              logger.error('Error lista espera: ' + error.message);
              return { success: false, error: 'No se pudo agregar a la lista de espera' };
            }

            return {
              success: true,
              message: `Quedaste en lista de espera para el ${toolInput.fecha}${toolInput.hora ? ' a las ' + toolInput.hora : ''}. Te avisamos si se libera un espacio 😊`
            };
          } catch(e) {
            logger.error('Error lista_espera: ' + e.message);
            return { success: false, error: 'No se pudo agregar a la lista de espera' };
          }
        }

        case 'actualizar_cita': {
          const updateData = {};

          if (toolInput.employee_name) {
            const { data: empMatches } = await supabaseAdmin
              .from('employees')
              .select('id, name')
              .eq('business_id', businessId)
              .eq('is_active', true)
              .ilike('name', `%${toolInput.employee_name}%`);

            // Si hay 2+ matches, retorna error antes de tocar updateData
            if (empMatches && empMatches.length > 1) {
              return {
                success: false,
                error: 'empleado_ambiguo',
                opciones: empMatches.map(e => ({ id: e.id, name: e.name }))
              };
            }

            const empData = empMatches && empMatches.length === 1 ? empMatches[0] : null;

            if (!empData) {
              return { success: false, error: `No encontré ningún empleado con ese nombre.` };
            }

            // Verificar disponibilidad del empleado en el horario de la cita
            const { data: citaActual } = await supabaseAdmin
              .from('appointments')
              .select('scheduled_at, services(duration_minutes)')
              .eq('id', toolInput.appointment_id)
              .eq('business_id', businessId)
              .single();

            if (!citaActual) {
              return { success: false, error: 'Cita no encontrada' };
            }

            if (citaActual) {
              const horaReservadaMs = new Date(citaActual.scheduled_at).getTime();
              const fechaCita = citaActual.scheduled_at.slice(0, 10);
              const { data: citasEmp } = await supabaseAdmin
                .from('appointments')
                .select('scheduled_at, services(duration_minutes)')
                .eq('business_id', businessId)
                .eq('employee_id', empData.id)
                .neq('id', toolInput.appointment_id)
                .in('status', ['confirmed', 'pending'])
                .gte('scheduled_at', `${fechaCita}T00:00:00-05:00`)
                .lte('scheduled_at', `${fechaCita}T23:59:59-05:00`);

              const ocupado = citasEmp?.some(c => {
                const inicio = new Date(c.scheduled_at).getTime();
                const duracion = (c.services?.duration_minutes || 30) * 60 * 1000;
                return horaReservadaMs >= inicio && horaReservadaMs < (inicio + duracion);
              });

              if (ocupado) {
                return {
                  success: false,
                  error: `${empData.name} no está disponible en ese horario. ¿Quieres con otro empleado?`
                };
              }
            }

            updateData.employee_id = empData.id;
          }

          let nuevoPrecioServicio = null;
          if (toolInput.nuevo_servicio) {
            const { data: serviciosNuevo } = await supabaseAdmin
              .from('services')
              .select('id, name, price')
              .eq('business_id', businessId)
              .ilike('name', `%${toolInput.nuevo_servicio}%`)
              .eq('active', true)
              .limit(1);

            const servicioNuevo = serviciosNuevo?.[0];
            if (!servicioNuevo) {
              return { success: false, error: 'No encontré ese servicio. ¿Cuál quieres exactamente?' };
            }

            updateData.service_id = servicioNuevo.id;
            updateData.price = servicioNuevo.price;
            nuevoPrecioServicio = servicioNuevo.price;
          }

          // Si viene hora pero no fecha, usa la fecha actual de la cita
          let nuevaFecha = toolInput.nueva_fecha;
          let nuevaHora = toolInput.nueva_hora;

          if ((toolInput.nueva_fecha || toolInput.nueva_hora) && toolInput.appointment_id) {
            if (!nuevaFecha || !nuevaHora) {
              const { data: citaActual } = await supabaseAdmin
                .from('appointments')
                .select('scheduled_at')
                .eq('id', toolInput.appointment_id)
                .eq('business_id', businessId)
                .single();

              if (!citaActual) {
                return { success: false, error: 'Cita no encontrada' };
              }

              if (citaActual) {
                const [fechaParte, horaParte] = citaActual.scheduled_at.split('T');
                const horaActual = horaParte.slice(0, 5); // HH:mm

                if (!nuevaFecha) nuevaFecha = fechaParte;
                if (!nuevaHora) nuevaHora = horaActual;
              }
            }

            if (nuevaFecha && nuevaHora) {
              // Validar que el nuevo horario sea válido (dentro de business_hours, empleado disponible)
              const [yearF, monthF, dayF] = nuevaFecha.split('-').map(Number);
              const tempDate = new Date(yearF, monthF - 1, dayF);
              const diaSemana = tempDate.getDay();

              const { data: horario } = await supabaseAdmin
                .from('business_hours')
                .select('open_time, close_time, is_open')
                .eq('business_id', businessId)
                .eq('day_of_week', diaSemana)
                .maybeSingle();

              if (!horario?.is_open) {
                return { success: false, error: 'Ese día estamos cerrados.' };
              }

              // Validar hora dentro de business_hours
              const [horaH, horaM] = nuevaHora.split(':').map(Number);
              const [aperturaH, aperturaM] = horario.open_time.split(':').map(Number);
              const [cierreH, cierreM] = horario.close_time.split(':').map(Number);

              const horaMin = horaH * 60 + horaM;
              const aperturaMin = aperturaH * 60 + aperturaM;
              const cierreMin = cierreH * 60 + cierreM;

              if (horaMin < aperturaMin || horaMin >= cierreMin) {
                return {
                  success: false,
                  error: `Fuera de horario. Atendemos de ${horario.open_time} a ${horario.close_time}.`
                };
              }

              // Validar que empleado actual no tenga conflicto en el nuevo horario
              if (updateData.employee_id || toolInput.appointment_id) {
                const { data: citaActual } = await supabaseAdmin
                  .from('appointments')
                  .select('employee_id')
                  .eq('id', toolInput.appointment_id)
                  .eq('business_id', businessId)
                  .single();

                if (!citaActual) {
                  return { success: false, error: 'Cita no encontrada' };
                }

                const empId = updateData.employee_id || citaActual?.employee_id;

                if (empId) {
                  const horaReservadaMs = new Date(`${nuevaFecha}T${nuevaHora}:00-05:00`).getTime();
                  const { data: citasEmp } = await supabaseAdmin
                    .from('appointments')
                    .select('scheduled_at, services(duration_minutes)')
                    .eq('business_id', businessId)
                    .eq('employee_id', empId)
                    .neq('id', toolInput.appointment_id)
                    .in('status', ['confirmed', 'pending'])
                    .gte('scheduled_at', `${nuevaFecha}T00:00:00-05:00`)
                    .lte('scheduled_at', `${nuevaFecha}T23:59:59-05:00`);

                  const ocupado = citasEmp?.some(c => {
                    const inicio = new Date(c.scheduled_at).getTime();
                    const duracion = (c.services?.duration_minutes || 30) * 60 * 1000;
                    return horaReservadaMs >= inicio && horaReservadaMs < (inicio + duracion);
                  });

                  if (ocupado) {
                    return {
                      success: false,
                      error: `Ese horario está ocupado para el empleado asignado.`
                    };
                  }
                }
              }

              updateData.scheduled_at = `${nuevaFecha}T${nuevaHora}:00-05:00`;
            }
          }

          if (Object.keys(updateData).length === 0) {
            return { success: false, error: 'No hay cambios que aplicar.' };
          }

          const { data, error } = await supabaseAdmin
            .from('appointments')
            .update(updateData)
            .eq('id', toolInput.appointment_id)
            .eq('business_id', businessId)
            .select('id');

          if (error) return { success: false, error: error.message };
          if (!data || data.length === 0) {
            return { success: false, error: 'Cita no encontrada' };
          }

          if (toolInput.nueva_fecha || toolInput.nueva_hora || toolInput.nuevo_servicio) {
            const { data: citaActualizada } = await supabaseAdmin
              .from('appointments')
              .select('service_id, services(name, price)')
              .eq('id', toolInput.appointment_id)
              .single();

            if (citaActualizada?.services?.price) {
              await supabaseAdmin
                .from('income')
                .update({
                  amount: citaActualizada.services.price,
                  description: `${citaActualizada.services.name} - agendado por WhatsApp (actualizado)`
                })
                .eq('appointment_id', toolInput.appointment_id)
                .eq('business_id', businessId);
            }
          }

          const empleadoNombre = toolInput.employee_name || null;
          return {
            success: true,
            message: `Cita actualizada correctamente${empleadoNombre ? ` — ahora con ${empleadoNombre}` : ''}.`,
            nuevo_precio: nuevoPrecioServicio
          };
        }

        case 'escalar_a_humano': {
          try {
            const { data: negocio } = await supabaseAdmin
              .from('businesses')
              .select('phone, name')
              .eq('id', businessId)
              .single();

            if (!negocio?.phone) {
              return { success: false, message: 'No se pudo notificar al dueño — número no configurado.' };
            }

            const { sendMessage } = require('../config/whatsapp');
            const clientNombre = clientInfo?.name && clientInfo.name !== 'Cliente WhatsApp'
              ? clientInfo.name
              : 'Un cliente';

            const mensajeDueño = `⚠️ *Atención requerida en ${negocio.name}*\n\n` +
              `Tu cliente *${clientNombre}* (${clientPhone}) quiere hablar contigo.\n\n` +
              `*Motivo:* ${toolInput.motivo}\n\n` +
              `Contáctalo directamente por WhatsApp.`;

            const businessToken = business?.whatsapp_access_token
              ? require('../utils/encrypt').decrypt(business.whatsapp_access_token)
              : process.env.WHATSAPP_ACCESS_TOKEN;

            await sendMessage(
              negocio.phone,
              mensajeDueño,
              businessToken,
              business.whatsapp_phone_number_id
            );

            const pausadoHasta = new Date();
            pausadoHasta.setHours(pausadoHasta.getHours() + 3);

            const { error: updateError } = await supabaseAdmin
              .from('whatsapp_conversations')
              .update({ bot_paused_until: pausadoHasta.toISOString() })
              .eq('business_id', businessId)
              .eq('client_phone', clientPhone);

            logger.info('Pausa guardada en BD:', { businessId, clientPhone, pausadoHasta: pausadoHasta.toISOString(), error: updateError });
            logger.info('Bot pausado por 3 horas para cliente:', { clientPhone, hasta: pausadoHasta.toISOString() });

            return {
              success: true,
              message: 'Dueño notificado correctamente.'
            };
          } catch(e) {
            logger.error('Error escalando a humano:', e.message);
            return { success: false, message: 'No se pudo notificar al dueño.' };
          }
        }

        case 'gestionar_grupo': {
          const { accion, persona } = toolInput;

          // Leer contexto actual
          const { data: convActual } = await supabaseAdmin
            .from('whatsapp_conversations')
            .select('context')
            .eq('business_id', businessId)
            .eq('client_phone', clientPhone)
            .maybeSingle();

          const contexto = convActual?.context || {};
          const grupo = contexto.grupo || { personas: [], confirmadas: 0 };

          if (accion === 'leer_progreso') {
            return {
              grupo_activo: grupo.personas.length > 0,
              personas: grupo.personas,
              total: grupo.personas.length,
              confirmadas: grupo.confirmadas
            };
          }

          if (accion === 'limpiar') {
            await supabaseAdmin
              .from('whatsapp_conversations')
              .update({ context: { ...contexto, grupo: null } })
              .eq('business_id', businessId)
              .eq('client_phone', clientPhone);
            return { success: true, message: 'Grupo limpiado.' };
          }

          if (accion === 'agregar_persona' && persona) {
            grupo.personas.push({
              nombre: persona.nombre || 'Sin nombre',
              servicio: persona.servicio,
              fecha: persona.fecha,
              hora: persona.hora,
              agendada: false
            });

            await supabaseAdmin
              .from('whatsapp_conversations')
              .upsert({
                business_id: businessId,
                client_phone: clientPhone,
                context: { ...contexto, grupo }
              }, { onConflict: 'business_id,client_phone' });

            return {
              success: true,
              total_en_grupo: grupo.personas.length,
              personas: grupo.personas
            };
          }

          if (accion === 'confirmar_todas') {
            const resultados = [];
            const pendientes = grupo.personas.filter(p => !p.agendada);

            // Validar límite de citas del mes para el grupo
            const { PLANS: PLANSgrp } = require('../config/plans');
            const { data: bizGrp } = await supabaseAdmin
              .from('businesses')
              .select('plan')
              .eq('id', businessId)
              .single();

            const plangrp = bizGrp.plan || 'estandar';
            const limitegrp = PLANSgrp[plangrp].max_appointments_month;
            let contadorCitasGrp = 0;

            if (limitegrp !== -1) {
              const _tzgrp = require('../utils/timezone').getTimezone();
              const _offgrp = require('../utils/timezone').getOffsetForTz(_tzgrp);
              const mesActualgrp = new Date().toLocaleDateString('en-CA', { timeZone: _tzgrp }).slice(0, 7);
              const inicioMesgrp = `${mesActualgrp}-01T00:00:00${_offgrp}`;
              const [yrgrp, mogrp] = mesActualgrp.split('-').map(Number);
              const ultimoDiagrp = new Date(yrgrp, mogrp, 0).getDate();
              const finMesgrp = `${mesActualgrp}-${String(ultimoDiagrp).padStart(2, '0')}T23:59:59${_offgrp}`;

              const { count: countgrp } = await supabaseAdmin
                .from('appointments')
                .select('id', { count: 'exact', head: true })
                .eq('business_id', businessId)
                .gte('scheduled_at', inicioMesgrp)
                .lte('scheduled_at', finMesgrp)
                .neq('status', 'cancelled');

              contadorCitasGrp = countgrp || 0;
            }

            for (const p of pendientes) {
              if (!p.servicio || !p.fecha || !p.hora) {
                resultados.push({ nombre: p.nombre, success: false, error: 'Faltan datos' });
                continue;
              }

              // Buscar servicio
              const { data: servicios } = await supabaseAdmin
                .from('services')
                .select('id, name, price, duration_minutes')
                .eq('business_id', businessId)
                .ilike('name', `%${p.servicio}%`)
                .eq('active', true)
                .limit(1);

              const servicio = servicios?.[0];
              if (!servicio) {
                resultados.push({ nombre: p.nombre, success: false, error: 'Servicio no encontrado' });
                continue;
              }

              // Buscar empleado disponible
              const empleado = await getAvailableEmployee(businessId, p.fecha, p.hora);
              if (!empleado) {
                resultados.push({ nombre: p.nombre, success: false, error: `Sin empleados disponibles a las ${p.hora}` });
                continue;
              }

              // Obtener cliente principal (el que escribe)
              const { data: clientePrincipal } = await supabaseAdmin
                .from('clients')
                .select('id, name')
                .eq('business_id', businessId)
                .eq('phone', clientPhone)
                .maybeSingle();

              const scheduled_at = `${p.fecha}T${p.hora}:00-05:00`;
              const notaNombre = p.nombre && p.nombre !== 'Sin nombre'
                ? `Para: ${p.nombre}`
                : null;

              // Validar límite antes de cada cita
              if (limitegrp !== -1 && contadorCitasGrp >= limitegrp) {
                resultados.push({ nombre: p.nombre, success: false, error: 'Límite de citas del mes alcanzado' });
                continue;
              }

              const { data: cita, error } = await supabaseAdmin
                .from('appointments')
                .insert({
                  business_id: businessId,
                  client_id: clientePrincipal?.id || null,
                  service_id: servicio.id,
                  scheduled_at,
                  status: 'confirmed',
                  source: 'whatsapp',
                  price: servicio.price,
                  employee_id: empleado.id,
                  notes: notaNombre
                })
                .select('id')
                .single();

              if (error) {
                resultados.push({ nombre: p.nombre, success: false, error: error.message });
                continue;
              }

              // Crear ingreso
              try {
                await supabaseAdmin.from('income').insert({
                  business_id: businessId,
                  amount: servicio.price,
                  category: 'servicios',
                  description: `${servicio.name}${notaNombre ? ' - ' + notaNombre : ''} - WhatsApp`,
                  source: 'appointment',
                  appointment_id: cita.id,
                  date: p.fecha,
                  client_id: clientePrincipal?.id || null
                });
              } catch(e) {
                logger.error('Error creando ingreso grupal:', e.message);
              }

              const horaFormateada = new Date(scheduled_at).toLocaleString('es-CO', {
                timeZone: 'America/Bogota',
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
              });

              p.agendada = true;
              contadorCitasGrp++;
              resultados.push({
                nombre: p.nombre,
                success: true,
                servicio: servicio.name,
            empleado: empleado.name && empleado.name !== 'Sin asignar' ? empleado.name : null,
                hora_colombia: horaFormateada,
                precio: servicio.price
              });
            }

            // Limpiar grupo del context
            await supabaseAdmin
              .from('whatsapp_conversations')
              .update({ context: { ...contexto, grupo: null } })
              .eq('business_id', businessId)
              .eq('client_phone', clientPhone);

            const exitosas = resultados.filter(r => r.success).length;
            const fallidas = resultados.filter(r => !r.success).length;

            return {
              success: exitosas > 0,
              total: resultados.length,
              exitosas,
              fallidas,
              resultados
            };
          }

          return { error: 'Acción no reconocida' };
        }

        default:
          return { error: 'Función no disponible' };
      }
    } catch (error) {
      logger.error('TOOL_ERROR_' + toolName + '_' + (error.message || String(error)).replace(/\s+/g, '_').slice(0, 300));
      return { error: error.message };
    }
  }

  let cleanHistory = [...history].filter((_, idx) => {
    if (idx === 0) return history[0].role === 'user';
    return true;
  });

  while (cleanHistory.length > 0 && cleanHistory[0].role === 'assistant') {
    cleanHistory.shift();
  }

  cleanHistory = cleanHistory.slice(-8);

  const messages = [...cleanHistory, { role: 'user', content: messageText }];

  let response;
  try {
    response = await anthropicClient.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: [
        { type: 'text', text: staticPrompt, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: dynamicPrompt }
      ],
      tools,
      messages
    });
  } catch (claudeError) {
    logger.error('Error de Claude:', claudeError.message);
    throw claudeError;
  }

  try {
    const allMessages = [...messages];
    let iterations = 0;
    const MAX_ITERATIONS = 5;

    while (response.stop_reason === 'tool_use' && iterations < MAX_ITERATIONS) {
      iterations++;
      const assistantContent = response.content;
      allMessages.push({ role: 'assistant', content: assistantContent });

      const toolResults = [];
      let shouldBreak = false;
      for (const block of assistantContent) {
        if (block.type === 'tool_use') {
          const result = await executeChatbotTool(block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          });
          // Si se ejecutó escalar_a_humano exitosamente, detener el loop
          if (block.name === 'escalar_a_humano' && result.success) {
            shouldBreak = true;
          }
        }
      }

      // Si se escaló a humano, retornar el mensaje de confirmación sin seguir procesando
      if (shouldBreak) {
        const escaladaResponse = 'Listo, le avisé al dueño. Te contactarán pronto 😊';
        allMessages.push({ role: 'assistant', content: [{ type: 'text', text: escaladaResponse }] });
        return {
          response: escaladaResponse,
          history: allMessages.slice(-10)
        };
      }

      allMessages.push({ role: 'user', content: toolResults });
      response = await anthropicClient.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: [
          { type: 'text', text: staticPrompt, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: dynamicPrompt }
        ],
        tools,
        messages: allMessages
      });
    }

    const finalText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    allMessages.push({ role: 'assistant', content: response.content });

    return {
      response: finalText,
      history: allMessages.slice(-10)
    };
  } catch (error) {
    logger.error('Error procesando respuesta:', error.message);
    throw error;
  }
}

async function processWhatsAppMessage({ from, phoneNumberId, messageText, messageId }) {
  logger.info('Mensaje WhatsApp recibido', { from, phoneNumberId, messageId });

  try {
    const business = await getBusinessByPhoneNumberId(phoneNumberId);

    if (!business) {
      logger.warn('Negocio no encontrado', { phoneNumberId });
      return;
    }

    if (messageId) {
      const { data: existingMsg } = await supabaseAdmin
        .from('whatsapp_conversations')
        .select('processed_message_ids')
        .eq('business_id', business.id)
        .eq('client_phone', from)
        .maybeSingle();

      const processedIds = existingMsg?.processed_message_ids || [];
      if (processedIds.includes(messageId)) {
        logger.info('Mensaje duplicado ignorado:', messageId);
        return;
      }
    }

    // Verificar si el bot está pausado para este cliente
    const { data: convPausa } = await supabaseAdmin
      .from('whatsapp_conversations')
      .select('bot_paused_until')
      .eq('business_id', business.id)
      .eq('client_phone', from)
      .maybeSingle();

    if (convPausa?.bot_paused_until) {
      const pausadoHasta = new Date(convPausa.bot_paused_until);
      if (pausadoHasta > new Date()) {
        logger.info('Bot pausado para cliente hasta: ' + pausadoHasta.toISOString() + ' cliente: ' + from);
        return;
      }
    }

    const businessToken = business.whatsapp_access_token
      ? decrypt(business.whatsapp_access_token)
      : null;

    const [client_info, history] = await Promise.all([
      getOrCreateClient(business.id, from),
      getConversationHistory(business.id, from)
    ]);

    logger.info('Cliente e historial cargados', { clientId: client_info?.id, historyLength: history.length });

    // Detección rápida de confirmación/cancelación de cita (respuesta a recordatorio)
    const msgLower = messageText.toLowerCase().trim();
    // SOLO activa si el mensaje es EXACTAMENTE una de estas frases, nada más (sin texto adicional)
    const esConfirmacion = ['si', 'sí', 'confirmo', 'confirmado', 'ahí estaré', 'ahi estare', 'voy', 'allá voy', 'alla voy', 'ok', 'okay', 'dale', 'claro', 'por supuesto', 'si voy', 'sí voy'].includes(msgLower);
    const esCancelacion = ['no', 'no puedo', 'cancela', 'cancelar', 'no voy', 'no puedo ir', 'no iré', 'no ire', 'cancela mi cita', 'no asisto'].includes(msgLower);

    if (esConfirmacion || esCancelacion) {
      const { data: clienteCheck } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('business_id', business.id)
        .eq('phone', from)
        .limit(1);

      const clienteId = clienteCheck?.[0]?.id;

      if (clienteId) {
        const hoyCheck = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
        const { data: citasProximas } = await supabaseAdmin
          .from('appointments')
          .select('id, scheduled_at, services(name), status')
          .eq('business_id', business.id)
          .eq('client_id', clienteId)
          .eq('status', 'pending')
          .gte('scheduled_at', `${hoyCheck}T00:00:00-05:00`)
          .order('scheduled_at')
          .limit(1);

        const citaProxima = citasProximas?.[0];

        if (citaProxima) {
          const horaFormateada = new Date(citaProxima.scheduled_at).toLocaleString('es-CO', {
            timeZone: 'America/Bogota',
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          });

          if (esConfirmacion) {
            await supabaseAdmin
              .from('appointments')
              .update({ status: 'confirmed' })
              .eq('id', citaProxima.id);

            const respuestaConfirm = `✅ ¡Perfecto! Tu cita de ${citaProxima.services?.name} el ${horaFormateada} está confirmada. ¡Te esperamos! 😊`;
            await sendMessage(from, respuestaConfirm, businessToken, business.whatsapp_phone_number_id);

            await saveConversationHistory(business.id, from, [
              ...history,
              { role: 'user', content: messageText },
              { role: 'assistant', content: respuestaConfirm }
            ]);

            if (messageId) {
              const { data: existingMsg2 } = await supabaseAdmin
                .from('whatsapp_conversations')
                .select('processed_message_ids')
                .eq('business_id', business.id)
                .eq('client_phone', from)
                .maybeSingle();
              const processedIds2 = existingMsg2?.processed_message_ids || [];
              await supabaseAdmin
                .from('whatsapp_conversations')
                .update({ processed_message_ids: [...processedIds2, messageId].slice(-50) })
                .eq('business_id', business.id)
                .eq('client_phone', from);
            }
            return;

          } else if (esCancelacion) {
            await supabaseAdmin
              .from('income')
              .delete()
              .eq('appointment_id', citaProxima.id)
              .eq('business_id', business.id);

            await supabaseAdmin
              .from('appointments')
              .update({ status: 'cancelled' })
              .eq('id', citaProxima.id);

            const respuestaCancel = `Entendido, cancelé tu cita de ${citaProxima.services?.name} del ${horaFormateada} 😊 Cuando quieras reagendar aquí estoy.`;
            await sendMessage(from, respuestaCancel, businessToken, business.whatsapp_phone_number_id);

            await saveConversationHistory(business.id, from, [
              ...history,
              { role: 'user', content: messageText },
              { role: 'assistant', content: respuestaCancel }
            ]);

            if (messageId) {
              const { data: existingMsg3 } = await supabaseAdmin
                .from('whatsapp_conversations')
                .select('processed_message_ids')
                .eq('business_id', business.id)
                .eq('client_phone', from)
                .maybeSingle();
              const processedIds3 = existingMsg3?.processed_message_ids || [];
              await supabaseAdmin
                .from('whatsapp_conversations')
                .update({ processed_message_ids: [...processedIds3, messageId].slice(-50) })
                .eq('business_id', business.id)
                .eq('client_phone', from);
            }
            return;
          }
        }
      }
    }

    let result;
    try {
      result = await processChatbotMessage(business.id, from, messageText, history, business, client_info);
      logger.info('Mensaje procesado exitosamente');
    } catch(e) {
      logger.error('Error procesando mensaje:', e.message);
      await sendMessage(from, 'Estoy teniendo problemas técnicos en este momento 🙏 Escríbeme en unos minutos e intento de nuevo.', businessToken, business.whatsapp_phone_number_id);
      return;
    }

    try {
      await saveConversationHistory(business.id, from, result.history);
      logger.info('Historial guardado');
    } catch(e) {
      logger.error('Error guardando historial:', e.message);
    }

    try {
      await sendMessage(from, result.response, businessToken, business.whatsapp_phone_number_id);
      logger.info('Mensaje enviado al cliente');
      // Actualizar last_bot_response_at para evitar respuestas múltiples
      try {
        await supabaseAdmin
          .from('whatsapp_conversations')
          .update({ last_bot_response_at: new Date().toISOString() })
          .eq('business_id', business.id)
          .eq('client_phone', from);
      } catch(e) {
        logger.error('Error actualizando last_bot_response_at:', e.message);
      }
    } catch(e) {
      logger.error('Error enviando mensaje:', e.message);
    }

    if (messageId) {
      try {
        const { data: existingMsg } = await supabaseAdmin
          .from('whatsapp_conversations')
          .select('processed_message_ids')
          .eq('business_id', business.id)
          .eq('client_phone', from)
          .maybeSingle();

        const processedIds = existingMsg?.processed_message_ids || [];
        await supabaseAdmin
          .from('whatsapp_conversations')
          .update({
            processed_message_ids: [...processedIds, messageId].slice(-50)
          })
          .eq('business_id', business.id)
          .eq('client_phone', from);

        logger.info('MessageId guardado:', messageId);
      } catch(e) {
        logger.error('Error guardando messageId:', e.message);
      }
    }

  } catch (error) {
    logger.error('Error general en processWhatsAppMessage:', error.message);
    try {
      await sendMessage(from, 'Tuve un problema técnico 😕 Intenta escribirme de nuevo en un momento.');
    } catch(e) {}
  }
}

module.exports = { processWhatsAppMessage, processChatbotMessage, getBusinessSystemPrompt, getBusinessByPhoneNumberId, transcribeAudio };
