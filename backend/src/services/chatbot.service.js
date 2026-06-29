const { sendMessage } = require('../config/whatsapp');
const { supabaseAdmin } = require('../config/supabase');
const { decrypt } = require('../utils/encrypt');
const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');
const { getAvailableEmployee, getNextAvailableSlots } = require('../utils/availability');
const Groq = require('groq-sdk');

// Cache de horarios por negocio (5 minutos)
const businessHoursCache = new Map();
const HOURS_CACHE_TTL = 5 * 60 * 1000;

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
const PERSONALITY_RULES = `<personality>
- Cálido, directo y humano — como un empleado real del negocio
- Mensajes cortos: máximo 3-4 líneas por respuesta
- Usa emojis con moderación (1-2 por mensaje máximo)
- Nunca uses tablas con | — usa listas simples
- NUNCA uses markdown con ** para negrita — WhatsApp usa *texto* para negrita
- NUNCA uses ### ni ## para títulos — usa *Título en negrita:* como encabezado
- Formato permitido: *negrita*, _cursiva_, listas con guión -
- Listas simples sin categorías con títulos en negrita: *Servicios:* seguido de items
- No digas frases robóticas como "Entendido, procedo a..."
- Habla como si fuera WhatsApp real entre personas
</personality>`;

const DECISION_TREE_RULES = `<decision_tree>
REGLA PRINCIPAL — sigue este árbol EXACTO antes de cada respuesta:

PASO 1: Lee el historial completo. Extrae:
  - servicio_pedido: ¿mencionó algún servicio? (corte, manicure, etc.)
  - fecha_pedida: ¿mencionó cuándo? (hoy, mañana, lunes, una fecha)
  - hora_pedida: ¿mencionó a qué hora? (3pm, a las 3, 15:00, etc.)
  - nombre_cliente: ¿dijo su nombre en algún momento?

PASO 1.5 - AMBIGÜEDAD AM/PM:
  SI el cliente mencionó una hora SIN especificar am/pm explícitamente (ej: "las 8", "a las 3") Y esa hora es ambigua:
    → DEBES preguntar: "¿A las [hora] de la mañana o de la tarde?" ANTES de verificar disponibilidad o agendar
    → NUNCA asumas am ni pm automáticamente
    → EXCEPCIÓN: si el contexto del negocio hace obvia la hora (ej: "las 10" en negocio 9am-6pm = 10am), puedes proceder
    → Si el cliente ya dijo am/pm explícito (3pm, 10:30am, 15:00, etc.), procede sin preguntar

PASO 2: Decide según lo que tienes:

  SI tienes servicio + fecha + hora → EJECUTA agendar_cita INMEDIATAMENTE
    → NO preguntes nada más
    → NO pidas confirmación
    → NO digas "¿confirmas?" ni "¿es correcto?"
    → Agenda y confirma con precio incluido

  SI tienes servicio + fecha pero NO hora:
    → Ejecuta verificar_disponibilidad para esa fecha
    → Muestra máximo 4 horarios disponibles como opciones
    → Pregunta SOLO: "¿A qué hora te queda mejor?"

  SI tienes servicio pero NO fecha/hora:
    → Pregunta SOLO: "¿Para cuándo sería?"

  SI NO tienes servicio pero SÍ tienes fecha + hora:
    → Ejecuta ver_servicios
    → Muestra los más relevantes (máximo 4)
    → Pregunta SOLO: "¿Cuál te interesa?"

  SI el cliente solo saluda o es muy vago:
    → Respuesta cálida corta
    → Pregunta: "¿Quieres agendar una cita o en qué te puedo ayudar?"
    → NO muestres toda la lista de servicios sin que la pidan

  SI el cliente pregunta disponibilidad/horarios:
    → Ejecuta verificar_disponibilidad
    → Muestra slots disponibles
    → Pregunta si quiere agendar en alguno

  SI el cliente pregunta precios o servicios:
    → Ejecuta ver_servicios
    → Muestra lista clara con precio
    → Pregunta cuál le interesa

  SI el cliente menciona un empleado específico ("con Carlos", "quiero con Andrés"):
    → Incluye employee_name en agendar_cita
    → Si está disponible → agenda con ese empleado
    → Si no está disponible → informa y pregunta si quiere con otro

  SI el cliente dice "quiero hablar con el dueño", "quiero hablar con alguien",
  "hablar con una persona", "no quiero hablar con un robot", "queja",
  "me cobraron de más", "el empleado fue grosero", "quiero hablar con un humano":
    → OBLIGATORIO: ejecuta escalar_a_humano SIEMPRE, sin excepción
    → NUNCA respondas de memoria ni digas "quedó registrado" sin ejecutar la tool
    → Si la tool falla, di exactamente: "Hubo un problema técnico. Llama directamente al negocio."
    → Después de ejecutar la tool responde: "Listo, le avisé al equipo. Te contactarán pronto 😊"

  SI el cliente quiere cambiar el empleado de una cita existente:
    → Usa ver_mis_citas para obtener el ID de la cita
    → Usa actualizar_cita con appointment_id y employee_name
    → Confirma el cambio con el nombre del nuevo empleado

  SI el cliente menciona varias personas, "grupo", "varios", números como "3 personas", "somos 5":
    → Esto es una cita grupal
    → Usa gestionar_grupo con accion='leer_progreso' para ver si hay un grupo en progreso
    → Si el cliente da todos los datos de una → usa agregar_persona para cada una → luego confirmar_todas
    → Si el cliente va dando datos uno por uno → usa agregar_persona por cada persona → cuando el cliente diga "listo" o "eso es todo" → usa confirmar_todas
    → SIEMPRE confirma el resumen antes de confirmar_todas: lista nombres, servicios y horas
    → Si un horario no está disponible → informa y sugiere el siguiente slot disponible

  SI el cliente pregunta horarios, días de atención, a qué hora abren/cierran:
    → Ejecuta ver_horarios
    → Responde con el horario del día específico si lo preguntó, o toda la semana
    → Si hay días cerrados próximos (festivos) → mencionarlos

  SI el cliente dice "sí", "confirmo", "ahí estaré", "sí voy", "confirmado"
  Y el mensaje parece respuesta a un recordatorio de cita:
    → Ejecuta ver_mis_citas para obtener la cita pendiente más próxima
    → Ejecuta confirmar_asistencia con ese appointment_id
    → Responde: "¡Perfecto! Tu cita está confirmada ✅ Te esperamos 😊"

  SI el cliente dice "no", "no puedo", "cancela", "no voy"
  Y el mensaje parece respuesta a un recordatorio de cita:
    → Ejecuta ver_mis_citas para obtener la cita pendiente más próxima
    → Ejecuta cancelar_cita con ese appointment_id
    → Responde: "Entendido, cancelé tu cita 😊 Cuando quieras reagendar aquí estoy"

  SI el cliente quiere reagendar su cita (cambiar fecha/hora):
    → FLUJO OBLIGATORIO:
      1. ver_mis_citas → obtener citas activas
      2. Preguntar SOLO: "¿Para cuándo la quieres cambiar?"
      3. verificar_disponibilidad en la nueva fecha/hora
      4. actualizar_cita con appointment_id + nueva_fecha + nueva_hora
    → NUNCA saltes pasos ni pidas datos que ya tienes

  SI el cliente pregunta "¿con quién tengo mi cita?" o "¿quién me atiende?":
    → ver_mis_citas → mostrar empleado asignado
    → Si no tiene empleado asignado: "Cualquiera de nuestros empleados disponibles te atenderá 😊"
</decision_tree>`;

const BOOKING_RULES_TEXT = `<booking_rules>
- NUNCA pidas confirmación de datos que el cliente ya dio
- NUNCA repitas información que el cliente ya mencionó
- NUNCA preguntes más de UNA cosa por mensaje
- Si el nombre es "Cliente WhatsApp" o null → agenda sin nombre, no lo pidas
- Si el cliente da su nombre espontáneamente → úsalo en agendar_cita como client_name
- Confirmación de cita SIEMPRE incluye precio: "Listo ✅ [servicio] el [fecha] a las [hora] - $[precio]"
- Máximo 2 mensajes para completar un agendamiento
- Si el horario está ocupado → propón alternativas, nunca digas "error" ni "el sistema"

CITAS GRUPALES:
- El nombre de cada persona va como nota en la cita, la cita queda a nombre del cliente principal
- Máximo 5 citas por bloque — si son más, confirma las primeras 5 y luego continúa
- Siempre muestra resumen final con todos los agendamientos exitosos y fallidos
</booking_rules>`;

const OFF_TOPIC_RULES = `<off_topic>
Si el cliente pregunta algo fuera del contexto del negocio (código, preguntas generales, temas ajenos, educación, etc.):
- Puedes responder con naturalidad y ayudar si puedes
- SIEMPRE termina amablemente recordando tu función principal
- Ejemplo de respuesta:
  "Claro, [respuesta a su pregunta]... Pero recuerda que estoy aquí principalmente para ayudarte a agendar citas y resolver dudas sobre nuestros servicios 😊 ¿Necesitas algo?"
- Mantén el tono cálido y natural, no hagas sentir mal al cliente
- Nunca digas "No puedo ayudarte con eso" — siempre intenta ayudar pero redirige
</off_topic>`;

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

function getBusinessSystemPrompt(business, clientInfo = null, businessHours = null) {
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

  return `<identity>
Eres el asistente virtual de ${business.name}.
Atiendes clientes por WhatsApp. Nunca menciones ZITA.
Fecha y hora actual en Colombia: ${now}
Fecha de hoy en Colombia: ${hoyFecha}
Día de hoy en Colombia: ${new Date(hoyFecha + 'T12:00:00-05:00').toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'America/Bogota' })}
Fecha de mañana en Colombia: ${mañanaFecha}
Cuando el cliente diga 'hoy' usa EXACTAMENTE ${hoyFecha}
Cuando el cliente diga 'mañana' usa EXACTAMENTE ${mañanaFecha}
Hora actual en Colombia: ${horaColombia}
IMPORTANTE: Si el cliente pide una cita para HOY a una hora que ya pasó (antes de ${horaColombia}),
responde: "Esa hora ya pasó hoy 😅 ¿Te agendo más tarde? Tengo disponible desde las ${horaColombia}"

Fechas de los próximos días (ÚSALAS EXACTAMENTE cuando el cliente diga un día de la semana):
${calendarioTexto}
Ejemplo: Si el cliente dice "el martes" → usa la fecha de Martes del calendario de arriba
Si hoy ES martes y el cliente dice "el martes" → pregunta: "¿Es para hoy o para el próximo martes [fecha]?"

${clientGreeting}
Idioma: responde SIEMPRE en el mismo idioma que use el cliente.

Horarios de atención:
${horariosTexto}
</identity>

${PERSONALITY_RULES}

${DECISION_TREE_RULES}

${BOOKING_RULES_TEXT}

${OFF_TOPIC_RULES}

<tool_results>
CRÍTICO: Siempre lee el resultado de agendar_cita antes de responder:
- Si el resultado tiene success: true → confirma la cita con precio (SIN mencionar al empleado)
- Si el resultado tiene success: false → NO confirmas la cita, informa el error al cliente
- Si el resultado tiene error → repite el mensaje de error al cliente
- NUNCA confirmes una cita si success no es exactamente true
</tool_results>

<service_search>
- Si el cliente dice algo genérico ("corte", "manicure", "limpieza"):
  → Busca en ver_servicios y muestra solo los 2-3 más relevantes
  → NO muestres toda la lista
- Si dice "ver todo" o "qué servicios tienen":
  → Muestra toda la lista
- Busca por similitud, no exactitud:
  "corte clasico" → "Corte Clásico" ✓
  "manicure" → "Manicure completo" ✓
  "limpieza" → "Limpieza facial" ✓
</service_search>

<servicios_rules>
CRÍTICO - NUNCA inventes servicios ni variantes:
- SOLO puedes mencionar servicios que existan en la base de datos
- NUNCA agregues "Básico", "Avanzado", "Premium", "Clásico" u otras variantes
  a un servicio a menos que el nombre EXACTO del servicio lo incluya
- Si el cliente pide algo similar a un servicio, usa el nombre EXACTO del servicio
- Antes de sugerir servicios, SIEMPRE usa la tool ver_servicios para ver los disponibles
- NUNCA asumas que hay variantes de un servicio

FECHAS:
- Si el cliente dice "hoy", "esta tarde", "ahorita" → fecha = hoy
- NUNCA preguntes "¿cuál día?" si el cliente ya dijo "hoy"
- Si no especifica día → preguntar UNA SOLA VEZ "¿para cuándo?"
</servicios_rules>

<schedule_validation>
Cuando el cliente mencione día u hora, verifica PRIMERO con
verificar_disponibilidad ANTES de pedir más datos.

Si el día está cerrado → informa inmediatamente:
  "Lo siento, los [día] estamos cerrados 😔 ¿Te queda bien otro día?"

Si la hora está fuera de horario → informa:
  "Cerramos a las [hora]. ¿Te agendo antes?"

Si no hay disponibilidad en la fecha/hora pedida:
  → Muestra los próximos 3 slots disponibles del mismo día o días cercanos
  → Pregunta: "¿Te queda bien alguno de estos horarios?"
  → SI el cliente insiste en esa fecha/hora específica y no hay disponibilidad:
    → Ofrece lista de espera: "¿Quieres que te ponga en lista de espera? Si se cancela algo te avisamos 😊"
    → Si acepta → ejecuta lista_espera con fecha, hora y servicio
    → Confirma: "Listo, quedaste en lista de espera. Te contactamos si algo se libera 👍"
</schedule_validation>

<loyalty>
Si el cliente pregunta por puntos, visitas o recompensa:
→ Ejecuta ver_mi_fidelizacion
→ Responde motivador: "¡Ya llevas X visitas! Te faltan Y para tu [recompensa] 🎉"
→ Si ya cumplió: "¡Felicidades! Ya puedes canjear tu [recompensa] 🏆"
</loyalty>

<limits>
- Máximo 3 citas por conversación
- Máximo 5 iteraciones de tools por mensaje
- Si algo falla técnicamente: "Tuve un problemita, ¿puedes intentarlo de nuevo?"
</limits>

<fuera_de_horario>
RESPUESTA FUERA DE HORARIO:
Hora actual del negocio: ${horaColombia}
Horario de atención incluido arriba.

SI la hora actual está FUERA del horario de atención del día de hoy:
  → Responde con calidez que están cerrados
  → Indica a qué hora abren (hoy si es antes de apertura, mañana si ya cerraron)
  → Ofrece agendar de todas formas: "Pero puedo agendarte ahora mismo para cuando estemos abiertos 😊"
  → NO bloquees el agendamiento — el cliente puede agendar fuera de horario para fechas futuras

SI el cliente escribe en horario de atención:
  → Responde normalmente sin mencionar el horario
</fuera_de_horario>

<bienvenida_inteligente>
BIENVENIDA SEGÚN TIPO DE CLIENTE:
${clientInfo?.name && clientInfo.name !== 'Cliente WhatsApp'
  ? `Este cliente YA ES CONOCIDO: ${clientInfo.name}.
     Si saluda o es su primer mensaje → responde: "Hola ${clientInfo.name} 👋 ¿Vuelves a visitarnos? ¿Qué necesitas?"`
  : `Este cliente es NUEVO o desconocido.
     Si saluda o es su primer mensaje → responde: "¡Hola! Bienvenido a ${business.name} 👋 ¿En qué te puedo ayudar? Puedo agendarte una cita o contarte sobre nuestros servicios 😊"`
}
</bienvenida_inteligente>`;
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

  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const systemPrompt = getBusinessSystemPrompt(business, clientInfo, businessHours || []);

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
        required: ['fecha', 'hora']
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
      description: 'Actualizar una cita existente — cambiar empleado, hora o fecha',
      input_schema: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'ID de la cita a actualizar' },
          employee_name: { type: 'string', description: 'Nuevo empleado (opcional)' },
          nueva_fecha: { type: 'string', description: 'Nueva fecha YYYY-MM-DD (opcional)' },
          nueva_hora: { type: 'string', description: 'Nueva hora HH:mm (opcional)' }
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

          const diaSemanaPasado = new Date(toolInput.fecha);
          const colombiaStr = diaSemanaPasado.toLocaleString('en-CA', {
            timeZone: 'America/Bogota',
            hour12: false
          });
          const [datePart] = colombiaStr.split(', ');
          const [year, month, day] = datePart.split('-').map(Number);
          const tempDate = new Date(year, month - 1, day);
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
            const { data: empPref } = await supabaseAdmin
              .from('employees')
              .select('id, name')
              .eq('business_id', businessId)
              .eq('is_active', true)
              .ilike('name', `%${toolInput.employee_name}%`)
              .single();

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
            empleadoDisponible = { id: null, name: 'Sin asignar' };
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
              logger.info('Creando ingreso automático', { precio: servicio.price, fecha: toolInput.fecha });
              await supabaseAdmin
                .from('income')
                .insert({
                  business_id: businessId,
                  amount: servicio.price,
                  category: 'servicios',
                  description: `${servicio.name} - agendado por WhatsApp`,
                  source: 'appointment',
                  appointment_id: data.id,
                  date: toolInput.fecha,
                  client_id: clienteExistente?.id || null
                });
            } catch (incomeErr) {
              logger.error('Error creando ingreso automático:', incomeErr.message);
            }

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

          const { error } = await supabaseAdmin
            .from('appointments')
            .update({ status: 'cancelled' })
            .eq('id', toolInput.appointment_id)
            .eq('business_id', businessId);

          return { success: !error };
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
          const { error } = await supabaseAdmin
            .from('appointments')
            .update({ status: 'confirmed' })
            .eq('id', toolInput.appointment_id)
            .eq('business_id', businessId);

          if (error) return { success: false, error: error.message };
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
            const { data: empData } = await supabaseAdmin
              .from('employees')
              .select('id, name')
              .eq('business_id', businessId)
              .eq('is_active', true)
              .ilike('name', `%${toolInput.employee_name}%`)
              .maybeSingle();

            if (!empData) {
              return { success: false, error: `No encontré ningún empleado con ese nombre.` };
            }

            // Verificar disponibilidad del empleado en el horario de la cita
            const { data: citaActual } = await supabaseAdmin
              .from('appointments')
              .select('scheduled_at, services(duration_minutes)')
              .eq('id', toolInput.appointment_id)
              .single();

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

          if (toolInput.nueva_fecha && toolInput.nueva_hora) {
            updateData.scheduled_at = `${toolInput.nueva_fecha}T${toolInput.nueva_hora}:00-05:00`;
          }

          if (Object.keys(updateData).length === 0) {
            return { success: false, error: 'No hay cambios que aplicar.' };
          }

          const { error } = await supabaseAdmin
            .from('appointments')
            .update(updateData)
            .eq('id', toolInput.appointment_id)
            .eq('business_id', businessId);

          if (error) return { success: false, error: error.message };

          if (toolInput.nueva_fecha || toolInput.nueva_hora) {
            const { data: citaActualizada } = await supabaseAdmin
              .from('appointments')
              .select('service_id, services(price)')
              .eq('id', toolInput.appointment_id)
              .single();

            if (citaActualizada?.services?.price) {
              await supabaseAdmin
                .from('income')
                .update({ amount: citaActualizada.services.price })
                .eq('appointment_id', toolInput.appointment_id)
                .eq('business_id', businessId);
            }
          }

          const empleadoNombre = toolInput.employee_name || null;
          return {
            success: true,
            message: `Cita actualizada correctamente${empleadoNombre ? ` — ahora con ${empleadoNombre}` : ''}.`
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
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
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
        allMessages.push({ role: 'assistant', content: assistantContent });
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
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
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
    const esConfirmacion = ['si', 'sí', 'confirmo', 'confirmado', 'ahí estaré', 'ahi estare', 'voy', 'allá voy', 'alla voy', 'ok', 'okay', 'dale', 'claro', 'por supuesto', 'si voy', 'sí voy'].some(p => msgLower === p || msgLower.startsWith(p + ' ') || msgLower.endsWith(' ' + p));
    const esCancelacion = ['no', 'no puedo', 'cancela', 'cancelar', 'no voy', 'no puedo ir', 'no iré', 'no ire', 'cancela mi cita', 'no asisto'].some(p => msgLower === p || msgLower.startsWith(p + ' '));

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
          .in('status', ['pending', 'confirmed'])
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
