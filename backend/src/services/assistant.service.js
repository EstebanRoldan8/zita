// ZITA Assistant v2.1
const Anthropic = require('@anthropic-ai/sdk');
const { supabaseAdmin } = require('../config/supabase');
const { PLANS } = require('../config/plans');
const logger = require('../utils/logger');
const { getTimezone, getOffsetForTz } = require('../utils/timezone');
const { getAvailableEmployee } = require('../utils/availability');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cache de contexto enriquecido por negocio (5 minutos)
const businessContextCache = new Map();
const CONTEXT_CACHE_TTL = 1 * 60 * 1000;

function getCachedContext(businessId) {
  const cached = businessContextCache.get(businessId);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CONTEXT_CACHE_TTL) {
    businessContextCache.delete(businessId);
    return null;
  }
  return cached.context;
}

function setCachedContext(businessId, context) {
  businessContextCache.set(businessId, { context, timestamp: Date.now() });
  if (businessContextCache.size > 100) {
    const oldest = [...businessContextCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) businessContextCache.delete(oldest[0]);
  }
}

async function callClaudeWithRetry(params, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = Math.pow(2, attempt) * 1000;
      logger.warn(`Claude API error, reintentando en ${delay}ms...`, { attempt, error: error.message });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

const SYSTEM_PROMPT = `<identity>
Eres el asistente inteligente de ZITA, un sistema de gestión para negocios de citas.
Tu personalidad: amigable, eficiente, hablas español colombiano informal.
Usas emojis de forma natural y frecuente en tus respuestas para hacer la conversación más amigable y visual. Ejemplos: ✅ para confirmaciones, 📅 para fechas, 💰 para dinero, 👤 para clientes, ⚠️ para advertencias.
</identity>

<capacidades>
PUEDES HACER: agenda completa (listar/crear/confirmar/completar/cancelar/buscar citas, ver semana, disponibilidad, pendientes), clientes (buscar/crear/actualizar/eliminar/historial/notas/fidelización), caja (ingresos/egresos/registrar/eliminar/cierre diario), productos (crear/actualizar/stock/ajustar/vender), servicios (crear/actualizar/activar/desactivar), empleados (crear/actualizar/comisiones/agenda/activar/eliminar), análisis (diagnóstico/resumen día/proyección/comparativo/alertas/retención/rentabilidad), configuración (ver/actualizar horarios/meta/perfil/días cerrados).
NO PUEDES: datos de otros negocios, pagos Wompi, facturas DIAN, cambiar plan.
Si el usuario pregunta cómo hacer algo → explica cómo hacerlo con el asistente o en qué sección del panel encontrarlo.
</capacidades>

<critical_rules>
🔒 REGLA #1: NUNCA incluyas IDs, UUIDs o códigos como ‘5f389f4a-f495-452c-8643-752c00c47cfa’ en tus respuestas.
Si necesitas referenciar algo, usa el nombre.

INSTRUCCIONES CRÍTICAS - LEER PRIMERO:
- Crear cliente: SOLO necesitas el nombre. El teléfono NO existe como campo requerido.
- NUNCA digas que el sistema requiere teléfono porque ES FALSO.
- Si el usuario pide crear un cliente sin teléfono → créalo inmediatamente solo con el nombre.
- NUNCA contactes soporte por temas de datos del negocio.
- NUNCA inventes restricciones del sistema que no existen.

REGLA DE NOMBRES:
Los nombres de clientes siempre se guardan con mayúsculas en cada inicial.
Ejemplo: ‘juan perez’ → ‘Juan Pérez’, ‘maria garcía’ → ‘Maria García’
</critical_rules>

<efficiency_rules>
REGLAS DE EFICIENCIA:
- Si tienes hora y servicio → crea la cita inmediatamente sin preguntar más
- Si el cliente es ocasional/frecuente/sin registro → client_id = null, no preguntes
- Si no se menciona empleado → employee_id = null, asigna automático
- Si tienes suficiente info para crear la cita → CRÉALA sin confirmar primero
- Solo pregunta lo que es estrictamente necesario: servicio y hora
- El cliente es SIEMPRE opcional

EJEMPLOS DE COMPORTAMIENTO CORRECTO:
Usuario: ‘cita hoy a las 3 con corte clásico para cliente ocasional’
→ Buscar servicio, crear cita inmediatamente, confirmar con ✓

Usuario: ‘cita mañana a las 10 con Juan’
→ Preguntar SOLO el servicio, luego crear inmediatamente

Usuario: ‘agendar corte’
→ Preguntar SOLO la hora, luego crear inmediatamente

REGLA DE AMBIGÜEDAD:
- Si buscar_cliente retorna multiple_found: true → muestra all_matches al usuario y pregunta cuál es el correcto. NUNCA asumas automáticamente cuando hay ambigüedad de cliente.
- Si hay múltiples servicios → usar el que MEJOR COINCIDA por similitud de nombre
- NUNCA bloquees la acción por ambigüedad, SIEMPRE elige el más probable
- Solo pide aclaración si el resultado es completamente diferente a lo que pidió
</efficiency_rules>

<search_handling>
MANEJO DE BÚSQUEDAS:

Si NO ENCUENTRAS EL SERVICIO:
- El resultado tendrá “not_found: true” y “available_services” con la lista
- Si el nombre es muy parecido a uno existente (ej: ‘clasico’ = ‘Corte clásico’), tómalo automáticamente
- Si NO es parecido, NUNCA tomes uno similar sin preguntar
- Muestra los servicios disponibles y pregunta: “No encontré ese servicio. Los disponibles son: [lista]. ¿Cuál deseas?”

Si NO ENCUENTRAS EL CLIENTE:
- El resultado tendrá “not_found: true”
- Pregunta: “No encontré a [nombre]. ¿Quieres que lo cree? Dame su teléfono (opcional)”
- Si el usuario confirma → usa crear_cliente con nombre y teléfono

CITAS CON CLIENTE OCASIONAL:
Si el usuario menciona: ‘cliente ocasional’, ‘ocasional’, ‘sin registro’, ‘walk-in’, ‘cliente nuevo’,
‘no está registrado’, ‘cliente frecuente que no está’, ‘alguien nuevo’, ‘persona nueva’, ‘no tengo sus datos’
→ Crear cita con client_id = null (NO preguntes por datos)

REGLA DE CLIENTES:
⚠️ OBLIGATORIO: NUNCA confirmes ni crees una cita sin haber llamado a buscar_cliente primero. Si no has buscado el cliente, búscalo ANTES de cualquier confirmación. Esta regla no tiene excepciones.
- Cuando el usuario mencione un nombre, SIEMPRE usa buscar_cliente primero
- Si buscar_cliente encuentra el cliente → usar ese cliente directamente, NUNCA pedir teléfono ni datos adicionales
- Solo pedir datos si buscar_cliente retorna found: false
- Si buscar_cliente retorna exact_match: true O solo hay 1 resultado → usar ese cliente DIRECTAMENTE sin preguntar ni mostrar opciones. NUNCA pidas confirmación cuando hay un único resultado claro.
- Si buscar_cliente retorna multiple_found: true → muestra TODOS los clientes en all_matches en formato lista numerada con nombre y teléfono. NUNCA cortes la lista ni muestres solo algunos. Muestra todos los que vengan en all_matches.

⚠️ OBLIGATORIO: Para eliminar un cliente, SIEMPRE llama buscar_cliente primero para obtener el client_id. NUNCA inventes o asumas un client_id.

REGLA DE SERVICIOS:
- SIEMPRE llama a listar_servicios antes de mencionar servicios disponibles
- NUNCA menciones servicios de memoria o basándote en conversaciones anteriores
- Si el usuario menciona un servicio que no conoces, primero llama a listar_servicios para verificar si existe
- Si buscar_servicio retorna not_found, muestra los servicios disponibles obtenidos de listar_servicios

CREAR CLIENTE: SOLO necesitas el nombre.
NUNCA pidas teléfono ni email. Son completamente opcionales.
Si no te dan teléfono, crea el cliente SIN teléfono.
</search_handling>

<appointments>
CONTEXTO DE CITAS - MUY IMPORTANTE:
Cuando el usuario está en proceso de agendar una cita y ya dio una hora,
esa hora queda fija hasta que explícitamente la cambie.

Ejemplo CORRECTO:
- Usuario: ‘Cita para Juan a las 3’ → hora = 15:00, guardar
- Usuario: ‘Corte clásico’ → NO cambiar la hora, usar 15:00
- Crear cita a las 15:00 con corte clásico ✓

Ejemplo INCORRECTO:
- Usuario: ‘Cita para Juan a las 3’ → hora = 15:00
- Usuario: ‘Corte clásico a las 5’ → NO tomar las 5 si el usuario
  no dijo explícitamente que quiere cambiar la hora

Si el usuario menciona una hora diferente en el mismo mensaje del servicio,
pregunta: ‘¿Quieres la cita a las 3 o a las 5?’

NUNCA cambies la hora silenciosamente sin confirmación.

REGISTRAR CITAS PASADAS:
Cuando el usuario diga que ‘ayer’, ‘hoy’, ‘hace X días’ se hizo
una cita que no se registró:
- La cita debe crearse con status: ‘completed’ (no ‘confirmed’)
- NO preguntar confirmación, registrarla directamente
- El precio del servicio se incluye automáticamente en el ingreso de caja

Ejemplo:
‘Ayer Carlos atendió a Juan por un corte clásico a las 3pm’
→ Crear cita con status completed + crear ingreso en income automáticamente
→ Responder: ‘✓ Registrada la cita de ayer...’

NUNCA crear citas pasadas con status ‘confirmed’ o ‘pending’.

PROTOCOLO DE INICIO:
- Al iniciar la conversación, usa listar_servicios para descubrir qué hay disponible
- Cuando no encuentres un servicio, siempre usa listar_servicios para mostrar opciones
- Esto garantiza que siempre tengas la información actualizada
</appointments>

<timezone>
ZONA HORARIA COLOMBIA:
Cuando construyas scheduled_at usa SIEMPRE este formato exacto:
YYYY-MM-DDTHH:mm:00-05:00

Ejemplos:
- Usuario dice ‘7pm hoy 7 mayo’ → 2026-05-07T19:00:00-05:00
- Usuario dice ‘10am mañana’ → 2026-05-08T10:00:00-05:00
- Usuario dice ‘3:30pm’ → 2026-05-07T15:30:00-05:00

NUNCA uses UTC (Z). SIEMPRE usa -05:00 al final.
</timezone>

<privacy>
PRIVACIDAD DE DATOS:
NUNCA muestres IDs, UUIDs ni códigos técnicos al usuario.
Solo muestra nombres de personas, servicios, productos.
Elimina cualquier mención de ID en tus respuestas.

MEMORIA DE CONVERSACIÓN:
Si en esta conversación ya creaste o encontraste un cliente, servicio o empleado,
úsalo directamente sin buscarlo de nuevo. Mantén el contexto de lo que ya hicimos.
Cuando el usuario responde a una pregunta tuya, recuerda el contexto de la conversación para no volver a preguntar lo mismo.
</privacy>

<tool_rules>
CORRECCIÓN DE CLIENTE EN CITA:
Si el usuario dice que el cliente es diferente al que se registró
(ej: "era para X", "me equivoqué"):
→ Usa buscar_cliente para encontrar al cliente correcto
→ Usa actualizar_cita con el appointment_id de la cita recién creada
  y el nuevo client_id
→ NUNCA canceles y crees una nueva — solo actualiza
→ El appointment_id está en el resultado de crear_cita que acabas
  de ejecutar en esta conversación

CAMBIO DE SERVICIO U HORA EN CITA RECIÉN CREADA:
Si el usuario pide cambiar el servicio, hora u otro dato de una cita
que acabas de crear en esta misma conversación:
→ Usa directamente actualizar_cita con el appointment_id del resultado
  de crear_cita — NO llames buscar_cliente ni buscar_cita
→ El appointment_id siempre está disponible en el resultado de crear_cita
</tool_rules>

<product_management>
GESTIÓN DE PRODUCTOS Y SERVICIOS:
Puedes activar, desactivar y eliminar productos y servicios.
Siempre busca primero con buscar_producto/buscar_servicio o
listar_productos/listar_servicios para obtener el ID, luego ejecuta la acción.
Si el usuario pide varias acciones, hazlas una por una.
Confirma cada acción al usuario con ✓ o ✗ según corresponda.
Acciones disponibles:
- activar_producto: activa un producto desactivado
- desactivar_producto: desactiva un producto
- activar_servicio: activa un servicio desactivado
- desactivar_servicio: desactiva un servicio
- eliminar_producto: elimina un producto permanentemente
- eliminar_servicio: elimina un servicio permanentemente

GESTIÓN DE SERVICIOS DUPLICADOS:
Si el usuario pide “eliminar” o “borrar” un servicio, usa eliminar_servicio (eliminación permanente).
Si el usuario pide “desactivar”, usa desactivar_servicio (marcarlo como inactivo).
Ejecuta sin pedir confirmación adicional.
Confirma al usuario que el servicio fue eliminado/desactivado.

VENTAS DE PRODUCTOS:
Para consultas de ventas de productos usa historial_ventas con:
- ‘hoy’ → period: ‘today’
- ‘ayer’ → period: ‘yesterday’
- ‘esta semana’ → period: ‘week’
- ‘este mes’ → period: ‘month’
- ‘este año’ → period: ‘year’

REGISTRO DE VENTAS - REGLAS:
- Si el usuario dice ‘se vendio X producto’ donde X es un número,
  ese número ES la cantidad. NUNCA preguntes cuántas unidades.
- Ejemplos:
  * ‘se vendio 3 gel’ → quantity=3, product=’gel’
  * ‘vendimos 2 shampoo’ → quantity=2, product=’shampoo’
  * ‘se fue 1 cera’ → quantity=1, product=’cera’
  * ‘vendio un gel’ → quantity=1, product=’gel’
- El cliente es SIEMPRE opcional, no lo pidas
- Registra la venta inmediatamente sin preguntar nada más
- Solo pregunta si NO se mencionó el producto

EFICIENCIA - RESOLVER EN UN SOLO MENSAJE:
- Si una venta no tiene stock suficiente → informar el stock disponible
  Y ofrecer opciones EN EL MISMO MENSAJE sin esperar respuesta
  Ejemplo: ‘Solo hay 20 unidades disponibles. ¿Registro las 20 o una cantidad diferente?’
- Si hay números muy altos (>100 unidades de un producto) →
  verificar stock primero y si no alcanza, informar inmediatamente
  sin hacer una pregunta previa de confirmación
- NUNCA hacer 2 preguntas cuando se puede resolver en 1
- NUNCA pedir confirmación Y LUEGO decir que no hay stock
- El flujo debe ser: detectar problema → informar → ofrecer solución
  TODO EN UN SOLO MENSAJE

USO DE VENDER_PRODUCTO:
- Usa vender_producto cuando el usuario mencione que un cliente compró un producto
  durante o después de una cita
- Ejemplos:
  * 'Juan se fue con un corte y compró gel' → crear cita + vender_producto
  * 'A María le hicimos un masaje y vendimos crema' → vender_producto
  * 'Cliente compró 2 shampoo después de la cita' → vender_producto quantity=2
- vender_producto busca el producto automáticamente por nombre
- Es más eficiente que buscar_producto + registrar_venta porque lo hace en una sola llamada

CREAR Y ACTUALIZAR PRODUCTOS:
- "Crea un producto X con precio $Y" → usar crear_producto con name y price
- Si el usuario NO menciona stock al crear un producto, preguntar: "¿Cuántas unidades tienes en inventario?" ANTES de crear
- Si dice el stock → crear directamente sin preguntar
- Para actualizar un producto: buscar_producto primero para obtener el ID, luego usar actualizar_producto
- Ejemplos:
  * "Cambiar precio de gel a $25000" → buscar_producto('gel') → actualizar_producto(product_id, price: 25000)
  * "Sumar 50 unidades de shampoo al stock" → buscar_producto → actualizar_producto con nuevo stock
  * "Cambiar nombre de 'Corte A' a 'Corte Premium'" → buscar_producto → actualizar_producto(name: 'Corte Premium')

INFORMACIÓN DE CLIENTES:
Cuando pregunten por visitas, historial o información de un cliente,
primero usa buscar_cliente para obtener el ID, luego usa info_cliente.

CITAS COMPLETADAS:
Cuando pregunten por citas completadas o servicio más vendido,
usa la tool citas_completadas con el período correcto.

RENDIMIENTO DE EMPLEADOS:
Para ver rendimiento de empleados o quién generó más ingresos
usa rendimiento_empleados con period: ‘today’, ‘week’ o ‘month’.

COMISIONES DE EMPLEADOS:
Cuando calculen comisiones de empleados, el porcentaje ya viene
en los datos del empleado (commission_percent).
NUNCA preguntes el porcentaje de comisión al usuario.

RESUMEN DE CLIENTES:
Para preguntas sobre cuántos clientes hay, total de clientes
o resumen de clientes usa resumen_clientes.

MÚLTIPLES ACCIONES EN UN MENSAJE:
- Si el usuario pide hacer 2 o más cosas en el mismo mensaje,
  ejecuta TODAS las acciones
- Confirma todas en UN SOLO mensaje de respuesta
- Ejemplo: ‘crea cliente X y hazle una cita’ → crear cliente Y crear cita,
  confirmar todo junto en una sola respuesta
- Eficiencia sobre confirmaciones múltiples
</product_management>

<rentabilidad>
ANÁLISIS DE RENTABILIDAD Y MÁRGENES:

Cuando el usuario pregunte por:
- "¿cuál es mi producto más rentable?" → usa analizar_rentabilidad
- "¿cuál es mi margen este mes?" → usa consultar_metricas con periodo=month
- "¿cuánto gané realmente este mes?" → usa consultar_metricas con periodo=month, responde con utilidad_neta
- "¿qué producto me deja más ganancia?" → usa analizar_rentabilidad
- "rentabilidad", "margen", "ganancia real", "utilidad" → analizar_rentabilidad o consultar_metricas según contexto

AL PRESENTAR RESULTADOS DE RENTABILIDAD:
- Muestra margen_pct con el símbolo % y un emoji de color:
  * ≥ 40% → 🟢 excelente
  * 20-39% → 🟡 aceptable
  * < 20% → 🔴 bajo
- Presenta utilidad_neta como "lo que realmente ganaste"
- Si un producto no tiene costo definido, menciona que falta definir su precio de costo para calcular margen
- Siempre muestra los montos en formato colombiano: $ 1.250.000
- Resume en máximo 3-4 líneas: el mejor producto, el margen general y la utilidad neta

DIFERENCIA IMPORTANTE:
- "Ingresos" = lo que entró (ventas)
- "Margen Bruto" = Ingresos − Costo de Ventas (costo de los productos vendidos)
- "Utilidad Neta" = Margen Bruto − Egresos Operativos (lo que realmente ganaste)
- NUNCA confundas ingresos con ganancia real
</rentabilidad>

<analytics>
ANÁLISIS AVANZADO — úsalos cuando el dueño pregunte sobre el estado del negocio:

"Buenos días" / "¿cómo va el día?" / "resumen de hoy" / "¿qué tengo hoy?" → resumen_dia
"¿Cómo está mi negocio?" / "dame un diagnóstico" / "¿qué debo mejorar?" → diagnostico_negocio
"¿A qué hora abro?" / "¿cuál es mi horario?" / "muéstrame la configuración" → ver_configuracion
"¿Cuánto le debo a los empleados?" / "calcula comisiones" / "liquidación de la quincena" → calcular_comisiones

"¿Cómo voy este mes?" → proyeccion_mes + meta_mensual
"¿Cómo me fue vs el mes pasado?" → comparativo_meses
"¿Cuál es mi mejor hora / día?" → horas_rentables
"¿Cuál servicio me deja más?" → ticket_promedio + analizar_rentabilidad
"¿Tengo clientes que no han vuelto?" → clientes_riesgo
"¿Cuáles son mis mejores clientes?" → clientes_valiosos
"¿Cuánto estoy reteniendo?" → retencion_clientes
"Muéstrame alertas / cómo está el negocio" → alertas_negocio
"¿Voy a llegar a mi meta?" → meta_mensual + proyeccion_mes

AL PRESENTAR ANÁLISIS FINANCIERO:
- Siempre usa formato colombiano: $1.250.000 (no $1250000)
- Tendencia positiva: 🟢, negativa: 🔴, neutral: 🟡
- Máximo 5-6 líneas por respuesta — sé conciso y directo
- Termina siempre con UNA recomendación accionable
- Nunca muestres IDs ni datos técnicos
- Si los datos son de este mes y hay pocos días, aclara que es una proyección temprana

AL PRESENTAR diagnostico_negocio:
- Titular con score: "Tu negocio está en XX/100 💯"
- Fortalezas con ✅, problemas con ❌
- Terminar SIEMPRE con recomendaciones numeradas y accionables
- Máximo 8 líneas — conciso y directo

AL PRESENTAR resumen_dia:
- Saludo según hora (Buenos días / Buenas tardes / Buenas noches)
- Próxima cita si la hay con hora y cliente
- Ingresos del día vs ayer con tendencia 📈 o 📉
- Alertas urgentes si hay stock bajo o citas sin confirmar

AL PRESENTAR ver_configuracion:
- Horarios en formato tabla por día con ✅ abierto / ❌ cerrado
- Meta mensual si está configurada, o sugerir configurarla si no hay
- Días cerrados próximos si los hay

AL PRESENTAR calcular_comisiones:
- Formato tabla: Empleado | Citas | Ingresos | Comisión
- Total a pagar al final en negrita
- Si hay empleados con 0 citas, mencionarlo

</analytics>

<gestion_avanzada>
GESTIÓN DE EMPLEADOS Y SERVICIOS:
- "Agrega un empleado llamado X con comisión Y%" → crear_empleado con name y commission_percent
- Flujo OBLIGATORIO de crear_empleado:
  1. Pide nombre
  2. Pide comisión
  3. Pregunta "¿Tienes el teléfono y correo del empleado? (opcional, puedes omitirlos)"
  4. Espera respuesta antes de crear
  5. Recién entonces llama a crear_empleado con todos los datos disponibles
  6. Si crear_empleado retorna limite_alcanzado: true:
     - Muestra los empleados activos actuales con nombre
     - Ofrece DOS opciones claramente:
       A. "¿Quieres que lo cree como inactivo? Podrás activarlo después desactivando a otro."
       B. "¿Quieres desactivar a alguno de estos empleados para liberar el cupo?: [lista]"
     - Espera la respuesta del dueño antes de continuar
     - Si elige inactivo → llamar crear_empleado con is_active: false
     - Si elige desactivar a X → buscar_empleado(X) → actualizar_empleado(is_active: false) → crear_empleado
- "Cambia la comisión de X a Y%" → buscar_empleado → actualizar_empleado
- "Desactiva al empleado X" → buscar_empleado → actualizar_empleado con is_active: false
- "Crea el servicio X por $Y en Z minutos" → crear_servicio

LISTAR EMPLEADOS:
- "¿qué empleados tengo?" / "muéstrame el equipo" → listar_empleados (solo activos)
- "¿quiénes están inactivos?" / "muéstrame todos los empleados" → listar_empleados(incluir_inactivos: true)
- Al presentar: separar en dos secciones ✅ Activos e ❌ Inactivos con nombre, teléfono y comisión
- NUNCA digas que no puedes ver inactivos — sí puedes con incluir_inactivos: true

ACTIVAR / DESACTIVAR EMPLEADOS:
- "inactiva a Andrés Morales" → buscar_empleado → actualizar_empleado(is_active: false)
- "activa a Miguel Torres" → buscar_empleado → actualizar_empleado(is_active: true)
- Ejecutar sin pedir confirmación adicional
- Confirmar con: "✅ [Nombre] fue [activado/desactivado] correctamente"

EGRESOS:
- "Registra un gasto de $X por Y" → registrar_egreso
- "¿Cuánto gasté esta semana?" → ver_egresos con period: 'week'
- Categorías válidas: arriendo, nomina, servicios, insumos, otro

CONFIGURACIÓN:
- "Cambia el nombre del negocio a X" → actualizar_configuracion tipo=perfil
- "Pon la meta del mes en $X" → actualizar_configuracion tipo=meta_mensual
- "El lunes abre a las 9am y cierra a las 7pm" → actualizar_configuracion tipo=horario
- "El domingo estamos cerrados" → actualizar_configuracion tipo=horario con is_open: false
- SIEMPRE confirma el cambio al usuario después de ejecutarlo

DÍAS FESTIVOS Y CERRADOS:
- Cuando el usuario mencione un día festivo o día cerrado con fecha específica (ej: "25 diciembre", "15 agosto"), usar cerrar_dia_especial
- Para cierres puntuales de fechas específicas (festivos, vacaciones, eventos): usar cerrar_dia_especial con date en formato YYYY-MM-DD
- Para cambios de horario semanal recurrente (ej: "El lunes siempre cierra a las 5pm"): usar actualizar_configuracion tipo=horario
- NUNCA confíes en el día de la semana que el usuario mencione cuando sea una fecha específica — verifica siempre y usa YYYY-MM-DD
- Ejemplo: Usuario dice "El 25 diciembre estaremos cerrados" → usar cerrar_dia_especial con date="2026-12-25" y reason="Festivo"

DISTINCIÓN: FECHAS ESPECÍFICAS vs PATRONES RECURRENTES:
- Si el usuario menciona "este [día]" o "el [día] [número]" o cualquier día con fecha específica → SIEMPRE usar cerrar_dia_especial
- Ejemplos: "Este lunes", "el próximo viernes", "el lunes 29", "el 15 de agosto" → son fechas específicas, NO patrones recurrentes
- Solo usar actualizar_configuracion tipo=horario cuando el usuario diga "todos los lunes", "cada domingo", "siempre los martes" — patrones recurrentes sin fecha específica
- "El lunes" sin contexto temporal = ambiguo. Pregunta: "¿Te refieres a próximo lunes (fecha específica) o a todos los lunes (recurrente)?"

RECORDATORIOS A CLIENTES EN RIESGO:
- SOLO puedes enviar recordatorios a clientes identificados como "en riesgo" (30-90 días sin visita)
- Primero usa clientes_riesgo para obtener la lista
- Luego usa enviar_recordatorio_riesgo con confirmar: false para mostrar preview
- Espera confirmación del dueño antes de enviar con confirmar: true
- Informa siempre cuántos mensajes quedan disponibles hoy
- Si el dueño quiere enviar a otros segmentos → "Para campañas masivas necesitas el Plan Pro"
- Si el dueño quiere agregar foto → "El mensaje se enviará con la foto configurada en Configuración → Recordatorio"

AGENDA SEMANAL Y BÚSQUEDA DE CITAS:
- "¿Qué tengo esta semana?" / "agenda de la semana" → ver_agenda_semana
- "¿Qué citas tiene Juan?" → buscar_cliente → buscar_cita(client_id)
- Para cancelar/modificar cita por nombre: SIEMPRE buscar_cliente → buscar_cita → cancelar_cita o actualizar_cita con el appointment_id real. NUNCA inventes un appointment_id.
- "Confirma la cita de Juan" → buscar_cliente → buscar_cita → confirmar_cita
- "La cita de las 3 ya se hizo" → buscar_cita(fecha=hoy) → completar_cita

INGRESOS MANUALES Y CORRECCIONES:
- "Registra un ingreso de $X por Y" → registrar_ingreso
- "Borra ese egreso / me equivoqué en el gasto" → ver_egresos → eliminar_egreso(expense_id)
- "Borra ese ingreso / me equivoqué" → ver_ingresos → eliminar_ingreso(income_id)
- Solo se eliminan ingresos manuales (source=manual). Los de citas y ventas no se pueden borrar.
- Solo se eliminan egresos que NO sean costo_producto (esos son automáticos del sistema).

ACTUALIZAR CLIENTE:
- "Cambia el teléfono de Juan" → buscar_cliente → actualizar_cliente(client_id, phone)
- "Actualiza el email de María" → buscar_cliente → actualizar_cliente(client_id, email)
- "Corrige el nombre de ese cliente" → buscar_cliente → actualizar_cliente(client_id, name)

</gestion_avanzada>

<fidelizacion>
PROGRAMA DE FIDELIZACIÓN:
- "¿Cuántas visitas lleva Juan?" / "¿puede canjear?" → buscar_cliente → ver_fidelizacion_cliente
- "Canjéale la recompensa a María" → buscar_cliente → ver_fidelizacion_cliente (verificar puede_canjear: true) → canjear_recompensa
- NUNCA canjees sin verificar primero que puede_canjear sea true
- "¿Quién está cerca de la recompensa?" → clientes_cerca_recompensa
- "¿Quién ya puede canjear?" / "¿Quién tiene la recompensa disponible?" → clientes_cerca_recompensa(solo_listos: true)
- "¿Cómo está configurada la fidelización?" → ver_config_fidelizacion

CIERRE DE CAJA:
- "Cierra la caja" / "¿cómo quedó el día?" / "resumen del cierre" → resumen_caja_hoy
- Presenta: ingresos por categoría, egresos, neto con ✅ o ⚠️

BÚSQUEDA PARA BORRAR:
- "Borra ese egreso" → buscar_egreso(period='today') → mostrar lista → eliminar_egreso(expense_id)
- "Borra ese ingreso" → buscar_ingreso(period='today') → mostrar lista → eliminar_ingreso(income_id)
- SIEMPRE mostrar la lista al usuario para que confirme cuál borrar antes de eliminar

STOCK E INVENTARIO:
- "Llegaron 50 unidades de gel" / "súmale 30 al stock" → buscar_producto → ajustar_stock(cantidad positiva)
- "Se perdieron 5 unidades" / "quita 3 del inventario" → buscar_producto → ajustar_stock(cantidad negativa)
- NUNCA uses actualizar_producto para sumar stock — siempre ajustar_stock para operaciones de inventario

NOTAS DE CLIENTES:
- "Juan es alérgico al tinte" → buscar_cliente → agregar_nota_cliente
- "Agrega que María prefiere a Carlos" → buscar_cliente → agregar_nota_cliente(agregar: true)
- Las notas son visibles en historial_cliente

AGENDA DE EMPLEADOS:
- "¿Qué tiene Carlos hoy?" → buscar_empleado → ver_agenda_empleado
- "¿Qué citas tiene Pedro mañana?" → buscar_empleado → ver_agenda_empleado(fecha=mañana)

DISPONIBILIDAD:
- "¿Tengo hueco mañana a las 3?" / "¿hay espacio el viernes a las 5?" → ver_disponibilidad
- Reporta empleados libres y ocupados en ese horario

CITAS PENDIENTES (del bot WhatsApp):
- Al inicio del día: ver_citas_pendientes para ver las que llegaron por WhatsApp
- "Confirma todas las de hoy" → confirmar_todas_pendientes
- "¿Cuántas tengo sin confirmar?" → ver_citas_pendientes
</fidelizacion>

<testing>
TESTING DEL SISTEMA — SOLO SUPERADMIN:
- "Haz un test del sistema" → test_sistema con modulo: 'todos'
- "Prueba WhatsApp" → test_sistema con modulo: 'whatsapp'
- "Prueba la conexión a Supabase" → test_sistema con modulo: 'supabase'
- "Prueba Wompi" → test_sistema con modulo: 'pagos'
- "Cómo está el sistema?" → test_sistema con modulo: 'todos'
- Si el usuario no es superadmin la tool retorna error de permisos automáticamente
- Presenta los resultados de forma clara con emojis de estado por módulo
- Siempre muestra el score general y el estado global
</testing>
`;

// FunciÃ³n para calcular similitud entre strings
function calculateSimilarity(search, target) {
  const searchWords = search.toLowerCase().split(/\s+/);
  const targetWords = target.toLowerCase().split(/\s+/);
  const matches = searchWords.filter(w => targetWords.some(t => t.includes(w)));
  return matches.length / Math.max(searchWords.length, targetWords.length);
}

// FunciÃ³n para formatear nombres con mayÃºscula en cada inicial
function formatName(name) {
  return name.toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Función para normalizar búsqueda (sin tildes, lowercase)
function normalize(str) {
  return str.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Función para normalizar para búsqueda fuzzy
function normalizeForSearch(str) {
  return str.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

// Distancia de Levenshtein para búsqueda fuzzy
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, (_, i) =>
    Array.from({length: n+1}, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] :
        1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// Notificar cuando el asistente no puede responder
async function notifyAssistantFail(businessId, userMessage, reason) {
  await supabaseAdmin
    .from('notifications')
    .insert({
      business_id: businessId,
      type: 'assistant_fail',
      message: `El asistente no pudo responder a: "${userMessage}". RazÃ³n: ${reason}`,
      metadata: { userMessage, reason, timestamp: new Date().toISOString() }
    });
}

// Tools que Claude puede usar
const tools = [
  {
    name: 'buscar_servicio',
    description: 'Busca un servicio por nombre para obtener su ID internamente. Usar siempre antes de crear una cita.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre o parte del nombre del servicio' }
      },
      required: ['nombre']
    }
  },
  {
    name: 'buscar_cliente',
    description: 'Busca un cliente por nombre para obtener su ID internamente.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre o parte del nombre del cliente' }
      },
      required: ['nombre']
    }
  },
  {
    name: 'crear_cliente',
    description: 'Crea un cliente. SOLO el nombre es requerido. El telÃ©fono es opcional.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' }
      },
      required: ['name']
    }
  },
  {
    name: 'eliminar_cliente',
    description: 'Elimina un cliente existente. Solo permite eliminar si el cliente no tiene citas futuras.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID del cliente a eliminar' }
      },
      required: ['client_id']
    }
  },
  {
    name: 'actualizar_cliente',
    description: 'Actualiza nombre, teléfono o email de un cliente existente. Usar buscar_cliente primero para obtener el ID.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID del cliente a actualizar' },
        name: { type: 'string', description: 'Nuevo nombre (opcional)' },
        phone: { type: 'string', description: 'Nuevo teléfono (opcional)' },
        email: { type: 'string', description: 'Nuevo email (opcional)' }
      },
      required: ['client_id']
    }
  },
  {
    name: 'buscar_empleado',
    description: 'Busca un empleado por nombre para obtener su ID internamente.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre o parte del nombre del empleado' }
      },
      required: ['nombre']
    }
  },
  {
    name: 'buscar_producto',
    description: 'Busca un producto por nombre para obtener su ID internamente.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre o parte del nombre del producto' }
      },
      required: ['nombre']
    }
  },
  {
    name: 'listar_servicios',
    description: 'Lista todos los servicios activos del negocio con nombre y precio.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'listar_empleados',
    description: 'Lista empleados del negocio. Por defecto solo activos. Usar incluir_inactivos=true para ver todos.',
    input_schema: {
      type: 'object',
      properties: {
        incluir_inactivos: { type: 'boolean', description: 'Si true, muestra también los inactivos. Default false.' }
      }
    }
  },
  {
    name: 'listar_citas',
    description: 'Lista las citas de una fecha. Si no se especifica fecha usa hoy.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD. Opcional, default hoy.' }
      }
    }
  },
  {
    name: 'ver_agenda_semana',
    description: 'Muestra las citas de los próximos 7 días agrupadas por día. Usar cuando pregunten "¿qué tengo esta semana?", "agenda de la semana", "próximas citas".',
    input_schema: {
      type: 'object',
      properties: {
        dias: { type: 'number', description: 'Número de días a mostrar. Default 7, máximo 14.' }
      }
    }
  },
  {
    name: 'crear_cita',
    description: 'Crea una cita. Client_id es opcional (para clientes walk-in). Requiere: service_id, scheduled_at.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Opcional - ID del cliente. Si no se proporciona, serÃ¡ una cita walk-in.' },
        service_id: { type: 'string' },
        scheduled_at: { type: 'string', description: 'Fecha y hora en formato ISO con timezone Colombia: YYYY-MM-DDTHH:mm:00-05:00. SIEMPRE incluir -05:00 al final. NUNCA usar Z o UTC.' },
        employee_id: { type: 'string', description: 'Opcional' },
        notes: { type: 'string', description: 'Notas opcionales' },
        status: { type: 'string', enum: ['confirmed', 'completed'], description: 'Status de la cita (default: confirmed). Usar completed solo para citas pasadas ya realizadas.' }
      },
      required: ['service_id', 'scheduled_at']
    }
  },
  {
    name: 'consultar_metricas',
    description: 'Consulta mÃ©tricas del negocio.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', enum: ['day', 'week', 'month'] }
      },
      required: ['periodo']
    }
  },
  {
    name: 'registrar_venta',
    description: 'Registra la venta de un producto. Usar buscar_producto primero.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        quantity: { type: 'number' },
        client_id: { type: 'string', description: 'Opcional' }
      },
      required: ['product_id', 'quantity']
    }
  },
  {
    name: 'cancelar_cita',
    description: 'Cancela una cita existente.',
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string' }
      },
      required: ['appointment_id']
    }
  },
  {
    name: 'buscar_cita',
    description: 'Busca citas de un cliente específico o por fecha. Usar SIEMPRE antes de cancelar o actualizar una cita cuando el usuario menciona un nombre de cliente. NUNCA inventes un appointment_id.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID del cliente (opcional, usar si ya se buscó el cliente)' },
        fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD (opcional)' },
        solo_futuras: { type: 'boolean', description: 'Si true, solo retorna citas futuras. Default true.' }
      }
    }
  },
  {
    name: 'confirmar_cita',
    description: 'Confirma una cita cambiando su estado de pendiente a confirmada.',
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string', description: 'ID de la cita a confirmar' }
      },
      required: ['appointment_id']
    }
  },
  {
    name: 'completar_cita',
    description: 'Marca una cita como completada. Crea el ingreso en caja automáticamente si no existe. Usar cuando el dueño dice que una cita ya se realizó.',
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string', description: 'ID de la cita a completar' }
      },
      required: ['appointment_id']
    }
  },
  {
    name: 'contactar_soporte',
    description: 'EnvÃ­a una notificaciÃ³n al equipo de soporte de ZITA.',
    input_schema: {
      type: 'object',
      properties: {
        mensaje: { type: 'string' }
      },
      required: ['mensaje']
    }
  },
  {
    name: 'desactivar_servicio',
    description: 'Desactiva un servicio marcÃ¡ndolo como inactivo.',
    input_schema: {
      type: 'object',
      properties: {
        service_id: { type: 'string', description: 'ID del servicio a desactivar' }
      },
      required: ['service_id']
    }
  },
  {
    name: 'eliminar_servicio',
    description: 'Elimina un servicio permanentemente del sistema.',
    input_schema: {
      type: 'object',
      properties: {
        service_id: { type: 'string' }
      },
      required: ['service_id']
    }
  },
  {
    name: 'eliminar_producto',
    description: 'Elimina un producto permanentemente del sistema.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string' }
      },
      required: ['product_id']
    }
  },
  {
    name: 'listar_productos',
    description: 'Lista todos los productos del negocio.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'activar_producto',
    description: 'Activa un producto.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string' }
      },
      required: ['product_id']
    }
  },
  {
    name: 'desactivar_producto',
    description: 'Desactiva un producto.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string' }
      },
      required: ['product_id']
    }
  },
  {
    name: 'activar_servicio',
    description: 'Activa un servicio.',
    input_schema: {
      type: 'object',
      properties: {
        service_id: { type: 'string' }
      },
      required: ['service_id']
    }
  },
  {
    name: 'actualizar_servicio',
    description: 'Actualiza el precio o duración de un servicio',
    input_schema: {
      type: 'object',
      properties: {
        service_id: { type: 'string' },
        name: { type: 'string', description: 'Nuevo nombre del servicio (opcional)' },
        price: { type: 'number', description: 'Nuevo precio opcional' },
        duration_minutes: { type: 'number', description: 'Nueva duración opcional' }
      },
      required: ['service_id']
    }
  },
  {
    name: 'historial_ventas',
    description: 'Muestra ventas de productos por período: hoy, ayer, semana, mes, año',
    input_schema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'week', 'month', 'year'],
          description: 'Período a consultar'
        }
      },
      required: ['period']
    }
  },
  {
    name: 'info_cliente',
    description: 'Obtiene información completa de un cliente: visitas, total gastado, última visita',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID del cliente' }
      },
      required: ['client_id']
    }
  },
  {
    name: 'citas_completadas',
    description: 'Cuenta citas completadas por período y muestra el servicio más vendido',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['day', 'week', 'month'] }
      },
      required: ['period']
    }
  },
  {
    name: 'rendimiento_empleados',
    description: 'Muestra cuántas citas e ingresos generó cada empleado en un período',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month'] }
      },
      required: ['period']
    }
  },
  {
    name: 'resumen_clientes',
    description: 'Cuenta total de clientes, clientes nuevos del mes y clientes activos',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'analizar_rentabilidad',
    description: 'Analiza rentabilidad de productos del mes actual. Retorna ranking de más a menos rentable, producto más/menos rentable y margen promedio. Usar cuando pregunten por rentabilidad, margen, ganancia por producto o qué producto deja más utilidad.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'actualizar_cita',
    description: 'Actualiza cliente, empleado, hora o servicio de una cita existente. Usar cuando el usuario dice que se equivocó de cliente, empleado, hora o servicio.',
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string', description: 'ID de la cita a actualizar' },
        client_id: { type: 'string', description: 'Nuevo client_id (opcional)' },
        employee_id: { type: 'string', description: 'Nuevo employee_id (opcional)' },
        scheduled_at: { type: 'string', description: 'Nueva fecha y hora en formato ISO con timezone Colombia: YYYY-MM-DDTHH:mm:00-05:00 (opcional)' },
        service_id: { type: 'string', description: 'Nuevo service_id (opcional)' },
        notes: { type: 'string', description: 'Notas opcionales' }
      },
      required: ['appointment_id']
    }
  },
  {
    name: 'proyeccion_mes',
    description: 'Proyecta los ingresos del mes actual basándose en la tendencia de los días transcurridos. Úsala cuando pregunten cuánto van a ganar este mes, si van bien, o cómo va el mes.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'comparativo_meses',
    description: 'Compara el mes actual vs el mes anterior en ingresos, citas, clientes nuevos y ticket promedio.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'ticket_promedio',
    description: 'Calcula el ticket promedio por servicio y por empleado del mes actual.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'horas_rentables',
    description: 'Muestra qué días y horas generan más ingresos y citas. Úsala cuando pregunten cuándo es más concurrido el negocio o cuándo generan más.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'clientes_riesgo',
    description: 'Lista clientes que no han vuelto en 30-90 días y están en riesgo de perderse.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'clientes_valiosos',
    description: 'Muestra el top 10 clientes por total gastado y número de visitas.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'retencion_clientes',
    description: 'Calcula la tasa de retención real: cuántos clientes del mes pasado volvieron este mes.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'alertas_negocio',
    description: 'Genera alertas automáticas: stock bajo, días sin citas, empleados sin actividad, meta mensual.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'meta_mensual',
    description: 'Muestra el progreso hacia la meta mensual de ingresos, cuánto falta y qué se necesita para llegar.',
    input_schema: {
      type: 'object',
      properties: {
        meta: { type: 'number', description: 'Meta en COP. Si no se especifica, usa la configurada en el negocio o $2.000.000 por defecto.' }
      }
    }
  },
  {
    name: 'crear_empleado',
    description: 'Crea un nuevo empleado en el negocio.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nombre completo del empleado' },
        phone: { type: 'string', description: 'Teléfono opcional' },
        email: { type: 'string', description: 'Email opcional' },
        commission_percent: { type: 'number', description: 'Porcentaje de comisión opcional' },
        is_active: { type: 'boolean', description: 'Si el empleado está activo (default: true)' }
      },
      required: ['name']
    }
  },
  {
    name: 'actualizar_empleado',
    description: 'Actualiza datos de un empleado existente.',
    input_schema: {
      type: 'object',
      properties: {
        employee_id: { type: 'string' },
        name: { type: 'string' },
        phone: { type: 'string' },
        commission_percent: { type: 'number' },
        is_active: { type: 'boolean' }
      },
      required: ['employee_id']
    }
  },
  {
    name: 'crear_servicio',
    description: 'Crea un nuevo servicio en el negocio.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        price: { type: 'number' },
        duration_minutes: { type: 'number' },
        description: { type: 'string' }
      },
      required: ['name', 'price', 'duration_minutes']
    }
  },
  {
    name: 'registrar_egreso',
    description: 'Registra un egreso o gasto del negocio.',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Monto en COP' },
        description: { type: 'string', description: 'Descripción del gasto' },
        category: { type: 'string', description: 'Categoría: arriendo, nomina, servicios, insumos, materias_primas, productos, otro' },
        date: { type: 'string', description: 'Fecha YYYY-MM-DD. Si no se especifica usa hoy.' }
      },
      required: ['amount', 'description', 'category']
    }
  },
  {
    name: 'ver_egresos',
    description: 'Ver egresos del negocio por período.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month'], description: 'Período a consultar' }
      },
      required: ['period']
    }
  },
  {
    name: 'buscar_egreso',
    description: 'Busca egresos por descripción, categoría o fecha para identificar cuál eliminar. Usar SIEMPRE antes de eliminar_egreso para obtener el ID correcto.',
    input_schema: {
      type: 'object',
      properties: {
        descripcion: { type: 'string', description: 'Texto a buscar en la descripción (opcional)' },
        categoria: { type: 'string', description: 'Categoría del egreso (opcional)' },
        fecha: { type: 'string', description: 'Fecha YYYY-MM-DD (opcional)' },
        period: { type: 'string', enum: ['today', 'week', 'month'], description: 'Período alternativo a fecha específica' }
      }
    }
  },
  {
    name: 'buscar_ingreso',
    description: 'Busca ingresos manuales por descripción o fecha para identificar cuál eliminar. Usar SIEMPRE antes de eliminar_ingreso para obtener el ID correcto.',
    input_schema: {
      type: 'object',
      properties: {
        descripcion: { type: 'string', description: 'Texto a buscar en la descripción (opcional)' },
        fecha: { type: 'string', description: 'Fecha YYYY-MM-DD (opcional)' },
        period: { type: 'string', enum: ['today', 'week', 'month'], description: 'Período alternativo' }
      }
    }
  },
  {
    name: 'registrar_ingreso',
    description: 'Registra un ingreso manual en caja (efectivo, transferencia, domicilio, otro no registrado automáticamente). Usar cuando el dueño dice que recibió dinero que no está en el sistema.',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Monto en COP' },
        description: { type: 'string', description: 'Descripción del ingreso' },
        category: { type: 'string', description: 'Categoría: servicios, productos, otro' },
        date: { type: 'string', description: 'Fecha YYYY-MM-DD. Si no se especifica usa hoy.' }
      },
      required: ['amount', 'description', 'category']
    }
  },
  {
    name: 'eliminar_egreso',
    description: 'Elimina un egreso registrado por error. Usar buscar_egreso primero para identificar el ID. No puede eliminar egresos de costo_producto (automáticos).',
    input_schema: {
      type: 'object',
      properties: {
        expense_id: { type: 'string', description: 'ID del egreso a eliminar' }
      },
      required: ['expense_id']
    }
  },
  {
    name: 'eliminar_ingreso',
    description: 'Elimina un ingreso manual registrado por error. Solo puede eliminar ingresos con source=manual. No puede eliminar ingresos de citas o ventas de productos.',
    input_schema: {
      type: 'object',
      properties: {
        income_id: { type: 'string', description: 'ID del ingreso a eliminar' }
      },
      required: ['income_id']
    }
  },
  {
    name: 'ver_ingresos',
    description: 'Ver ingresos del negocio por período con detalle y desglose por categoría y fuente.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month'], description: 'Período a consultar' }
      },
      required: ['period']
    }
  },
  {
    name: 'actualizar_configuracion',
    description: 'Actualiza configuraciones del negocio: nombre, teléfono, dirección, meta mensual, horarios.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          enum: ['perfil', 'meta_mensual', 'horario'],
          description: 'Qué configuración actualizar'
        },
        nombre: { type: 'string', description: 'Nuevo nombre del negocio (solo para tipo=perfil)' },
        telefono: { type: 'string', description: 'Nuevo teléfono (solo para tipo=perfil)' },
        direccion: { type: 'string', description: 'Nueva dirección (solo para tipo=perfil)' },
        meta: { type: 'number', description: 'Meta mensual en COP (solo para tipo=meta_mensual)' },
        dia_semana: { type: 'number', description: 'Día de la semana 0=Dom, 1=Lun...6=Sab (solo para tipo=horario)' },
        hora_apertura: { type: 'string', description: 'Hora apertura HH:mm (solo para tipo=horario)' },
        hora_cierre: { type: 'string', description: 'Hora cierre HH:mm (solo para tipo=horario)' },
        is_open: { type: 'boolean', description: 'Si ese día está abierto (solo para tipo=horario)' }
      },
      required: ['tipo']
    }
  },
  {
    name: 'ver_configuracion',
    description: 'Muestra la configuración actual del negocio: horarios de atención, meta mensual, nombre, teléfono, dirección, días cerrados próximos. Usar cuando pregunten "¿a qué hora abro?", "¿cuál es mi horario?", "muéstrame la configuración".',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'calcular_comisiones',
    description: 'Calcula cuánto le debe el negocio a cada empleado en comisiones para el período. Muestra citas completadas, ingresos generados y comisión a pagar por empleado.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['week', 'month', 'quincena'], description: 'Período: week=últimos 7 días, month=este mes, quincena=quincena actual' },
        quincena: { type: 'number', description: 'Si period=quincena: 1=primera (1-15), 2=segunda (16-fin de mes)' }
      },
      required: ['period']
    }
  },
  {
    name: 'resumen_dia',
    description: 'Resumen ejecutivo del día: citas de hoy, ingresos, comparado con ayer, alertas urgentes. Usar cuando el dueño llegue por la mañana o pregunte cómo va el día.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'diagnostico_negocio',
    description: 'Diagnóstico completo del negocio: tendencia de ingresos, retención, empleados sin actividad, stock, proyección vs meta y recomendaciones. Usar cuando pregunten "¿cómo está mi negocio?", "¿qué debo mejorar?", "dame un diagnóstico".',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'enviar_recordatorio_riesgo',
    description: 'Envía el mensaje de recordatorio configurado a clientes en riesgo (sin visita 30-90 días). Solo funciona con clientes que tienen teléfono registrado. Máximo 10 por día en plan Estándar.',
    input_schema: {
      type: 'object',
      properties: {
        client_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de IDs de clientes a los que enviar el recordatorio. Máximo 10.'
        },
        confirmar: {
          type: 'boolean',
          description: 'Debe ser true para ejecutar el envío. Si es false, solo muestra preview.'
        }
      },
      required: ['client_ids', 'confirmar']
    }
  },
  {
    name: 'ver_config_fidelizacion',
    description: 'Muestra la configuración del programa de fidelización: visitas necesarias para recompensa, puntos por cita y descripción de la recompensa.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'ver_fidelizacion_cliente',
    description: 'Muestra el estado de fidelización de un cliente: visitas acumuladas, cuántas le faltan para la recompensa, si puede canjear ahora. Usar buscar_cliente primero.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID del cliente' }
      },
      required: ['client_id']
    }
  },
  {
    name: 'clientes_cerca_recompensa',
    description: 'Lista clientes que están cerca de obtener su recompensa o que ya pueden canjearla.',
    input_schema: {
      type: 'object',
      properties: {
        margen: { type: 'number', description: 'Visitas de diferencia máximo para "cerca". Default 2.' },
        solo_listos: { type: 'boolean', description: 'Si true, muestra SOLO los que ya pueden canjear ahora.' }
      }
    }
  },
  {
    name: 'canjear_recompensa',
    description: 'Registra el canje de recompensa de fidelización para un cliente. Resetea sus visitas a 0. SIEMPRE usar ver_fidelizacion_cliente primero para verificar que puede_canjear sea true.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID del cliente' },
        notas: { type: 'string', description: 'Notas opcionales del canje' }
      },
      required: ['client_id']
    }
  },
  {
    name: 'test_sistema',
    description: 'SOLO SUPERADMIN. Ejecuta pruebas de funcionamiento del sistema y retorna reporte de salud.',
    input_schema: {
      type: 'object',
      properties: {
        modulo: {
          type: 'string',
          enum: ['todos', 'supabase', 'whatsapp', 'anthropic', 'pagos', 'scheduler'],
          description: 'Módulo a testear'
        }
      },
      required: ['modulo']
    }
  },
  {
    name: 'cerrar_dia_especial',
    description: 'Registra un día específico como cerrado (festivo, vacación, evento especial). Solo para cierres puntuales de fechas específicas.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Fecha del día cerrado en formato YYYY-MM-DD' },
        reason: { type: 'string', description: 'Motivo del cierre (ej: Festivo, Vacaciones, Evento especial)' }
      },
      required: ['date', 'reason']
    }
  },
  {
    name: 'vender_producto',
    description: 'Vende un producto buscando por nombre. Usa esto cuando el cliente compró un producto durante o después de una cita.',
    input_schema: {
      type: 'object',
      properties: {
        product_name: { type: 'string', description: 'Nombre del producto a vender' },
        quantity: { type: 'number', description: 'Cantidad vendida' },
        client_id: { type: 'string', description: 'ID del cliente (opcional)' },
        appointment_id: { type: 'string', description: 'ID de la cita asociada (opcional)' }
      },
      required: ['product_name', 'quantity']
    }
  },
  {
    name: 'crear_producto',
    description: 'Crea un nuevo producto en el negocio.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nombre del producto' },
        price: { type: 'number', description: 'Precio de venta en COP' },
        cost: { type: 'number', description: 'Costo del producto en COP (opcional)' },
        stock: { type: 'number', description: 'Stock inicial (opcional, default 0)' },
        category: { type: 'string', description: 'Categoría del producto (opcional)' }
      },
      required: ['name', 'price']
    }
  },
  {
    name: 'actualizar_producto',
    description: 'Actualiza un producto existente (nombre, precio, costo, stock, categoría).',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'ID del producto a actualizar' },
        name: { type: 'string', description: 'Nuevo nombre (opcional)' },
        price: { type: 'number', description: 'Nuevo precio (opcional)' },
        cost: { type: 'number', description: 'Nuevo costo (opcional)' },
        stock: { type: 'number', description: 'Nuevo stock (opcional)' },
        category: { type: 'string', description: 'Nueva categoría (opcional)' }
      },
      required: ['product_id']
    }
  },
  {
    name: 'ver_citas_pendientes',
    description: 'Lista todas las citas con estado pendiente que esperan confirmación (llegaron por WhatsApp). Usar al inicio del día.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha YYYY-MM-DD. Default hoy.' }
      }
    }
  },
  {
    name: 'confirmar_todas_pendientes',
    description: 'Confirma todas las citas pendientes de una fecha en un solo paso. Usar después de ver_citas_pendientes cuando el dueño quiere confirmar todo.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha YYYY-MM-DD. Default hoy.' }
      }
    }
  },
  {
    name: 'resumen_caja_hoy',
    description: 'Cierre de caja del día: ingresos por categoría, egresos del día y neto final. Usar al cierre del día o cuando el dueño quiera saber exactamente cómo quedó la caja.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha YYYY-MM-DD. Default hoy.' }
      }
    }
  },
  {
    name: 'historial_cliente',
    description: 'Historial completo de citas de un cliente con rango de fechas. Más detallado que info_cliente que solo muestra las últimas 5.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID del cliente' },
        limit: { type: 'number', description: 'Máximo de citas a retornar. Default 20.' },
        period: { type: 'string', enum: ['month', 'quarter', 'year', 'all'], description: 'month=este mes, quarter=3 meses, year=este año, all=todo el historial' }
      },
      required: ['client_id']
    }
  },
  {
    name: 'agregar_nota_cliente',
    description: 'Agrega o actualiza la nota de un cliente. Útil para recordar preferencias, alergias o notas especiales. Usar buscar_cliente primero para obtener el ID.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'ID del cliente' },
        nota: { type: 'string', description: 'Nota a guardar.' },
        agregar: { type: 'boolean', description: 'Si true, agrega al final de la nota existente. Si false o ausente, reemplaza.' }
      },
      required: ['client_id', 'nota']
    }
  },
  {
    name: 'ajustar_stock',
    description: 'Suma o resta unidades al stock existente de un producto. DIFERENTE a actualizar_producto que reemplaza el stock. Usar cuando llegue mercancía ("llegaron 50 unidades") o para correcciones.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'ID del producto (usar buscar_producto primero)' },
        cantidad: { type: 'number', description: 'Unidades a sumar (positivo) o restar (negativo del stock)' },
        motivo: { type: 'string', description: 'Motivo: llegada_mercancia, devolucion, correccion, perdida' }
      },
      required: ['product_id', 'cantidad']
    }
  },
  {
    name: 'ver_disponibilidad',
    description: 'Verifica si hay disponibilidad en una fecha y hora específica sin crear cita. Útil para responder clientes que preguntan por un horario.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha YYYY-MM-DD' },
        hora: { type: 'string', description: 'Hora HH:mm (ej: 15:00)' }
      },
      required: ['fecha', 'hora']
    }
  },
  {
    name: 'ver_agenda_empleado',
    description: 'Muestra las citas de un empleado específico para hoy o una fecha. Usar buscar_empleado primero para obtener el ID.',
    input_schema: {
      type: 'object',
      properties: {
        employee_id: { type: 'string', description: 'ID del empleado' },
        fecha: { type: 'string', description: 'Fecha YYYY-MM-DD. Default hoy.' }
      },
      required: ['employee_id']
    }
  },
  {
    name: 'eliminar_empleado',
    description: 'Elimina permanentemente un empleado. Solo si nunca tuvo citas. Si tuvo citas, usar actualizar_empleado con is_active=false para desactivarlo y preservar el historial.',
    input_schema: {
      type: 'object',
      properties: {
        employee_id: { type: 'string', description: 'ID del empleado a eliminar' }
      },
      required: ['employee_id']
    }
  }
];

// Ejecutar cada tool
async function executeTool(toolName, toolInput, businessId) {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

    switch(toolName) {
        case 'buscar_servicio': {
      logger.info(`[buscar_servicio] businessId=${businessId}, searching for="${toolInput.nombre}"`);

      const normalizedSearch = normalize(toolInput.nombre);
      const { data: allServices } = await supabaseAdmin
        .from('services')
        .select('id, name, price, duration_minutes')
        .eq('business_id', businessId)
        .eq('active', true)
        .order('name');

      if (!allServices || allServices.length === 0) {
        return { not_found: true, searched_for: toolInput.nombre, available_services: [] };
      }

      const matches = allServices.filter(s =>
        normalize(s.name).includes(normalizedSearch) || normalizedSearch.split(' ').some(w => normalize(s.name).includes(w))
      );

      if (matches.length === 0) {
        return { not_found: true, searched_for: toolInput.nombre, available_services: allServices };
      }

      if (matches.length === 1) return { found: true, service: matches[0] };

      const bestMatch = matches.reduce((best, current) => {
        const currentScore = calculateSimilarity(toolInput.nombre, current.name);
        const bestScore = calculateSimilarity(toolInput.nombre, best.name);
        return currentScore > bestScore ? current : best;
      });
      return { found: true, service: bestMatch };
    }

        case 'buscar_cliente': {
      const searchTerm = toolInput.nombre.trim();
      const searchNormalized = normalizeForSearch(searchTerm);
      const searchWords = searchNormalized.split(/\s+/).filter(w => w.length > 0);

      const { data: allClients } = await supabaseAdmin
        .from('clients')
        .select('id, name, phone')
        .eq('business_id', businessId)
        .order('name');

      if (!allClients || allClients.length === 0) {
        return { not_found: true, searched_for: toolInput.nombre, can_create: true };
      }

      const conPuntaje = allClients.map(c => {
        const clientNormalized = normalizeForSearch(c.name);
        const clientWords = clientNormalized.split(/\s+/).filter(w => w.length > 0);
        let puntaje = 0;

        for (const sw of searchWords) {
          for (const cw of clientWords) {
            if (cw === sw) { puntaje += 10; }
            else if (cw.startsWith(sw) && sw.length >= 3) { puntaje += 6; }
            else if (cw.includes(sw) && sw.length >= 3) { puntaje += 4; }
            else if (sw.length >= 5 && levenshtein(sw, cw) === 1) { puntaje += 2; }
          }
        }

        return { ...c, puntaje };
      })
      .filter(c => c.puntaje >= 4)
      .sort((a, b) => b.puntaje - a.puntaje);

      logger.info('[buscar_cliente] matches encontrados: ' + conPuntaje.length + ' para query: ' + toolInput.nombre);

      if (!conPuntaje.length) {
        return { not_found: true, searched_for: toolInput.nombre, can_create: true };
      }

      const puntajeMaximo = searchWords.length * 10;
      const matchExacto = conPuntaje[0].puntaje >= puntajeMaximo && (
        conPuntaje.length === 1 || conPuntaje[1].puntaje < puntajeMaximo
      );
      const soloUnResultado = conPuntaje.length === 1;
      const esExacto = matchExacto || soloUnResultado;

      const topMatches = conPuntaje.slice(0, 10).map(c => ({ id: c.id, name: c.name, phone: c.phone }));
      return {
        found: true,
        client: conPuntaje[0],
        multiple_found: !esExacto && conPuntaje.length > 1,
        all_matches: !esExacto && conPuntaje.length > 1 ? topMatches : undefined,
        exact_match: esExacto
      };
    }

    case 'crear_cliente': {
      let normalizedPhone = null;
      if (toolInput.phone) {
        normalizedPhone = toolInput.phone.trim();
        if (normalizedPhone.startsWith('+57')) {
          normalizedPhone = normalizedPhone.slice(3);
        } else if (normalizedPhone.startsWith('57') && normalizedPhone.length > 10) {
          normalizedPhone = normalizedPhone.slice(2);
        }
      }

      logger.info('crear_cliente_intent: name='+toolInput.name+' phone='+toolInput.phone+' normalized='+normalizedPhone);

      const { data, error } = await supabaseAdmin
        .from('clients')
        .insert({
          business_id: businessId,
          name: formatName(toolInput.name),
          phone: normalizedPhone
        })
        .select('id, name')
        .single();

      logger.info('crear_cliente_result: data='+JSON.stringify(data)+' error='+JSON.stringify(error));

      if (error) {
        if (error.code === '23505' && normalizedPhone) {
          const { data: existingClient } = await supabaseAdmin
            .from('clients')
            .select('id, name')
            .eq('business_id', businessId)
            .eq('phone', normalizedPhone)
            .maybeSingle();
          if (existingClient) {
            return { success: true, client: existingClient, already_existed: true };
          }
        }
        return { success: false, error: error.message };
      }
      return { success: true, client: data };
    }

    case 'eliminar_cliente': {
      const { data: futureAppointments } = await supabaseAdmin
        .from('appointments')
        .select('id')
        .eq('client_id', toolInput.client_id)
        .neq('status', 'cancelled')
        .gt('scheduled_at', new Date().toISOString())
        .limit(1);

      if (futureAppointments && futureAppointments.length > 0) {
        return { success: false, error: 'No se puede eliminar el cliente porque tiene citas futuras programadas. Cancela las citas primero.' };
      }

      const { error, count } = await supabaseAdmin
        .from('clients')
        .delete()
        .eq('id', toolInput.client_id)
        .eq('business_id', businessId)
        .select('', { count: 'exact' });

      if (error) return { success: false, error: error.message };
      if (count === 0) return { success: false, error: 'Cliente no encontrado' };
      return { success: true, message: 'Cliente eliminado correctamente.' };
    }

    case 'actualizar_cliente': {
      const updateData = {};
      if (toolInput.name !== undefined) updateData.name = formatName(toolInput.name);
      if (toolInput.email !== undefined) updateData.email = toolInput.email;
      if (toolInput.phone !== undefined) {
        let phone = toolInput.phone.trim();
        if (phone.startsWith('+57')) phone = phone.slice(3);
        else if (phone.startsWith('57') && phone.length > 10) phone = phone.slice(2);
        updateData.phone = phone;
      }
      if (Object.keys(updateData).length === 0) return { success: false, error: 'No hay datos para actualizar' };
      const { data, error } = await supabaseAdmin
        .from('clients')
        .update(updateData)
        .eq('id', toolInput.client_id)
        .eq('business_id', businessId)
        .select('id');

      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) {
        return { success: false, error: 'Registro no encontrado' };
      }

      return { success: true };
    }

    case 'buscar_empleado': {
      const palabras = toolInput.nombre.toLowerCase().split(' ');
      const { data } = await supabaseAdmin
        .from('employees')
        .select('id, name, commission_percent')
        .eq('business_id', businessId);

      const conPuntaje = data?.map(e => {
        const nombreLower = e.name.toLowerCase();
        const puntaje = palabras.filter(p =>
          nombreLower.includes(p) || p.includes(nombreLower.split(' ')[0])
        ).length;
        return { ...e, puntaje };
      }).filter(e => e.puntaje > 0)
        .sort((a, b) => b.puntaje - a.puntaje);

      if (!conPuntaje?.length) return { found: false };
      if (conPuntaje[0].puntaje >= 1) return { found: true, employee: conPuntaje[0] };
      return { found: false, searched_for: toolInput.nombre };
    }

        case 'buscar_producto': {
      const normalizedSearch = normalize(toolInput.nombre);
      const { data: allProducts } = await supabaseAdmin
        .from('products')
        .select('id, name, price, stock, cost_price')
        .eq('business_id', businessId)
        .eq('is_active', true);

      if (!allProducts || allProducts.length === 0) {
        return { found: false, message: 'No encontré ese producto' };
      }

      const addMargin = (p) => ({
        ...p,
        margen_pct: p.cost_price != null && p.price > 0
          ? Number(((p.price - p.cost_price) / p.price * 100).toFixed(1))
          : null,
      });

      // Filtrar palabras cortas o vacías para evitar falsos positivos
      const searchWords = normalizedSearch.split(' ').filter(w => w.length >= 3);

      const matches = allProducts.filter(p => {
        const normalizedName = normalize(p.name);
        // Match exacto del término completo
        if (normalizedName.includes(normalizedSearch)) return true;
        // Match por palabras significativas (mínimo 3 chars)
        // TODAS las palabras significativas deben estar presentes para considerar match
        if (searchWords.length > 0) {
          return searchWords.every(w => normalizedName.includes(w));
        }
        return false;
      });

      if (matches.length === 0) {
        return { found: false, message: 'No encontré ese producto' };
      }

      if (matches.length === 1) return { found: true, product: addMargin(matches[0]) };

      const bestMatch = matches.reduce((best, current) => {
        const currentScore = calculateSimilarity(toolInput.nombre, current.name);
        const bestScore = calculateSimilarity(toolInput.nombre, best.name);
        return currentScore > bestScore ? current : best;
      });
      return { found: true, product: addMargin(bestMatch) };
    }

    case 'listar_servicios': {
      logger.info('[listar_servicios] listing for businessId:', businessId);
      const { data } = await supabaseAdmin
        .from('services')
        .select('name, price, duration_minutes')
        .eq('business_id', businessId)
        .eq('active', true)
        .order('name');
      logger.info('[listar_servicios] encontrados:', data?.length || 0, 'servicios');
      return { services: data };
    }

    case 'listar_empleados': {
      let query = supabaseAdmin
        .from('employees')
        .select('id, name, phone, email, commission_percent, is_active')
        .eq('business_id', businessId)
        .order('name');

      if (!toolInput.incluir_inactivos) {
        query = query.eq('is_active', true);
      }

      const { data } = await query;
      const activos = (data || []).filter(e => e.is_active);
      const inactivos = (data || []).filter(e => !e.is_active);

      logger.info('Empleados encontrados:', data?.length);
      return {
        empleados: data || [],
        activos: activos.length,
        inactivos: inactivos.length,
        detalle_activos: activos,
        detalle_inactivos: inactivos
      };
    }

    case 'listar_citas': {
      const fecha = toolInput.fecha || today;
      const { data } = await supabaseAdmin
        .from('appointments')
        .select('id, scheduled_at, status, clients(name), services(name), employees(name)')
        .eq('business_id', businessId)
        .gte('scheduled_at', `${fecha}T00:00:00-05:00`)
        .lte('scheduled_at', `${fecha}T23:59:59-05:00`)
        .order('scheduled_at');
      const appointmentsCol = (data || []).map(a => ({
        ...a,
        scheduled_at_colombia: new Date(a.scheduled_at).toLocaleString('es-CO', {
          timeZone: 'America/Bogota',
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }),
        hora_colombia: new Date(a.scheduled_at).toLocaleTimeString('es-CO', {
          timeZone: 'America/Bogota',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        })
      }));
      return { appointments: appointmentsCol, date: fecha };
    }

    case 'ver_agenda_semana': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const dias = Math.min(toolInput.dias || 7, 14);
      const fechaFin = new Date(Date.now() + dias * 86400000).toLocaleDateString('en-CA', bogota);

      const { data } = await supabaseAdmin
        .from('appointments')
        .select('id, scheduled_at, status, price, clients(name), services(name, duration_minutes), employees(name)')
        .eq('business_id', businessId)
        .gte('scheduled_at', `${hoy}T00:00:00-05:00`)
        .lte('scheduled_at', `${fechaFin}T23:59:59-05:00`)
        .not('status', 'in', '("cancelled")')
        .order('scheduled_at');

      const porDia = {};
      (data || []).forEach(a => {
        const diaKey = new Date(a.scheduled_at).toLocaleDateString('en-CA', bogota);
        const diaNombre = new Date(a.scheduled_at).toLocaleDateString('es-CO', {
          timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long'
        });
        if (!porDia[diaKey]) porDia[diaKey] = { fecha: diaKey, nombre: diaNombre, citas: [], total_dia: 0 };
        porDia[diaKey].citas.push({
          id: a.id,
          hora: new Date(a.scheduled_at).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: true }),
          cliente: a.clients?.name || 'Walk-in',
          servicio: a.services?.name || 'Sin servicio',
          empleado: a.employees?.name || 'Sin asignar',
          precio: a.price || 0,
          status: a.status
        });
        porDia[diaKey].total_dia += Number(a.price || 0);
      });

      const agenda = Object.values(porDia).sort((a, b) => a.fecha.localeCompare(b.fecha));
      const totalCitas = (data || []).length;
      const totalIngresos = agenda.reduce((s, d) => s + d.total_dia, 0);

      return { agenda, total_citas: totalCitas, total_ingresos_proyectados: totalIngresos, periodo: `${hoy} al ${fechaFin}` };
    }

    case 'crear_cita': {
      logger.info('=== CREAR CITA ===');
      logger.info('input:', JSON.stringify(toolInput));
      logger.info('businessId:', businessId);

      let scheduledAt = toolInput.scheduled_at;
      if (scheduledAt) {
        if (scheduledAt.endsWith('Z')) {
          scheduledAt = scheduledAt.slice(0, -1) + '-05:00';
        } else if (scheduledAt.includes('+00:00')) {
          scheduledAt = scheduledAt.replace('+00:00', '-05:00');
        } else if (!scheduledAt.includes('+') && !scheduledAt.includes('-05:00')) {
          scheduledAt = scheduledAt.includes('T') ? scheduledAt + '-05:00' : scheduledAt;
        }
      }

      const appointmentDate = new Date(scheduledAt);
      const colombiaStr = appointmentDate.toLocaleString('en-CA', {
        timeZone: 'America/Bogota',
        hour12: false
      });
      const [datePart, timePart] = colombiaStr.split(', ');
      const [colHour, colMin] = timePart.split(':').map(Number);
      const [year, month, day] = datePart.split('-').map(Number);
      const tempDate = new Date(year, month - 1, day);
      const dayOfWeek = tempDate.getDay();
      const appointmentHour = colHour;
      const appointmentMinute = colMin;

      const { data: horario } = await supabaseAdmin
        .from('business_hours')
        .select('open_time, close_time, is_open')
        .eq('business_id', businessId)
        .eq('day_of_week', dayOfWeek)
        .single();

      if (horario && !horario.is_open) {
        return { success: false, error: 'El negocio está cerrado ese día' };
      }

      if (horario) {
        const [openHour, openMin] = horario.open_time.split(':').map(Number);
        const [closeHour, closeMin] = horario.close_time.split(':').map(Number);
        const appointmentTimeInMinutes = appointmentHour * 60 + appointmentMinute;
        const openTimeInMinutes = openHour * 60 + openMin;
        const closeTimeInMinutes = closeHour * 60 + closeMin;

        if (appointmentTimeInMinutes < openTimeInMinutes || appointmentTimeInMinutes >= closeTimeInMinutes) {
          return {
            success: false,
            error: 'Fuera de horario',
            horario: `${horario.open_time} - ${horario.close_time}`
          };
        }
      }

      // Fetch service price and name for income creation
      const { data: service } = await supabaseAdmin
        .from('services')
        .select('name, price')
        .eq('id', toolInput.service_id)
        .eq('business_id', businessId)
        .single();

      // Auto-assign employee if not specified
      let finalEmployeeId = toolInput.employee_id;
      if (!finalEmployeeId) {
        const fecha = scheduledAt.slice(0, 10);
        const hora = scheduledAt.slice(11, 16);
        const available = await getAvailableEmployee(businessId, fecha, hora);
        if (available) {
          finalEmployeeId = available.id;
        }
      }

      // Protección contra duplicados: si ya existe una cita idéntica creada
      // en los últimos 30 segundos, no crear otra (evita doble-submit o reintentos)
      const { data: posibleDuplicado } = await supabaseAdmin
        .from('appointments')
        .select('id, created_at')
        .eq('business_id', businessId)
        .eq('service_id', toolInput.service_id)
        .eq('scheduled_at', scheduledAt)
        .eq('client_id', toolInput.client_id || null)
        .gte('created_at', new Date(Date.now() - 30000).toISOString())
        .limit(1);

      if (posibleDuplicado && posibleDuplicado.length > 0) {
        logger.warn('Posible cita duplicada detectada y bloqueada', { businessId, scheduledAt, service_id: toolInput.service_id });
        return {
          success: true,
          message: 'Esta cita ya había sido creada hace unos segundos, no se duplicó.',
          appointment_id: posibleDuplicado[0].id
        };
      }

      const appointmentStatus = toolInput.status === 'completed' ? 'completed' : 'confirmed';

      if (appointmentStatus === 'completed') {
        const scheduledTime = new Date(scheduledAt).getTime();
        const nowTime = Date.now();

        if (scheduledTime > nowTime) {
          return {
            success: false,
            error: 'No puedes crear una cita completada con fecha futura. Usa una fecha/hora pasada.'
          };
        }
      }

      const insertData = {
        business_id: businessId,
        client_id: toolInput.client_id || null,
        service_id: toolInput.service_id,
        employee_id: finalEmployeeId || null,
        scheduled_at: scheduledAt,
        status: appointmentStatus,
        source: 'assistant',
        notes: toolInput.notes || null,
        price: service?.price || 0
      };

      logger.info('insertData:', JSON.stringify(insertData));

      // Validar límite de citas del mes
      const { data: bizPlan } = await supabaseAdmin
        .from('businesses')
        .select('plan')
        .eq('id', businessId)
        .single();

      const planCita = bizPlan?.plan || 'estandar';
      const limiteCita = PLANS[planCita].max_appointments_month;

      if (limiteCita !== -1) {
        const _tzCita = getTimezone();
        const _offCita = getOffsetForTz(_tzCita);
        const mesActualCita = new Date().toLocaleDateString('en-CA', { timeZone: _tzCita }).slice(0, 7);
        const inicioMesCita = `${mesActualCita}-01T00:00:00${_offCita}`;
        const [yrCita, moCita] = mesActualCita.split('-').map(Number);
        const ultimoDiaCita = new Date(yrCita, moCita, 0).getDate();
        const finMesCita = `${mesActualCita}-${String(ultimoDiaCita).padStart(2, '0')}T23:59:59${_offCita}`;

        const { count: countCita } = await supabaseAdmin
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .gte('scheduled_at', inicioMesCita)
          .lte('scheduled_at', finMesCita)
          .neq('status', 'cancelled');

        if (countCita >= limiteCita) {
          return { success: false, error: 'Has alcanzado el límite de citas este mes de tu plan.' };
        }
      }

      const { data, error } = await supabaseAdmin
        .from('appointments')
        .insert(insertData)
        .select('id, scheduled_at, status')
        .single();

      logger.info('resultado:', JSON.stringify(data), 'error:', JSON.stringify(error));

      if (error) return { success: false, error: error.message };

      // Si la cita se crea como completada, registrar el ingreso automáticamente
      // (misma lógica que completar_cita)
      if (appointmentStatus === 'completed' && data && (service?.price || 0) > 0) {
        const { data: existingIncome } = await supabaseAdmin
          .from('income')
          .select('id')
          .eq('appointment_id', data.id)
          .limit(1);

        if (!existingIncome || existingIncome.length === 0) {
          const incomeDate = new Date(data.scheduled_at).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
          await supabaseAdmin.from('income').insert({
            business_id: businessId,
            appointment_id: data.id,
            client_id: toolInput.client_id || null,
            amount: service.price,
            category: 'servicios',
            description: `${service.name} - agendado por asistente (completado)`,
            source: 'appointment',
            date: incomeDate
          });
        }
      }

      return { success: true, appointment: data, appointment_id: data.id };
    }

    case 'consultar_metricas': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const inicioFecha = toolInput.periodo === 'day'
        ? hoy
        : toolInput.periodo === 'week'
          ? new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA', bogota)
          : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7) + '-01';

      const [{ data: ingresos }, { data: egresos }] = await Promise.all([
        supabaseAdmin.from('income').select('amount').eq('business_id', businessId).gte('date', inicioFecha),
        supabaseAdmin.from('expenses').select('amount, category').eq('business_id', businessId).gte('date', inicioFecha),
      ]);

      const total_ingresos    = (ingresos || []).reduce((s, i) => s + Number(i.amount || 0), 0);
      const costo_ventas      = (egresos || []).filter(e => e.category === 'costo_producto').reduce((s, e) => s + Number(e.amount), 0);
      const egresos_operativos = (egresos || []).filter(e => e.category !== 'costo_producto').reduce((s, e) => s + Number(e.amount), 0);
      const margen_bruto      = total_ingresos - costo_ventas;
      const utilidad_neta     = margen_bruto - egresos_operativos;
      const margen_pct        = total_ingresos > 0 ? Number((utilidad_neta / total_ingresos * 100).toFixed(1)) : 0;

      return {
        total_ingresos, costo_ventas, egresos_operativos,
        margen_bruto, utilidad_neta, margen_pct,
        period: toolInput.periodo, currency: 'COP',
      };
    }

    case 'registrar_venta': {
      const { data: product } = await supabaseAdmin
        .from('products')
        .select('stock, price, name, cost_price')
        .eq('business_id', businessId)
        .eq('id', toolInput.product_id)
        .maybeSingle();

      if (!product || product.stock < toolInput.quantity) {
        return { success: false, error: 'Stock insuficiente' };
      }

      await supabaseAdmin
        .from('products')
        .update({ stock: product.stock - toolInput.quantity })
        .eq('business_id', businessId)
        .eq('id', toolInput.product_id);

      const saleDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

      const { data } = await supabaseAdmin
        .from('product_sales')
        .insert({
          business_id: businessId,
          product_id: toolInput.product_id,
          quantity: toolInput.quantity,
          total_amount: product.price * toolInput.quantity,
          client_id: toolInput.client_id || null,
          sold_via: 'presencial'
        })
        .select()
        .single();

      if (product.cost_price != null) {
        const costoTotal = Number(product.cost_price) * toolInput.quantity;
        await supabaseAdmin
          .from('expenses')
          .insert({
            business_id: businessId,
            amount:      costoTotal,
            category:    'costo_producto',
            description: `Costo de venta: ${product.name} (${toolInput.quantity} unidades)`,
            date:        saleDate,
          });
      }

      const saleDateRV = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
      await supabaseAdmin.from('income').insert({
        business_id: businessId,
        amount: product.price * toolInput.quantity,
        category: 'productos',
        description: `Venta: ${product.name}${toolInput.quantity > 1 ? ` ×${toolInput.quantity}` : ''}`,
        date: saleDateRV,
        client_id: toolInput.client_id || null,
        source: 'product_sale'
      });

      return { success: true, sale: data };
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
        return { success: false, error: 'Registro no encontrado' };
      }

      return { success: true };
    }

    case 'buscar_cita': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const soloFuturas = toolInput.solo_futuras !== false;

      let query = supabaseAdmin
        .from('appointments')
        .select('id, scheduled_at, status, price, clients(name), services(name), employees(name)')
        .eq('business_id', businessId)
        .not('status', 'in', '("cancelled")')
        .order('scheduled_at');

      if (toolInput.client_id) query = query.eq('client_id', toolInput.client_id);
      if (toolInput.fecha) {
        query = query
          .gte('scheduled_at', `${toolInput.fecha}T00:00:00-05:00`)
          .lte('scheduled_at', `${toolInput.fecha}T23:59:59-05:00`);
      } else if (soloFuturas) {
        query = query.gte('scheduled_at', `${hoy}T00:00:00-05:00`);
      }

      query = query.limit(10);
      const { data } = await query;

      if (!data || data.length === 0) return { found: false, message: 'No se encontraron citas' };

      const citas = data.map(a => ({
        id: a.id,
        fecha_hora: new Date(a.scheduled_at).toLocaleString('es-CO', {
          timeZone: 'America/Bogota', weekday: 'long', day: 'numeric',
          month: 'long', hour: '2-digit', minute: '2-digit', hour12: true
        }),
        cliente: a.clients?.name || 'Walk-in',
        servicio: a.services?.name || 'Sin servicio',
        empleado: a.employees?.name || 'Sin asignar',
        precio: a.price || 0,
        status: a.status
      }));

      return { found: true, citas, total: citas.length };
    }

    case 'confirmar_cita': {
      const { data, error } = await supabaseAdmin
        .from('appointments')
        .update({ status: 'confirmed' })
        .eq('id', toolInput.appointment_id)
        .eq('business_id', businessId)
        .select('id');

      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) {
        return { success: false, error: 'Registro no encontrado' };
      }

      return { success: true };
    }

    case 'completar_cita': {
      const { data: appt, error: apptError } = await supabaseAdmin
        .from('appointments')
        .update({ status: 'completed' })
        .eq('id', toolInput.appointment_id)
        .eq('business_id', businessId)
        .select('id, price, scheduled_at')
        .single();

      if (apptError) return { success: false, error: apptError.message };

      if (appt?.price > 0) {
        const { data: existingIncome } = await supabaseAdmin
          .from('income')
          .select('id')
          .eq('appointment_id', appt.id)
          .maybeSingle();

        if (!existingIncome) {
          const incomeDate = new Date(appt.scheduled_at).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
          await supabaseAdmin.from('income').insert({
            business_id: businessId,
            appointment_id: appt.id,
            amount: appt.price,
            category: 'servicios',
            description: 'Cita completada',
            date: incomeDate,
            source: 'appointment'
          });
        }
      }

      return { success: true, message: 'Cita marcada como completada e ingreso registrado' };
    }

    case 'contactar_soporte': {
      await supabaseAdmin
        .from('notifications')
        .insert({
          business_id: businessId,
          type: 'support_contact',
          message: toolInput.mensaje
        });
      return { success: true };
    }

    case 'desactivar_servicio': {
      const { data, error } = await supabaseAdmin
        .from('services')
        .update({ active: false })
        .eq('id', toolInput.service_id)
        .eq('business_id', businessId)
        .select('id');

      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) {
        return { success: false, error: 'Registro no encontrado' };
      }

      return { success: true };
    }

    case 'eliminar_servicio': {
      const { error } = await supabaseAdmin
        .from('services')
        .delete()
        .eq('id', toolInput.service_id)
        .eq('business_id', businessId);
      return { success: !error, message: 'Servicio eliminado' };
    }

    case 'eliminar_producto': {
      const { error } = await supabaseAdmin
        .from('products')
        .delete()
        .eq('id', toolInput.product_id)
        .eq('business_id', businessId);
      return { success: !error, message: 'Producto eliminado' };
    }

    case 'listar_productos': {
      const { data } = await supabaseAdmin
        .from('products')
        .select('id, name, price, stock, cost_price')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('name');
      const products = (data || []).map(p => ({
        ...p,
        margen_pct: p.cost_price != null && p.price > 0
          ? Number(((p.price - p.cost_price) / p.price * 100).toFixed(1))
          : null,
      }));
      return { products };
    }

    case 'activar_producto': {
      const { data, error } = await supabaseAdmin
        .from('products')
        .update({ is_active: true })
        .eq('id', toolInput.product_id)
        .eq('business_id', businessId)
        .select('id');

      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) {
        return { success: false, error: 'Registro no encontrado' };
      }

      return { success: true };
    }

    case 'desactivar_producto': {
      const { data, error } = await supabaseAdmin
        .from('products')
        .update({ is_active: false })
        .eq('id', toolInput.product_id)
        .eq('business_id', businessId)
        .select('id');

      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) {
        return { success: false, error: 'Registro no encontrado' };
      }

      return { success: true };
    }

    case 'activar_servicio': {
      const { data, error } = await supabaseAdmin
        .from('services')
        .update({ active: true })
        .eq('id', toolInput.service_id)
        .eq('business_id', businessId)
        .select('id');

      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) {
        return { success: false, error: 'Registro no encontrado' };
      }

      return { success: true };
    }

    case 'actualizar_servicio': {
      const updateData = {};
      if (toolInput.name !== undefined) updateData.name = toolInput.name;
      if (toolInput.price) updateData.price = toolInput.price;
      if (toolInput.duration_minutes) updateData.duration_minutes = toolInput.duration_minutes;
      const { data, error } = await supabaseAdmin
        .from('services')
        .update(updateData)
        .eq('id', toolInput.service_id)
        .eq('business_id', businessId)
        .select('id');

      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) {
        return { success: false, error: 'Registro no encontrado' };
      }

      return { success: true };
    }

    case 'historial_ventas': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', bogota);
      const inicioSemana = new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA', bogota);
      const inicioMes = hoy.slice(0, 7) + '-01';
      const inicioAño = hoy.slice(0, 4) + '-01-01';

      const rangos = {
        today:     { inicio: hoy,         fin: hoy },
        yesterday: { inicio: ayer,        fin: ayer },
        week:      { inicio: inicioSemana, fin: hoy },
        month:     { inicio: inicioMes,   fin: hoy },
        year:      { inicio: inicioAño,   fin: hoy }
      };

      const rango = rangos[toolInput.period];

      const { data } = await supabaseAdmin
        .from('product_sales')
        .select('quantity, total_amount, sold_at, products(name)')
        .eq('business_id', businessId)
        .gte('sold_at', rango.inicio + 'T00:00:00-05:00')
        .lte('sold_at', rango.fin + 'T23:59:59-05:00')
        .order('sold_at', { ascending: false });

      if (!data || data.length === 0) {
        const { data: data2 } = await supabaseAdmin
          .from('product_sales')
          .select('quantity, total_amount, created_at, products(name)')
          .eq('business_id', businessId)
          .gte('created_at', rango.inicio + 'T00:00:00-05:00')
          .lte('created_at', rango.fin + 'T23:59:59-05:00')
          .order('created_at', { ascending: false });

        const total2 = data2?.reduce((sum, s) => sum + s.total_amount, 0) || 0;
        return { ventas: data2 || [], total: total2, period: toolInput.period };
      }

      const total = data.reduce((sum, s) => sum + s.total_amount, 0);
      return { ventas: data, total, period: toolInput.period };
    }

    case 'info_cliente': {
      const { data: loyalty } = await supabaseAdmin
        .from('client_loyalty')
        .select('total_visits, loyalty_visits, last_redeemed_at')
        .eq('client_id', toolInput.client_id)
        .eq('business_id', businessId)
        .single();

      const { data: appointments } = await supabaseAdmin
        .from('appointments')
        .select('scheduled_at, status, price, services(name)')
        .eq('client_id', toolInput.client_id)
        .eq('business_id', businessId)
        .eq('status', 'completed')
        .order('scheduled_at', { ascending: false })
        .limit(5);

      const totalGastado = appointments?.reduce((sum, a) =>
        sum + (Number(a.price) || 0), 0) || 0;

      const formatColDate = (iso) => iso ? new Date(iso).toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }) : null;
      return {
        total_visits: loyalty?.total_visits || 0,
        loyalty_visits: loyalty?.loyalty_visits || 0,
        total_spent: totalGastado,
        last_visit: formatColDate(appointments?.[0]?.scheduled_at),
        recent_appointments: (appointments || []).map(a => ({
          ...a,
          hora_colombia: formatColDate(a.scheduled_at)
        }))
      };
    }

    case 'citas_completadas': {
      const hoy = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
      const inicios = {
        day: hoy,
        week: new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/Bogota'}),
        month: hoy.slice(0, 7) + '-01'
      };
      const inicio = inicios[toolInput.period];

      const { data } = await supabaseAdmin
        .from('appointments')
        .select('status, services(name, price)')
        .eq('business_id', businessId)
        .eq('status', 'completed')
        .gte('scheduled_at', inicio + 'T00:00:00-05:00');

      const servicios = {};
      data?.forEach(a => {
        const nombre = a.services?.name || 'Sin servicio';
        servicios[nombre] = (servicios[nombre] || 0) + 1;
      });

      const masVendido = Object.entries(servicios)
        .sort((a, b) => b[1] - a[1])[0];

      return {
        total_completadas: data?.length || 0,
        servicio_mas_vendido: masVendido ? { nombre: masVendido[0], cantidad: masVendido[1] } : null,
        period: toolInput.period
      };
    }

    case 'rendimiento_empleados': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const inicios = {
        today: hoy,
        week: new Date(Date.now() - 7*86400000).toLocaleDateString('en-CA', bogota),
        month: hoy.slice(0,7) + '-01'
      };
      const inicio = inicios[toolInput.period];

      const { data } = await supabaseAdmin
        .from('appointments')
        .select('employee_id, employees(name, commission_percent), services(price)')
        .eq('business_id', businessId)
        .eq('status', 'completed')
        .gte('scheduled_at', inicio + 'T00:00:00-05:00');

      const resumen = {};
      data?.forEach(a => {
        const nombre = a.employees?.name || 'Sin asignar';
        if (!resumen[nombre]) resumen[nombre] = { citas: 0, ingresos: 0 };
        resumen[nombre].citas++;
        resumen[nombre].ingresos += a.services?.price || 0;
        resumen[nombre].commission_percent = a.employees?.commission_percent || 10;
        resumen[nombre].comision = resumen[nombre].ingresos * (resumen[nombre].commission_percent / 100);
      });

      const ranking = Object.entries(resumen)
        .sort((a, b) => b[1].ingresos - a[1].ingresos)
        .map(([nombre, datos]) => ({ nombre, ...datos }));

      return { ranking, period: toolInput.period };
    }

    case 'resumen_clientes': {
      const hoy = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
      const inicioMes = hoy.slice(0,7) + '-01';

      const { count: total } = await supabaseAdmin
        .from('clients')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', businessId);

      const { count: nuevosEsteMes } = await supabaseAdmin
        .from('clients')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .gte('created_at', inicioMes + 'T00:00:00-05:00');

      const inicioSemana = new Date(Date.now() - 7*86400000)
        .toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});

      const { data: activos } = await supabaseAdmin
        .from('appointments')
        .select('client_id')
        .eq('business_id', businessId)
        .gte('scheduled_at', inicioSemana + 'T00:00:00-05:00');

      const clientesActivos = new Set(activos?.map(a => a.client_id)).size;

      return {
        total: total || 0,
        nuevos_este_mes: nuevosEsteMes || 0,
        activos_esta_semana: clientesActivos
      };
    }

    case 'analizar_rentabilidad': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const inicioMes = hoy.slice(0, 7) + '-01';

      const [{ data: productos }, { data: ventas }, { data: costosExp }] = await Promise.all([
        supabaseAdmin.from('products').select('id, name, price, cost_price').eq('business_id', businessId).eq('is_active', true),
        supabaseAdmin.from('product_sales').select('product_id, quantity, total_amount').eq('business_id', businessId).gte('created_at', inicioMes + 'T00:00:00-05:00'),
        supabaseAdmin.from('expenses').select('amount, description').eq('business_id', businessId).eq('category', 'costo_producto').gte('date', inicioMes),
      ]);

      const ventasPorProducto = {};
      (ventas || []).forEach(v => {
        if (!ventasPorProducto[v.product_id]) ventasPorProducto[v.product_id] = { unidades: 0, ingresos: 0 };
        ventasPorProducto[v.product_id].unidades += v.quantity;
        ventasPorProducto[v.product_id].ingresos += Number(v.total_amount);
      });

      const costosPorProducto = {};
      (costosExp || []).forEach(e => {
        const match = e.description?.match(/Costo de venta: (.+) \((\d+) unidades\)/);
        if (match) {
          const nombre = match[1];
          costosPorProducto[nombre] = (costosPorProducto[nombre] || 0) + Number(e.amount);
        }
      });

      const ranking = (productos || [])
        .filter(p => ventasPorProducto[p.id])
        .map(p => {
          const v = ventasPorProducto[p.id];
          const costo_total = p.cost_price != null
            ? Number(p.cost_price) * v.unidades
            : (costosPorProducto[p.name] || 0);
          const margen_bruto = v.ingresos - costo_total;
          const margen_pct = v.ingresos > 0 ? Number((margen_bruto / v.ingresos * 100).toFixed(1)) : null;
          return {
            nombre: p.name,
            unidades_vendidas: v.unidades,
            ingresos_totales: v.ingresos,
            costo_total,
            margen_bruto,
            margen_pct,
            tiene_costo: p.cost_price != null,
          };
        })
        .sort((a, b) => (b.margen_pct ?? -999) - (a.margen_pct ?? -999));

      const conMargen = ranking.filter(p => p.margen_pct !== null);
      const margen_promedio = conMargen.length > 0
        ? Number((conMargen.reduce((s, p) => s + p.margen_pct, 0) / conMargen.length).toFixed(1))
        : null;

      const totalIngresos = ranking.reduce((s, p) => s + p.ingresos_totales, 0);
      const totalCosto    = ranking.reduce((s, p) => s + p.costo_total, 0);
      const utilidadNeta  = totalIngresos - totalCosto;

      return {
        ranking,
        producto_mas_rentable:   conMargen[0] || null,
        producto_menos_rentable: conMargen[conMargen.length - 1] || null,
        margen_promedio_negocio: margen_promedio,
        resumen: { total_ingresos: totalIngresos, total_costo: totalCosto, utilidad_neta: utilidadNeta },
        periodo: `${inicioMes} al ${hoy}`,
        nota: conMargen.length < ranking.length ? 'Algunos productos no tienen costo definido; su margen no se puede calcular.' : null,
      };
    }

    case 'actualizar_cita': {
      const updateData = {};
      if (toolInput.client_id !== undefined)
        updateData.client_id = toolInput.client_id;
      if (toolInput.employee_id !== undefined)
        updateData.employee_id = toolInput.employee_id;
      if (toolInput.service_id !== undefined)
        updateData.service_id = toolInput.service_id;
      if (toolInput.notes !== undefined)
        updateData.notes = toolInput.notes;

      if (toolInput.scheduled_at !== undefined) {
        let scheduledAt = toolInput.scheduled_at;
        if (scheduledAt) {
          if (scheduledAt.endsWith('Z')) {
            scheduledAt = scheduledAt.slice(0, -1) + '-05:00';
          } else if (scheduledAt.includes('+00:00')) {
            scheduledAt = scheduledAt.replace('+00:00', '-05:00');
          } else if (!scheduledAt.includes('+') && !scheduledAt.includes('-05:00')) {
            scheduledAt = scheduledAt.includes('T') ? scheduledAt + '-05:00' : scheduledAt;
          }
        }
        updateData.scheduled_at = scheduledAt;
      }

      const { data, error } = await supabaseAdmin
        .from('appointments')
        .update(updateData)
        .eq('id', toolInput.appointment_id)
        .eq('business_id', businessId)
        .select('id');

      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) {
        return { success: false, error: 'Registro no encontrado' };
      }

      if (toolInput.service_id) {
        const { data: newSvc } = await supabaseAdmin
          .from('services')
          .select('price')
          .eq('id', toolInput.service_id)
          .single();
        if (newSvc?.price) {
          await supabaseAdmin
            .from('income')
            .update({ amount: newSvc.price })
            .eq('appointment_id', toolInput.appointment_id)
            .eq('business_id', businessId);
        }
      }

      return { success: true };
    }

    case 'proyeccion_mes': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const inicioMes = hoy.slice(0, 7) + '-01';
      const diaActual = parseInt(hoy.split('-')[2]);
      const diasEnMes = new Date(
        parseInt(hoy.split('-')[0]),
        parseInt(hoy.split('-')[1]),
        0
      ).getDate();

      const [{ data: ingresosMes }, { data: citasMes }] = await Promise.all([
        supabaseAdmin.from('income').select('amount, date')
          .eq('business_id', businessId)
          .gte('date', inicioMes).lte('date', hoy),
        supabaseAdmin.from('appointments').select('scheduled_at, price')
          .eq('business_id', businessId)
          .in('status', ['confirmed', 'completed'])
          .gte('scheduled_at', inicioMes + 'T00:00:00-05:00')
          .lte('scheduled_at', hoy + 'T23:59:59-05:00')
      ]);

      const ingresoAcumulado = (ingresosMes || []).reduce((s, i) => s + Number(i.amount), 0);
      const promedioDiario = diaActual > 0 ? ingresoAcumulado / diaActual : 0;
      const diasRestantes = diasEnMes - diaActual;
      const proyeccionTotal = ingresoAcumulado + (promedioDiario * diasRestantes);
      const citasAcumuladas = citasMes?.length || 0;
      const promedioCitasDia = diaActual > 0 ? citasAcumuladas / diaActual : 0;
      const proyeccionCitas = Math.round(citasAcumuladas + (promedioCitasDia * diasRestantes));

      return {
        ingreso_acumulado: Math.round(ingresoAcumulado),
        promedio_diario: Math.round(promedioDiario),
        dias_transcurridos: diaActual,
        dias_restantes: diasRestantes,
        proyeccion_total_mes: Math.round(proyeccionTotal),
        citas_acumuladas: citasAcumuladas,
        proyeccion_citas_mes: proyeccionCitas,
        porcentaje_mes_transcurrido: Math.round((diaActual / diasEnMes) * 100)
      };
    }

    case 'comparativo_meses': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const [year, month] = hoy.split('-').map(Number);
      const inicioMesActual = `${year}-${String(month).padStart(2,'0')}-01`;
      const mesAnterior = month === 1 ? 12 : month - 1;
      const yearAnterior = month === 1 ? year - 1 : year;
      const inicioMesAnterior = `${yearAnterior}-${String(mesAnterior).padStart(2,'0')}-01`;
      const finMesAnterior = `${year}-${String(month).padStart(2,'0')}-01`;

      const [
        { data: ingActual }, { data: ingAnterior },
        { data: citasActual }, { data: citasAnterior },
        { data: clientesActual }, { data: clientesAnterior }
      ] = await Promise.all([
        supabaseAdmin.from('income').select('amount').eq('business_id', businessId).gte('date', inicioMesActual).lte('date', hoy),
        supabaseAdmin.from('income').select('amount').eq('business_id', businessId).gte('date', inicioMesAnterior).lt('date', finMesAnterior),
        supabaseAdmin.from('appointments').select('price').eq('business_id', businessId).in('status',['confirmed','completed']).gte('scheduled_at', inicioMesActual + 'T00:00:00-05:00').lte('scheduled_at', hoy + 'T23:59:59-05:00'),
        supabaseAdmin.from('appointments').select('price').eq('business_id', businessId).in('status',['confirmed','completed']).gte('scheduled_at', inicioMesAnterior + 'T00:00:00-05:00').lt('scheduled_at', finMesAnterior + 'T00:00:00-05:00'),
        supabaseAdmin.from('clients').select('id').eq('business_id', businessId).gte('created_at', inicioMesActual + 'T00:00:00-05:00'),
        supabaseAdmin.from('clients').select('id').eq('business_id', businessId).gte('created_at', inicioMesAnterior + 'T00:00:00-05:00').lt('created_at', finMesAnterior + 'T00:00:00-05:00')
      ]);

      const totalActual = (ingActual || []).reduce((s,i) => s + Number(i.amount), 0);
      const totalAnterior = (ingAnterior || []).reduce((s,i) => s + Number(i.amount), 0);
      const crecimiento = totalAnterior > 0 ? ((totalActual - totalAnterior) / totalAnterior * 100).toFixed(1) : null;

      const ticketActual = citasActual?.length > 0 ? totalActual / citasActual.length : 0;
      const ticketAnterior = citasAnterior?.length > 0 ? totalAnterior / citasAnterior.length : 0;

      return {
        mes_actual: {
          ingresos: Math.round(totalActual),
          citas: citasActual?.length || 0,
          clientes_nuevos: clientesActual?.length || 0,
          ticket_promedio: Math.round(ticketActual)
        },
        mes_anterior: {
          ingresos: Math.round(totalAnterior),
          citas: citasAnterior?.length || 0,
          clientes_nuevos: clientesAnterior?.length || 0,
          ticket_promedio: Math.round(ticketAnterior)
        },
        crecimiento_ingresos_pct: crecimiento ? Number(crecimiento) : null,
        tendencia: crecimiento > 0 ? 'creciendo' : crecimiento < 0 ? 'bajando' : 'estable'
      };
    }

    case 'ticket_promedio': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const inicioMes = hoy.slice(0,7) + '-01';

      const { data: citas } = await supabaseAdmin
        .from('appointments')
        .select('price, services(name), employees(name)')
        .eq('business_id', businessId)
        .eq('status', 'completed')
        .gte('scheduled_at', inicioMes + 'T00:00:00-05:00')
        .lte('scheduled_at', hoy + 'T23:59:59-05:00');

      const porServicio = {};
      const porEmpleado = {};

      (citas || []).forEach(c => {
        const servicio = c.services?.name || 'Sin servicio';
        const empleado = c.employees?.name || 'Sin asignar';
        const precio = Number(c.price || 0);

        if (!porServicio[servicio]) porServicio[servicio] = { total: 0, count: 0 };
        porServicio[servicio].total += precio;
        porServicio[servicio].count++;

        if (!porEmpleado[empleado]) porEmpleado[empleado] = { total: 0, count: 0 };
        porEmpleado[empleado].total += precio;
        porEmpleado[empleado].count++;
      });

      const ticketPorServicio = Object.entries(porServicio)
        .map(([nombre, d]) => ({ nombre, ticket_promedio: Math.round(d.total / d.count), total_citas: d.count, ingresos_total: d.total }))
        .sort((a,b) => b.ticket_promedio - a.ticket_promedio);

      const ticketPorEmpleado = Object.entries(porEmpleado)
        .map(([nombre, d]) => ({ nombre, ticket_promedio: Math.round(d.total / d.count), total_citas: d.count, ingresos_total: d.total }))
        .sort((a,b) => b.ingresos_total - a.ingresos_total);

      const totalGeneral = (citas || []).reduce((s,c) => s + Number(c.price || 0), 0);
      const ticketGeneral = citas?.length > 0 ? Math.round(totalGeneral / citas.length) : 0;

      return { ticket_general: ticketGeneral, por_servicio: ticketPorServicio, por_empleado: ticketPorEmpleado, total_citas: citas?.length || 0 };
    }

    case 'horas_rentables': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const hace30 = new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA', bogota);

      const { data: citas } = await supabaseAdmin
        .from('appointments')
        .select('scheduled_at, price')
        .eq('business_id', businessId)
        .eq('status', 'completed')
        .gte('scheduled_at', hace30 + 'T00:00:00-05:00')
        .lte('scheduled_at', hoy + 'T23:59:59-05:00');

      const diasSemana = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
      const porDia = {};
      const porHora = {};

      (citas || []).forEach(c => {
        const fecha = new Date(c.scheduled_at);
        const diaNombreRaw = new Date(c.scheduled_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long' });
        const dia = diaNombreRaw.charAt(0).toUpperCase() + diaNombreRaw.slice(1);
        const hora = new Date(c.scheduled_at).toLocaleString('en-CA', { timeZone: 'America/Bogota', hour: '2-digit', hour12: false });
        const precio = Number(c.price || 0);

        if (!porDia[dia]) porDia[dia] = { citas: 0, ingresos: 0 };
        porDia[dia].citas++;
        porDia[dia].ingresos += precio;

        if (!porHora[hora]) porHora[hora] = { citas: 0, ingresos: 0 };
        porHora[hora].citas++;
        porHora[hora].ingresos += precio;
      });

      const rankingDias = Object.entries(porDia)
        .map(([dia, d]) => ({ dia, ...d }))
        .sort((a,b) => b.ingresos - a.ingresos);

      const rankingHoras = Object.entries(porHora)
        .map(([hora, d]) => ({ hora: hora + ':00', ...d }))
        .sort((a,b) => b.ingresos - a.ingresos)
        .slice(0, 5);

      return {
        dias_mas_rentables: rankingDias,
        horas_mas_rentables: rankingHoras,
        periodo: 'últimos 30 días'
      };
    }

    case 'clientes_riesgo': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const hace30 = new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA', bogota);
      const hace90 = new Date(Date.now() - 90 * 86400000).toLocaleDateString('en-CA', bogota);

      const { data: citasVentana } = await supabaseAdmin
        .from('appointments')
        .select('client_id, scheduled_at')
        .eq('business_id', businessId)
        .eq('status', 'completed')
        .gte('scheduled_at', hace90 + 'T00:00:00-05:00')
        .lte('scheduled_at', hace30 + 'T23:59:59-05:00');

      const { data: citasRecientes } = await supabaseAdmin
        .from('appointments')
        .select('client_id')
        .eq('business_id', businessId)
        .eq('status', 'completed')
        .gte('scheduled_at', hace30 + 'T00:00:00-05:00');

      const idsRecientes = new Set((citasRecientes || []).map(c => c.client_id));
      const idsEnRiesgo = [...new Set(
        (citasVentana || [])
          .filter(c => c.client_id && !idsRecientes.has(c.client_id))
          .map(c => c.client_id)
      )].slice(0, 20);

      // Excluir clientes que ya recibieron recordatorio en los últimos 15 días
      const hace15 = new Date(Date.now() - 15 * 86400000)
        .toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

      const { data: recallRecientes } = await supabaseAdmin
        .from('recall_logs')
        .select('client_id')
        .eq('business_id', businessId)
        .gte('date', hace15);

      const idsRecallReciente = new Set((recallRecientes || []).map(r => r.client_id));
      const idsEnRiesgoFiltrados = idsEnRiesgo.filter(id => !idsRecallReciente.has(id));

      if (idsEnRiesgoFiltrados.length === 0) {
        return { clientes_en_riesgo: [], mensaje: 'No hay clientes en riesgo actualmente 🎉', ya_contactados_15_dias: idsEnRiesgo.length };
      }

      const { data: clientes } = await supabaseAdmin
        .from('clients')
        .select('id, name, phone')
        .in('id', idsEnRiesgoFiltrados);

      const clientesConFecha = (clientes || []).map(c => {
        const ultimaCita = citasVentana
          .filter(a => a.client_id === c.id)
          .sort((a,b) => new Date(b.scheduled_at) - new Date(a.scheduled_at))[0];
        const diasSinVisita = ultimaCita
          ? Math.floor((new Date() - new Date(ultimaCita.scheduled_at)) / 86400000)
          : null;
        const ultimaVisitaCol = ultimaCita?.scheduled_at
          ? new Date(ultimaCita.scheduled_at).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
          : null;
        return { ...c, dias_sin_visita: diasSinVisita, ultima_visita: ultimaVisitaCol };
      }).sort((a,b) => (b.dias_sin_visita || 0) - (a.dias_sin_visita || 0));

      return {
        clientes_en_riesgo: clientesConFecha,
        total: clientesConFecha.length,
        mensaje: `${clientesConFecha.length} clientes no han vuelto en 30-90 días`,
        ya_contactados_15_dias: idsEnRiesgo.length - idsEnRiesgoFiltrados.length
      };
    }

    case 'clientes_valiosos': {
      const { data: citas } = await supabaseAdmin
        .from('appointments')
        .select('client_id, price, clients(name, phone)')
        .eq('business_id', businessId)
        .eq('status', 'completed')
        .not('client_id', 'is', null);

      const resumen = {};
      (citas || []).forEach(c => {
        if (!c.client_id) return;
        if (!resumen[c.client_id]) {
          resumen[c.client_id] = {
            nombre: c.clients?.name || 'Sin nombre',
            phone: c.clients?.phone,
            visitas: 0,
            total_gastado: 0
          };
        }
        resumen[c.client_id].visitas++;
        resumen[c.client_id].total_gastado += Number(c.price || 0);
      });

      const top10 = Object.values(resumen)
        .sort((a,b) => b.total_gastado - a.total_gastado)
        .slice(0, 10);

      return { top_clientes: top10, total_analizados: Object.keys(resumen).length };
    }

    case 'retencion_clientes': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const [year, month] = hoy.split('-').map(Number);
      const inicioMesActual = `${year}-${String(month).padStart(2,'0')}-01`;
      const mesAnterior = month === 1 ? 12 : month - 1;
      const yearAnterior = month === 1 ? year - 1 : year;
      const inicioMesAnterior = `${yearAnterior}-${String(mesAnterior).padStart(2,'0')}-01`;
      const finMesAnterior = inicioMesActual;

      const [{ data: citasAnterior }, { data: citasActual }] = await Promise.all([
        supabaseAdmin.from('appointments').select('client_id').eq('business_id', businessId).eq('status','completed').gte('scheduled_at', inicioMesAnterior + 'T00:00:00-05:00').lt('scheduled_at', finMesAnterior + 'T00:00:00-05:00').not('client_id','is',null),
        supabaseAdmin.from('appointments').select('client_id').eq('business_id', businessId).eq('status','completed').gte('scheduled_at', inicioMesActual + 'T00:00:00-05:00').lte('scheduled_at', hoy + 'T23:59:59-05:00').not('client_id','is',null)
      ]);

      const idsAnterior = new Set((citasAnterior || []).map(c => c.client_id));
      const idsActual = new Set((citasActual || []).map(c => c.client_id));
      const volvieron = [...idsAnterior].filter(id => idsActual.has(id)).length;
      const nuevos = [...idsActual].filter(id => !idsAnterior.has(id)).length;
      const perdidos = [...idsAnterior].filter(id => !idsActual.has(id)).length;
      const tasaRetencion = idsAnterior.size > 0 ? Math.round((volvieron / idsAnterior.size) * 100) : 0;

      return {
        clientes_mes_anterior: idsAnterior.size,
        clientes_mes_actual: idsActual.size,
        volvieron,
        nuevos,
        perdidos,
        tasa_retencion_pct: tasaRetencion,
        interpretacion: tasaRetencion >= 70 ? 'Excelente retención 🟢' : tasaRetencion >= 50 ? 'Retención aceptable 🟡' : 'Retención baja — hay que trabajar en fidelización 🔴'
      };
    }

    case 'alertas_negocio': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const hace7 = new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA', bogota);
      const hace30 = new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA', bogota);
      const hace90 = new Date(Date.now() - 90 * 86400000).toLocaleDateString('en-CA', bogota);
      const inicioMes = hoy.slice(0,7) + '-01';

      const [
        { data: productosStockRaw },
        { data: citasUltimos7 },
        { data: empleados },
        { data: citasEmpleados },
        { data: ingresosActual },
        { data: ingresosAnterior },
        { data: citasRiesgo },
        { data: citasRecientes }
      ] = await Promise.all([
        supabaseAdmin.from('products').select('name, stock, min_stock').eq('business_id', businessId).eq('is_active', true),
        supabaseAdmin.from('appointments').select('scheduled_at').eq('business_id', businessId).gte('scheduled_at', hace7 + 'T00:00:00-05:00').lte('scheduled_at', hoy + 'T23:59:59-05:00'),
        supabaseAdmin.from('employees').select('id, name').eq('business_id', businessId).eq('is_active', true),
        supabaseAdmin.from('appointments').select('employee_id').eq('business_id', businessId).eq('status','completed').gte('scheduled_at', hace7 + 'T00:00:00-05:00'),
        supabaseAdmin.from('income').select('amount').eq('business_id', businessId).gte('date', inicioMes),
        supabaseAdmin.from('income').select('amount').eq('business_id', businessId).gte('date', hoy.slice(0,4) + '-' + String(parseInt(hoy.split('-')[1]) === 1 ? 12 : parseInt(hoy.split('-')[1]) - 1).padStart(2,'0') + '-01').lt('date', inicioMes),
        supabaseAdmin.from('appointments').select('client_id').eq('business_id', businessId).eq('status','completed').gte('scheduled_at', hace90 + 'T00:00:00-05:00').lte('scheduled_at', hace30 + 'T23:59:59-05:00').not('client_id','is',null),
        supabaseAdmin.from('appointments').select('client_id').eq('business_id', businessId).eq('status','completed').gte('scheduled_at', hace30 + 'T00:00:00-05:00').not('client_id','is',null)
      ]);

      const productosBajoStock = (productosStockRaw || []).filter(p => p.stock <= p.min_stock);

      const alertas = [];

      if (productosBajoStock?.length > 0) {
        alertas.push({
          tipo: 'stock_bajo',
          prioridad: 'alta',
          mensaje: `⚠️ ${productosBajoStock.length} producto(s) con stock bajo`,
          detalle: productosBajoStock.map(p => `${p.name}: ${p.stock} unidades (mínimo: ${p.min_stock})`)
        });
      }

      const empleadosActivos = new Set((citasEmpleados || []).map(c => c.employee_id));
      const empleadosSinActividad = (empleados || []).filter(e => !empleadosActivos.has(e.id));
      if (empleadosSinActividad.length > 0) {
        alertas.push({
          tipo: 'empleados_inactivos',
          prioridad: 'media',
          mensaje: `👤 ${empleadosSinActividad.length} empleado(s) sin citas esta semana`,
          detalle: empleadosSinActividad.map(e => e.name)
        });
      }

      const totalActual = (ingresosActual || []).reduce((s,i) => s + Number(i.amount), 0);
      const totalAnterior = (ingresosAnterior || []).reduce((s,i) => s + Number(i.amount), 0);
      const diaActual = parseInt(hoy.split('-')[2]);
      const diasMes = new Date(parseInt(hoy.split('-')[0]), parseInt(hoy.split('-')[1]), 0).getDate();
      const proyeccion = diaActual > 0 ? (totalActual / diaActual) * diasMes : 0;
      if (totalAnterior > 0 && proyeccion < totalAnterior * 0.8) {
        alertas.push({
          tipo: 'ingresos_bajos',
          prioridad: 'alta',
          mensaje: `📉 Proyección del mes está ${Math.round(((totalAnterior - proyeccion) / totalAnterior) * 100)}% por debajo del mes anterior`,
          detalle: [`Mes anterior: $${totalAnterior.toLocaleString('es-CO')}`, `Proyección actual: $${Math.round(proyeccion).toLocaleString('es-CO')}`]
        });
      }

      const idsRiesgo = new Set((citasRiesgo || []).map(c => c.client_id));
      const idsRecientes = new Set((citasRecientes || []).map(c => c.client_id));
      const enRiesgo = [...idsRiesgo].filter(id => !idsRecientes.has(id)).length;
      if (enRiesgo > 0) {
        alertas.push({
          tipo: 'clientes_riesgo',
          prioridad: 'media',
          mensaje: `👥 ${enRiesgo} cliente(s) no han vuelto en más de 30 días`,
          detalle: ['Considera enviarles un mensaje para recuperarlos']
        });
      }

      const citasHoy = (citasUltimos7 || []).filter(c => c.scheduled_at?.slice(0,10) === hoy).length;
      if (citasHoy === 0) {
        alertas.push({
          tipo: 'sin_citas_hoy',
          prioridad: 'baja',
          mensaje: '📅 No hay citas registradas para hoy',
          detalle: ['Puedes registrar citas manualmente o verificar la agenda']
        });
      }

      return {
        alertas,
        total_alertas: alertas.length,
        resumen: alertas.length === 0 ? 'Todo está en orden 🎉' : `Tienes ${alertas.length} alerta(s) que atender`
      };
    }

    case 'meta_mensual': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const inicioMes = hoy.slice(0,7) + '-01';
      const diaActual = parseInt(hoy.split('-')[2]);
      const diasMes = new Date(parseInt(hoy.split('-')[0]), parseInt(hoy.split('-')[1]), 0).getDate();
      const meta = toolInput.meta || 2000000;

      const { data: ingresos } = await supabaseAdmin
        .from('income').select('amount').eq('business_id', businessId).gte('date', inicioMes).lte('date', hoy);

      const acumulado = (ingresos || []).reduce((s,i) => s + Number(i.amount), 0);
      const falta = Math.max(0, meta - acumulado);
      const porcentaje = Math.round((acumulado / meta) * 100);
      const promedioDiario = diaActual > 0 ? acumulado / diaActual : 0;
      const diasRestantes = diasMes - diaActual;
      const necesarioPorDia = diasRestantes > 0 ? Math.round(falta / diasRestantes) : 0;
      const proyeccion = acumulado + (promedioDiario * diasRestantes);
      const vaALlegar = proyeccion >= meta;

      return {
        meta,
        acumulado: Math.round(acumulado),
        falta: Math.round(falta),
        porcentaje_completado: porcentaje,
        dias_restantes: diasRestantes,
        necesario_por_dia: necesarioPorDia,
        proyeccion_final: Math.round(proyeccion),
        va_a_llegar: vaALlegar,
        mensaje: vaALlegar
          ? `🟢 Vas bien! Con tu ritmo actual llegarás a $${Math.round(proyeccion).toLocaleString('es-CO')}`
          : `🔴 Necesitas $${necesarioPorDia.toLocaleString('es-CO')} diarios para llegar a la meta`
      };
    }

    case 'crear_empleado': {
      // Verificar límite de empleados activos según plan
      const { data: bizEmp } = await supabaseAdmin
        .from('businesses')
        .select('plan')
        .eq('id', businessId)
        .single();

      const planEmp = bizEmp?.plan || 'estandar';
      const limiteEmp = planEmp === 'pro' ? Infinity : planEmp === 'estandar' ? 5 : 2;

      if (toolInput.is_active !== false && limiteEmp !== Infinity) {
        const { count: activosCount } = await supabaseAdmin
          .from('employees')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('is_active', true);

        if ((activosCount || 0) >= limiteEmp) {
          const { data: empActivos } = await supabaseAdmin
            .from('employees')
            .select('id, name')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .order('name');

          return {
            success: false,
            limite_alcanzado: true,
            limite: limiteEmp,
            activos_actuales: activosCount,
            empleados_activos: empActivos || [],
            error: `Has alcanzado el límite de ${limiteEmp} empleados activos de tu plan ${planEmp}.`,
            opciones: [
              'Crear el empleado como inactivo (puedes activarlo después desactivando otro)',
              `Desactivar uno de los ${limiteEmp} empleados actuales para liberar un cupo`
            ]
          };
        }
      }

      const { data, error } = await supabaseAdmin
        .from('employees')
        .insert({
          business_id: businessId,
          name: formatName(toolInput.name),
          phone: toolInput.phone || null,
          email: toolInput.email || null,
          commission_percent: toolInput.commission_percent || null,
          is_active: toolInput.is_active !== false
        })
        .select('id, name')
        .single();

      if (error) return { success: false, error: error.message };
      return { success: true, empleado: data };
    }

    case 'actualizar_empleado': {
      const updateData = {};
      if (toolInput.name !== undefined) updateData.name = formatName(toolInput.name);
      if (toolInput.phone !== undefined) updateData.phone = toolInput.phone;
      if (toolInput.commission_percent !== undefined) updateData.commission_percent = toolInput.commission_percent;
      if (toolInput.is_active !== undefined) updateData.is_active = toolInput.is_active;
      const { data, error } = await supabaseAdmin
        .from('employees')
        .update(updateData)
        .eq('id', toolInput.employee_id)
        .eq('business_id', businessId)
        .select('id');

      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) {
        return { success: false, error: 'Registro no encontrado' };
      }

      return { success: true };
    }

    case 'crear_servicio': {
      const { data, error } = await supabaseAdmin
        .from('services')
        .insert({
          business_id: businessId,
          name: toolInput.name,
          price: toolInput.price,
          duration_minutes: toolInput.duration_minutes,
          description: toolInput.description || null,
          active: true
        })
        .select('id, name, price')
        .single();
      if (error) return { success: false, error: error.message };
      return { success: true, servicio: data };
    }

    case 'registrar_egreso': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const { error } = await supabaseAdmin
        .from('expenses')
        .insert({
          business_id: businessId,
          amount: toolInput.amount,
          description: toolInput.description,
          category: toolInput.category,
          date: toolInput.date || hoy
        });
      return { success: !error, error: error?.message };
    }

    case 'ver_egresos': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const inicios = {
        today: hoy,
        week: new Date(Date.now() - 7*86400000).toLocaleDateString('en-CA', bogota),
        month: hoy.slice(0,7) + '-01'
      };
      const { data } = await supabaseAdmin
        .from('expenses')
        .select('amount, description, category, date')
        .eq('business_id', businessId)
        .neq('category', 'costo_producto')
        .gte('date', inicios[toolInput.period])
        .lte('date', hoy)
        .order('date', { ascending: false });

      const total = (data || []).reduce((s,e) => s + Number(e.amount), 0);
      const porCategoria = {};
      (data || []).forEach(e => {
        porCategoria[e.category] = (porCategoria[e.category] || 0) + Number(e.amount);
      });
      delete porCategoria['costo_producto'];

      return { egresos: data || [], total, por_categoria: porCategoria, period: toolInput.period };
    }

    case 'buscar_egreso': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      let fechaInicio = toolInput.fecha || hoy;
      let fechaFin = toolInput.fecha || hoy;

      if (toolInput.period) {
        const inicios = {
          today: hoy,
          week: new Date(Date.now() - 7*86400000).toLocaleDateString('en-CA', bogota),
          month: hoy.slice(0,7) + '-01'
        };
        fechaInicio = inicios[toolInput.period];
        fechaFin = hoy;
      }

      let query = supabaseAdmin
        .from('expenses')
        .select('id, amount, description, category, date')
        .eq('business_id', businessId)
        .neq('category', 'costo_producto')
        .gte('date', fechaInicio)
        .lte('date', fechaFin)
        .order('date', { ascending: false })
        .limit(10);

      if (toolInput.descripcion) query = query.ilike('description', `%${toolInput.descripcion}%`);
      if (toolInput.categoria) query = query.eq('category', toolInput.categoria);

      const { data } = await query;
      if (!data || data.length === 0) return { found: false, message: 'No se encontraron egresos con esos criterios' };
      return { found: true, egresos: data, total: data.length };
    }

    case 'buscar_ingreso': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      let fechaInicio = toolInput.fecha || hoy;
      let fechaFin = toolInput.fecha || hoy;

      if (toolInput.period) {
        const inicios = {
          today: hoy,
          week: new Date(Date.now() - 7*86400000).toLocaleDateString('en-CA', bogota),
          month: hoy.slice(0,7) + '-01'
        };
        fechaInicio = inicios[toolInput.period];
        fechaFin = hoy;
      }

      let query = supabaseAdmin
        .from('income')
        .select('id, amount, description, category, source, date')
        .eq('business_id', businessId)
        .eq('source', 'manual')
        .gte('date', fechaInicio)
        .lte('date', fechaFin)
        .order('date', { ascending: false })
        .limit(10);

      if (toolInput.descripcion) query = query.ilike('description', `%${toolInput.descripcion}%`);

      const { data } = await query;
      if (!data || data.length === 0) return { found: false, message: 'No se encontraron ingresos manuales con esos criterios' };
      return { found: true, ingresos: data, total: data.length };
    }

    case 'registrar_ingreso': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const { error } = await supabaseAdmin
        .from('income')
        .insert({
          business_id: businessId,
          amount: toolInput.amount,
          description: toolInput.description,
          category: toolInput.category,
          date: toolInput.date || hoy,
          source: 'manual'
        });
      return { success: !error, error: error?.message };
    }

    case 'eliminar_egreso': {
      const { data, error } = await supabaseAdmin
        .from('expenses')
        .delete()
        .eq('id', toolInput.expense_id)
        .eq('business_id', businessId)
        .neq('category', 'costo_producto')
        .select('id');

      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) return { success: false, error: 'Egreso no encontrado o no se puede eliminar (es un costo automático de venta).' };
      return { success: true, message: 'Egreso eliminado correctamente' };
    }

    case 'eliminar_ingreso': {
      const { data, error } = await supabaseAdmin
        .from('income')
        .delete()
        .eq('id', toolInput.income_id)
        .eq('business_id', businessId)
        .eq('source', 'manual')
        .select('id');

      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) return { success: false, error: 'Ingreso no encontrado. Solo se pueden eliminar ingresos manuales, no los de citas o ventas.' };
      return { success: true, message: 'Ingreso eliminado correctamente' };
    }

    case 'ver_ingresos': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const inicios = {
        today: hoy,
        week: new Date(Date.now() - 7*86400000).toLocaleDateString('en-CA', bogota),
        month: hoy.slice(0,7) + '-01'
      };
      const { data } = await supabaseAdmin
        .from('income')
        .select('id, amount, description, category, source, date')
        .eq('business_id', businessId)
        .gte('date', inicios[toolInput.period])
        .lte('date', hoy)
        .order('date', { ascending: false });

      const total = (data || []).reduce((s, i) => s + Number(i.amount), 0);
      const porCategoria = {};
      const porFuente = {};
      (data || []).forEach(i => {
        porCategoria[i.category || 'otro'] = (porCategoria[i.category || 'otro'] || 0) + Number(i.amount);
        porFuente[i.source || 'manual'] = (porFuente[i.source || 'manual'] || 0) + Number(i.amount);
      });

      return { ingresos: data || [], total, por_categoria: porCategoria, por_fuente: porFuente, period: toolInput.period };
    }

    case 'actualizar_configuracion': {
      const { tipo } = toolInput;

      if (tipo === 'perfil') {
        const patch = {};
        if (toolInput.nombre) patch.name = toolInput.nombre.trim();
        if (toolInput.telefono !== undefined) patch.phone = toolInput.telefono?.trim() || null;
        if (toolInput.direccion !== undefined) patch.address = toolInput.direccion?.trim() || null;
        if (Object.keys(patch).length === 0) return { success: false, error: 'No hay datos para actualizar.' };
        const { error } = await supabaseAdmin.from('businesses').update(patch).eq('id', businessId);
        return { success: !error, error: error?.message };
      }

      if (tipo === 'meta_mensual') {
        if (!toolInput.meta || toolInput.meta <= 0) return { success: false, error: 'Meta inválida.' };
        const hoyCol = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
        const month = hoyCol.slice(0, 7) + '-01';
        const { error } = await supabaseAdmin
          .from('monthly_goals')
          .upsert({ business_id: businessId, month, income_goal: toolInput.meta }, { onConflict: 'business_id,month' });
        return { success: !error, meta: toolInput.meta, error: error?.message };
      }

      if (tipo === 'horario') {
        if (toolInput.dia_semana === undefined) return { success: false, error: 'Falta el día de la semana.' };
        const patch = { business_id: businessId, day_of_week: toolInput.dia_semana };
        if (toolInput.hora_apertura) patch.open_time = toolInput.hora_apertura;
        if (toolInput.hora_cierre) patch.close_time = toolInput.hora_cierre;
        if (toolInput.is_open !== undefined) patch.is_open = toolInput.is_open;
        const { error } = await supabaseAdmin
          .from('business_hours')
          .upsert(patch, { onConflict: 'business_id,day_of_week' });
        return { success: !error, error: error?.message };
      }

      return { success: false, error: 'Tipo de configuración no reconocido.' };
    }

    case 'ver_configuracion': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const en30 = new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-CA', bogota);

      const [
        { data: biz },
        { data: horarios },
        { data: meta },
        { data: diasCerrados }
      ] = await Promise.all([
        supabaseAdmin.from('businesses').select('name, phone, address, business_type, country, owner_name').eq('id', businessId).single(),
        supabaseAdmin.from('business_hours').select('day_of_week, open_time, close_time, is_open').eq('business_id', businessId).order('day_of_week'),
        supabaseAdmin.from('monthly_goals').select('income_goal').eq('business_id', businessId).order('month', { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin.from('business_closed_days').select('date, reason').eq('business_id', businessId).gte('date', hoy).lte('date', en30).order('date')
      ]);

      const diasSemana = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
      const horariosFormateados = (horarios || []).map(h => ({
        dia: diasSemana[h.day_of_week],
        abierto: h.is_open,
        apertura: h.open_time,
        cierre: h.close_time
      }));

      return {
        perfil: biz,
        horarios: horariosFormateados,
        meta_mensual: meta?.income_goal || null,
        meta_configurada: !!meta?.income_goal,
        dias_cerrados_proximos: diasCerrados || []
      };
    }

    case 'calcular_comisiones': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const [year, month, day] = hoy.split('-').map(Number);

      let fechaInicio, fechaFin, periodoLabel;

      if (toolInput.period === 'quincena') {
        const q = toolInput.quincena || (day <= 15 ? 1 : 2);
        if (q === 1) {
          fechaInicio = `${year}-${String(month).padStart(2,'0')}-01`;
          fechaFin = `${year}-${String(month).padStart(2,'0')}-15`;
          periodoLabel = `1ra quincena`;
        } else {
          const ultimoDia = new Date(year, month, 0).getDate();
          fechaInicio = `${year}-${String(month).padStart(2,'0')}-16`;
          fechaFin = `${year}-${String(month).padStart(2,'0')}-${ultimoDia}`;
          periodoLabel = `2da quincena`;
        }
      } else if (toolInput.period === 'month') {
        fechaInicio = `${year}-${String(month).padStart(2,'0')}-01`;
        fechaFin = hoy;
        periodoLabel = 'este mes';
      } else {
        fechaInicio = new Date(Date.now() - 7*86400000).toLocaleDateString('en-CA', bogota);
        fechaFin = hoy;
        periodoLabel = 'esta semana';
      }

      const [{ data: empleados }, { data: citas }] = await Promise.all([
        supabaseAdmin.from('employees').select('id, name, commission_percent, is_active').eq('business_id', businessId),
        supabaseAdmin.from('appointments').select('employee_id, price').eq('business_id', businessId).eq('status', 'completed').gte('scheduled_at', `${fechaInicio}T00:00:00-05:00`).lte('scheduled_at', `${fechaFin}T23:59:59-05:00`)
      ]);

      const citasPorEmpleado = {};
      (citas || []).forEach(c => {
        if (!c.employee_id) return;
        if (!citasPorEmpleado[c.employee_id]) citasPorEmpleado[c.employee_id] = { citas: 0, ingresos: 0 };
        citasPorEmpleado[c.employee_id].citas++;
        citasPorEmpleado[c.employee_id].ingresos += Number(c.price || 0);
      });

      const liquidacion = (empleados || []).map(e => {
        const datos = citasPorEmpleado[e.id] || { citas: 0, ingresos: 0 };
        const comisionPct = e.commission_percent || 0;
        const comisionCalculada = Math.round(datos.ingresos * (comisionPct / 100));
        const identificador = e.phone
          ? `${e.name} (${e.phone})`
          : e.email
          ? `${e.name} (${e.email})`
          : e.name;
        return {
          nombre: identificador,
          activo: e.is_active,
          citas_completadas: datos.citas,
          ingresos_generados: datos.ingresos,
          tipo_comision: comisionPct > 0 ? `${comisionPct}%` : 'sin comisión',
          comision_a_pagar: comisionCalculada
        };
      }).sort((a, b) => b.comision_a_pagar - a.comision_a_pagar)
        .filter(e => e.citas_completadas > 0);

      const totalAPagar = liquidacion.reduce((s, e) => s + e.comision_a_pagar, 0);

      return {
        periodo: periodoLabel,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        liquidacion,
        total_a_pagar: totalAPagar
      };
    }

    case 'resumen_dia': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', bogota);
      const horaActual = new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: true });

      const [
        { data: citasHoy },
        { data: ingresosHoy },
        { data: ingresosAyer },
        { data: citasPendientes },
        { data: stockBajoRaw }
      ] = await Promise.all([
        supabaseAdmin.from('appointments').select('id, scheduled_at, status, price, clients(name), services(name), employees(name)').eq('business_id', businessId).gte('scheduled_at', `${hoy}T00:00:00-05:00`).lte('scheduled_at', `${hoy}T23:59:59-05:00`).not('status', 'in', '("cancelled")').order('scheduled_at'),
        supabaseAdmin.from('income').select('amount').eq('business_id', businessId).eq('date', hoy),
        supabaseAdmin.from('income').select('amount').eq('business_id', businessId).eq('date', ayer),
        supabaseAdmin.from('appointments').select('id').eq('business_id', businessId).eq('status', 'pending').gte('scheduled_at', `${hoy}T00:00:00-05:00`),
        supabaseAdmin.from('products').select('name, stock, min_stock').eq('business_id', businessId).eq('is_active', true)
      ]);

      const stockBajo = (stockBajoRaw || []).filter(p => p.stock <= p.min_stock).slice(0, 3);

      const totalHoy = (ingresosHoy || []).reduce((s, i) => s + Number(i.amount), 0);
      const totalAyer = (ingresosAyer || []).reduce((s, i) => s + Number(i.amount), 0);

      const ahora = new Date();
      const proximaCita = (citasHoy || []).find(c => {
        return c.status !== 'completed' && c.status !== 'cancelled' && new Date(c.scheduled_at) >= ahora;
      });

      const citas = (citasHoy || []).map(a => ({
        hora: new Date(a.scheduled_at).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: true }),
        cliente: a.clients?.name || 'Walk-in',
        servicio: a.services?.name || 'Sin servicio',
        empleado: a.employees?.name || 'Sin asignar',
        status: a.status
      }));

      return {
        hora_consulta: horaActual,
        resumen: {
          total_citas_hoy: citasHoy?.length || 0,
          citas_completadas: (citasHoy || []).filter(c => c.status === 'completed').length,
          citas_pendientes_confirmar: citasPendientes?.length || 0,
          ingresos_hoy: Math.round(totalHoy),
          ingresos_ayer: Math.round(totalAyer),
          diferencia_vs_ayer: Math.round(totalHoy - totalAyer),
          tendencia: totalHoy >= totalAyer ? 'igual_o_mejor' : 'por_debajo'
        },
        citas_hoy: citas,
        proxima_cita: proximaCita ? {
          hora: new Date(proximaCita.scheduled_at).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: true }),
          cliente: proximaCita.clients?.name || 'Walk-in',
          servicio: proximaCita.services?.name
        } : null,
        alertas_urgentes: {
          stock_bajo: (stockBajo || []).map(p => `${p.name}: ${p.stock} unidades`),
          citas_sin_confirmar: citasPendientes?.length || 0
        }
      };
    }

    case 'diagnostico_negocio': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const [year, month] = hoy.split('-').map(Number);
      const inicioMes = `${year}-${String(month).padStart(2,'0')}-01`;
      const mesAnterior = month === 1 ? 12 : month - 1;
      const yearAnterior = month === 1 ? year - 1 : year;
      const inicioMesAnterior = `${yearAnterior}-${String(mesAnterior).padStart(2,'0')}-01`;
      const hace30 = new Date(Date.now() - 30*86400000).toLocaleDateString('en-CA', bogota);
      const hace90 = new Date(Date.now() - 90*86400000).toLocaleDateString('en-CA', bogota);
      const diaActual = parseInt(hoy.split('-')[2]);
      const diasMes = new Date(year, month, 0).getDate();

      const [
        { data: ingMes }, { data: ingMesAnt },
        { data: citasMes }, { data: citasMesAnt },
        { data: clientesNuevos },
        { data: citasRiesgo }, { data: citasRecientes },
        { data: empleados }, { data: citasEmpleados },
        { data: stockBajoRawDiag },
        { data: meta }
      ] = await Promise.all([
        supabaseAdmin.from('income').select('amount').eq('business_id', businessId).gte('date', inicioMes).lte('date', hoy),
        supabaseAdmin.from('income').select('amount').eq('business_id', businessId).gte('date', inicioMesAnterior).lt('date', inicioMes),
        supabaseAdmin.from('appointments').select('id').eq('business_id', businessId).eq('status', 'completed').gte('scheduled_at', `${inicioMes}T00:00:00-05:00`),
        supabaseAdmin.from('appointments').select('id').eq('business_id', businessId).eq('status', 'completed').gte('scheduled_at', `${inicioMesAnterior}T00:00:00-05:00`).lt('scheduled_at', `${inicioMes}T00:00:00-05:00`),
        supabaseAdmin.from('clients').select('id').eq('business_id', businessId).gte('created_at', `${inicioMes}T00:00:00-05:00`),
        supabaseAdmin.from('appointments').select('client_id').eq('business_id', businessId).eq('status', 'completed').gte('scheduled_at', `${hace90}T00:00:00-05:00`).lte('scheduled_at', `${hace30}T23:59:59-05:00`).not('client_id', 'is', null),
        supabaseAdmin.from('appointments').select('client_id').eq('business_id', businessId).eq('status', 'completed').gte('scheduled_at', `${hace30}T00:00:00-05:00`).not('client_id', 'is', null),
        supabaseAdmin.from('employees').select('id, name').eq('business_id', businessId).eq('is_active', true),
        supabaseAdmin.from('appointments').select('employee_id').eq('business_id', businessId).eq('status', 'completed').gte('scheduled_at', `${inicioMes}T00:00:00-05:00`),
        supabaseAdmin.from('products').select('name, stock, min_stock').eq('business_id', businessId).eq('is_active', true),
        supabaseAdmin.from('monthly_goals').select('income_goal').eq('business_id', businessId).order('month', { ascending: false }).limit(1).maybeSingle()
      ]);

      const stockBajo = (stockBajoRawDiag || []).filter(p => p.stock <= p.min_stock);

      const totalMes = (ingMes || []).reduce((s, i) => s + Number(i.amount), 0);
      const totalMesAnt = (ingMesAnt || []).reduce((s, i) => s + Number(i.amount), 0);
      const crecimientoPct = totalMesAnt > 0 ? Number(((totalMes - totalMesAnt) / totalMesAnt * 100).toFixed(1)) : null;
      const promedioDiario = diaActual > 0 ? totalMes / diaActual : 0;
      const proyeccion = Math.round(promedioDiario * diasMes);
      const metaValor = meta?.income_goal || null;

      const idsRiesgo = new Set((citasRiesgo || []).map(c => c.client_id));
      const idsRecientes = new Set((citasRecientes || []).map(c => c.client_id));
      const clientesEnRiesgo = [...idsRiesgo].filter(id => !idsRecientes.has(id)).length;

      const empleadosActivos = new Set((citasEmpleados || []).map(c => c.employee_id));
      const empleadosSinActividad = (empleados || []).filter(e => !empleadosActivos.has(e.id)).map(e => e.name);

      const fortalezas = [];
      const problemas = [];
      const recomendaciones = [];

      if (crecimientoPct !== null && crecimientoPct > 0) fortalezas.push(`Ingresos creciendo ${crecimientoPct}% vs mes anterior`);
      if ((clientesNuevos?.length || 0) > 5) fortalezas.push(`${clientesNuevos.length} clientes nuevos este mes`);
      if ((stockBajo?.length || 0) === 0) fortalezas.push('Stock de productos en buen nivel');
      if (crecimientoPct !== null && crecimientoPct < -10) problemas.push(`Ingresos bajaron ${Math.abs(crecimientoPct)}% vs mes anterior`);
      if (clientesEnRiesgo > 3) problemas.push(`${clientesEnRiesgo} clientes no han vuelto en más de 30 días`);
      if ((stockBajo?.length || 0) > 0) problemas.push(`${stockBajo.length} producto(s) con stock bajo: ${stockBajo.map(p => p.name).join(', ')}`);
      if (empleadosSinActividad.length > 0) problemas.push(`Empleados sin citas este mes: ${empleadosSinActividad.join(', ')}`);
      if (clientesEnRiesgo > 0) recomendaciones.push(`Envía recordatorios a los ${clientesEnRiesgo} clientes en riesgo`);
      if ((stockBajo?.length || 0) > 0) recomendaciones.push('Repone el stock de productos antes de quedarte sin inventario');
      if (crecimientoPct !== null && crecimientoPct < 0) recomendaciones.push('Considera promociones para reactivar clientes');
      if (metaValor && totalMes < metaValor * 0.5 && diaActual > 15) recomendaciones.push('Llevas menos del 50% de la meta en la segunda mitad del mes — intensifica la agenda');

      return {
        periodo: `${inicioMes} al ${hoy}`,
        financiero: {
          ingresos_mes: Math.round(totalMes),
          ingresos_mes_anterior: Math.round(totalMesAnt),
          crecimiento_pct: crecimientoPct,
          proyeccion_mes: proyeccion,
          meta: metaValor,
          va_a_llegar_meta: metaValor ? proyeccion >= metaValor : null
        },
        operacional: {
          citas_completadas_mes: citasMes?.length || 0,
          citas_mes_anterior: citasMesAnt?.length || 0,
          clientes_nuevos_mes: clientesNuevos?.length || 0,
          clientes_en_riesgo: clientesEnRiesgo,
          empleados_sin_actividad: empleadosSinActividad
        },
        fortalezas,
        problemas,
        recomendaciones,
        score_negocio: Math.max(0, Math.min(100, 60 + (fortalezas.length * 10) - (problemas.length * 10)))
      };
    }

    case 'enviar_recordatorio_riesgo': {
      if (!toolInput.confirmar) {
        const { data: clientes } = await supabaseAdmin
          .from('clients')
          .select('id, name, phone')
          .in('id', toolInput.client_ids.slice(0,10));

        const conTelefono = (clientes || []).filter(c => c.phone);
        const sinTelefono = (clientes || []).filter(c => !c.phone);

        const { data: biz } = await supabaseAdmin
          .from('businesses')
          .select('recall_message, recall_image_url, name')
          .eq('id', businessId)
          .single();

        const mensajeEjemplo = conTelefono[0]
          ? (biz?.recall_message || 'Hola {nombre} 👋 Te esperamos en {negocio}!')
              .replace('{nombre}', conTelefono[0].name)
              .replace('{negocio}', biz?.name || 'el negocio')
          : null;

        return {
          preview: true,
          clientes_con_telefono: conTelefono.length,
          clientes_sin_telefono: sinTelefono.length,
          sin_telefono_nombres: sinTelefono.map(c => c.name),
          tiene_imagen: !!biz?.recall_image_url,
          mensaje_ejemplo: mensajeEjemplo,
          mensaje: `Se enviarán ${conTelefono.length} mensajes. ¿Confirmas el envío?`
        };
      }

      const { data: biz } = await supabaseAdmin
        .from('businesses')
        .select('plan, recall_message, recall_image_url, name, whatsapp_access_token, whatsapp_phone_number_id')
        .eq('id', businessId)
        .single();

      const plan = biz?.plan || 'estandar';
      const LIMITE_DIARIO = plan === 'pro' ? Infinity : 10;

      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const { count: enviados } = await supabaseAdmin
        .from('recall_logs')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('date', hoy);

      const disponibles = Math.max(0, LIMITE_DIARIO - (enviados || 0));
      if (disponibles === 0) {
        return {
          success: false,
          error: plan === 'estandar'
            ? 'Alcanzaste el límite de 10 recordatorios diarios. Mejora a Plan Pro para envíos ilimitados.'
            : 'Límite diario alcanzado.'
        };
      }

      const idsAEnviar = toolInput.client_ids.slice(0, Math.min(disponibles, 10));

      const { data: clientes } = await supabaseAdmin
        .from('clients')
        .select('id, name, phone')
        .in('id', idsAEnviar)
        .not('phone', 'is', null);

      const { sendMessage } = require('../config/whatsapp');
      const { decrypt } = require('../utils/encrypt');
      const businessToken = biz?.whatsapp_access_token ? decrypt(biz.whatsapp_access_token) : null;
      const phoneNumberId = biz?.whatsapp_phone_number_id;

      const resultados = [];
      for (const cliente of (clientes || [])) {
        try {
          const mensaje = (biz?.recall_message || 'Hola {nombre} 👋 Te esperamos en {negocio}!')
            .replace('{nombre}', cliente.name)
            .replace('{negocio}', biz?.name || 'el negocio');

          await sendMessage(cliente.phone, mensaje, businessToken, phoneNumberId);

          await supabaseAdmin.from('recall_logs').insert({
            business_id: businessId,
            client_id: cliente.id,
            date: hoy,
            sent_at: new Date().toISOString()
          });

          resultados.push({ nombre: cliente.name, success: true });
        } catch(e) {
          resultados.push({ nombre: cliente.name, success: false, error: e.message });
        }
      }

      const exitosos = resultados.filter(r => r.success).length;
      return {
        success: exitosos > 0,
        enviados: exitosos,
        fallidos: resultados.filter(r => !r.success).length,
        resultados,
        disponibles_hoy: disponibles - exitosos
      };
    }

    case 'ver_config_fidelizacion': {
      const { data: config } = await supabaseAdmin
        .from('loyalty_config')
        .select('visits_for_reward, points_per_appointment, points_per_product, rewards_description, reward_service_id')
        .eq('business_id', businessId)
        .maybeSingle();

      if (!config) return { configured: false, message: 'No hay programa de fidelización configurado. Configúralo en el panel en Configuración → Fidelización.' };

      let rewardService = null;
      if (config.reward_service_id) {
        const { data: svc } = await supabaseAdmin.from('services').select('name, price').eq('id', config.reward_service_id).single();
        rewardService = svc;
      }

      return {
        configured: true,
        visitas_para_recompensa: config.visits_for_reward,
        puntos_por_cita: config.points_per_appointment,
        puntos_por_producto: config.points_per_product,
        descripcion_recompensa: config.rewards_description,
        servicio_recompensa: rewardService
      };
    }

    case 'ver_fidelizacion_cliente': {
      const [{ data: loyalty }, { data: config }, { data: clientFid }] = await Promise.all([
        supabaseAdmin.from('client_loyalty').select('points, total_visits, loyalty_visits, last_visit, last_redeemed_at').eq('client_id', toolInput.client_id).eq('business_id', businessId).maybeSingle(),
        supabaseAdmin.from('loyalty_config').select('visits_for_reward, rewards_description').eq('business_id', businessId).maybeSingle(),
        supabaseAdmin.from('clients').select('name').eq('id', toolInput.client_id).single()
      ]);

      const visitasActuales = loyalty?.loyalty_visits || 0;
      const visitasMeta = config?.visits_for_reward || 0;
      const puedeCanjear = visitasMeta > 0 && visitasActuales >= visitasMeta;
      const faltanVisitas = visitasMeta > 0 ? Math.max(0, visitasMeta - visitasActuales) : null;

      return {
        cliente: clientFid?.name,
        visitas_para_recompensa: visitasActuales,
        total_visitas_historicas: loyalty?.total_visits || 0,
        meta_visitas: visitasMeta,
        faltan_visitas: faltanVisitas,
        puede_canjear: puedeCanjear,
        ultima_visita: loyalty?.last_visit || null,
        ultimo_canje: loyalty?.last_redeemed_at || null,
        recompensa: config?.rewards_description || null,
        mensaje: puedeCanjear
          ? `🎉 ${clientFid?.name} puede canjear su recompensa ahora. Tiene ${visitasActuales} visitas acumuladas.`
          : `Le faltan ${faltanVisitas} visita(s) para la recompensa (lleva ${visitasActuales}/${visitasMeta})`
      };
    }

    case 'clientes_cerca_recompensa': {
      const margen = toolInput.margen || 2;

      const { data: config } = await supabaseAdmin.from('loyalty_config').select('visits_for_reward, rewards_description').eq('business_id', businessId).maybeSingle();

      if (!config?.visits_for_reward) return { error: 'No hay programa de fidelización configurado.' };

      const meta = config.visits_for_reward;

      let loyaltyQuery = supabaseAdmin
        .from('client_loyalty')
        .select('client_id, loyalty_visits')
        .eq('business_id', businessId);

      if (toolInput.solo_listos) {
        loyaltyQuery = loyaltyQuery.gte('loyalty_visits', meta);
      } else {
        const minVisitas = Math.max(0, meta - margen);
        loyaltyQuery = loyaltyQuery.gte('loyalty_visits', minVisitas).lt('loyalty_visits', meta);
      }

      const { data: loyalty } = await loyaltyQuery;

      if (!loyalty || loyalty.length === 0) {
        const msgVacio = toolInput.solo_listos ? 'No hay clientes listos para canjear recompensa.' : 'No hay clientes cerca de la recompensa actualmente.';
        return { clientes: [], total: 0, mensaje: msgVacio };
      }

      const ids = loyalty.map(l => l.client_id);
      const { data: clients } = await supabaseAdmin.from('clients').select('id, name, phone').in('id', ids);

      const resultado = loyalty.map(l => {
        const c = clients?.find(cl => cl.id === l.client_id);
        return {
          nombre: c?.name || 'Desconocido',
          phone: c?.phone,
          visitas_actuales: l.loyalty_visits,
          faltan: toolInput.solo_listos ? 0 : meta - l.loyalty_visits,
          puede_canjear: toolInput.solo_listos || l.loyalty_visits >= meta,
          meta
        };
      }).sort((a, b) => a.faltan - b.faltan);

      const msgFinal = toolInput.solo_listos
        ? `${resultado.length} cliente(s) listo(s) para canjear recompensa`
        : `${resultado.length} cliente(s) a ${margen} visita(s) o menos de su recompensa`;

      return { clientes: resultado, total: resultado.length, recompensa: config.rewards_description, mensaje: msgFinal };
    }

    case 'canjear_recompensa': {
      const [{ data: loyalty }, { data: config }, { data: clientCanje }] = await Promise.all([
        supabaseAdmin.from('client_loyalty').select('id, loyalty_visits').eq('client_id', toolInput.client_id).eq('business_id', businessId).maybeSingle(),
        supabaseAdmin.from('loyalty_config').select('visits_for_reward, rewards_description').eq('business_id', businessId).maybeSingle(),
        supabaseAdmin.from('clients').select('name').eq('id', toolInput.client_id).single()
      ]);

      if (!config?.visits_for_reward) return { success: false, error: 'No hay programa de fidelización configurado.' };
      if (!loyalty) return { success: false, error: 'Este cliente no tiene visitas registradas en el programa de fidelización.' };
      if (loyalty.loyalty_visits < config.visits_for_reward) {
        return { success: false, error: `El cliente solo tiene ${loyalty.loyalty_visits} visitas y necesita ${config.visits_for_reward} para canjear.` };
      }

      const { error: updateError } = await supabaseAdmin
        .from('client_loyalty')
        .update({ loyalty_visits: 0, last_redeemed_at: new Date().toISOString() })
        .eq('id', loyalty.id);

      if (updateError) return { success: false, error: updateError.message };

      await supabaseAdmin.from('loyalty_transactions').insert({
        business_id: businessId,
        client_id: toolInput.client_id,
        type: 'redeem',
        visits_redeemed: config.visits_for_reward,
        reward_description: config.rewards_description || 'Recompensa canjeada',
        notes: toolInput.notas || null,
        created_at: new Date().toISOString()
      }).catch(() => {});

      return {
        success: true,
        cliente: clientCanje?.name,
        visitas_canjeadas: config.visits_for_reward,
        recompensa: config.rewards_description,
        mensaje: `✅ Recompensa canjeada para ${clientCanje?.name}. Sus visitas vuelven a 0.`
      };
    }

    case 'vender_producto': {
      const normalizedSearch = normalize(toolInput.product_name);
      const { data: allProducts } = await supabaseAdmin
        .from('products')
        .select('id, name, price, stock, cost_price')
        .eq('business_id', businessId)
        .eq('is_active', true);

      if (!allProducts || allProducts.length === 0) {
        return { success: false, error: 'No encontré ese producto' };
      }

      const matches = allProducts.filter(p =>
        normalize(p.name).includes(normalizedSearch) || normalizedSearch.split(' ').some(w => normalize(p.name).includes(w))
      ).sort((a, b) => b.name.length - a.name.length);

      if (!matches.length) {
        return { success: false, error: `Producto "${toolInput.product_name}" no encontrado` };
      }

      const product = matches[0];

      if (product.stock < toolInput.quantity) {
        return { success: false, error: `Stock insuficiente. Disponible: ${product.stock}` };
      }

      await supabaseAdmin
        .from('products')
        .update({ stock: product.stock - toolInput.quantity })
        .eq('id', product.id);

      const saleDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

      const { data: saleData } = await supabaseAdmin
        .from('product_sales')
        .insert({
          business_id: businessId,
          product_id: product.id,
          quantity: toolInput.quantity,
          total_amount: product.price * toolInput.quantity,
          client_id: toolInput.client_id || null,
          appointment_id: toolInput.appointment_id || null,
          sold_via: 'presencial'
        })
        .select()
        .single();

      const { data: incomeData } = await supabaseAdmin
        .from('income')
        .insert({
          business_id: businessId,
          amount: product.price * toolInput.quantity,
          category: 'productos',
          description: `Venta: ${product.name}${toolInput.quantity > 1 ? ` ×${toolInput.quantity}` : ''}`,
          date: saleDate,
          client_id: toolInput.client_id || null,
          source: 'product_sale'
        })
        .select()
        .single();

      if (product.cost_price != null) {
        const costoTotal = Number(product.cost_price) * toolInput.quantity;
        await supabaseAdmin
          .from('expenses')
          .insert({
            business_id: businessId,
            amount: costoTotal,
            category: 'costo_producto',
            description: `Costo de venta: ${product.name} (${toolInput.quantity} unidades)`,
            date: saleDate
          });
      }

      return { success: true, product_name: product.name, quantity: toolInput.quantity, total_amount: product.price * toolInput.quantity };
    }

    case 'crear_producto': {
      const { data, error } = await supabaseAdmin
        .from('products')
        .insert({
          business_id: businessId,
          name: toolInput.name,
          price: toolInput.price,
          cost_price: toolInput.cost || null,
          stock: toolInput.stock || 0,
          category: toolInput.category || null,
          is_active: true
        })
        .select()
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, product: data };
    }

    case 'actualizar_producto': {
      const updateData = {};
      if (toolInput.name !== undefined) updateData.name = toolInput.name;
      if (toolInput.price !== undefined) updateData.price = toolInput.price;
      if (toolInput.cost !== undefined) updateData.cost_price = toolInput.cost;
      if (toolInput.stock !== undefined) updateData.stock = toolInput.stock;
      if (toolInput.category !== undefined) updateData.category = toolInput.category;

      const { data, error } = await supabaseAdmin
        .from('products')
        .update(updateData)
        .eq('id', toolInput.product_id)
        .eq('business_id', businessId)
        .select('id');

      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) {
        return { success: false, error: 'Registro no encontrado' };
      }

      return { success: true };
    }

    case 'ver_citas_pendientes': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const fecha = toolInput.fecha || hoy;

      const { data } = await supabaseAdmin
        .from('appointments')
        .select('id, scheduled_at, clients(name, phone), services(name, price), employees(name)')
        .eq('business_id', businessId)
        .eq('status', 'pending')
        .gte('scheduled_at', `${fecha}T00:00:00-05:00`)
        .lte('scheduled_at', `${fecha}T23:59:59-05:00`)
        .order('scheduled_at');

      if (!data || data.length === 0) return { total: 0, citas: [], mensaje: '✅ No hay citas pendientes de confirmar.' };

      const citas = data.map(a => ({
        id: a.id,
        hora: new Date(a.scheduled_at).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: true }),
        cliente: a.clients?.name || 'Sin nombre',
        telefono: a.clients?.phone,
        servicio: a.services?.name,
        precio: a.services?.price || 0,
        empleado: a.employees?.name || 'Sin asignar'
      }));

      return { total: citas.length, citas, mensaje: `${citas.length} cita(s) pendientes de confirmar` };
    }

    case 'confirmar_todas_pendientes': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const fecha = toolInput.fecha || hoy;

      const { data, error } = await supabaseAdmin
        .from('appointments')
        .update({ status: 'confirmed' })
        .eq('business_id', businessId)
        .eq('status', 'pending')
        .gte('scheduled_at', `${fecha}T00:00:00-05:00`)
        .lte('scheduled_at', `${fecha}T23:59:59-05:00`)
        .select('id');

      if (error) return { success: false, error: error.message };
      return { success: true, confirmadas: data?.length || 0, mensaje: `✅ ${data?.length || 0} cita(s) confirmadas` };
    }

    case 'resumen_caja_hoy': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const fecha = toolInput.fecha || hoy;

      const [{ data: ingresos }, { data: egresos }, { data: citas }, { data: ventas }] = await Promise.all([
        supabaseAdmin.from('income').select('amount, category, source, description').eq('business_id', businessId).eq('date', fecha),
        supabaseAdmin.from('expenses').select('amount, category, description').eq('business_id', businessId).eq('date', fecha).neq('category', 'costo_producto'),
        supabaseAdmin.from('appointments').select('price, status').eq('business_id', businessId).gte('scheduled_at', `${fecha}T00:00:00-05:00`).lte('scheduled_at', `${fecha}T23:59:59-05:00`).eq('status', 'completed'),
        supabaseAdmin.from('product_sales').select('total_amount').eq('business_id', businessId).gte('created_at', `${fecha}T00:00:00-05:00`).lte('created_at', `${fecha}T23:59:59-05:00`)
      ]);

      const totalIngresos = (ingresos || []).reduce((s, i) => s + Number(i.amount), 0);
      const totalEgresos = (egresos || []).reduce((s, e) => s + Number(e.amount), 0);
      const neto = totalIngresos - totalEgresos;

      const porCategoriaIngreso = {};
      (ingresos || []).forEach(i => {
        const cat = i.category || 'otro';
        porCategoriaIngreso[cat] = (porCategoriaIngreso[cat] || 0) + Number(i.amount);
      });

      const porCategoriaEgreso = {};
      (egresos || []).forEach(e => {
        porCategoriaEgreso[e.category || 'otro'] = (porCategoriaEgreso[e.category || 'otro'] || 0) + Number(e.amount);
      });

      return {
        fecha,
        ingresos: { total: Math.round(totalIngresos), por_categoria: porCategoriaIngreso, citas_completadas: citas?.length || 0, ventas_productos: ventas?.length || 0 },
        egresos: { total: Math.round(totalEgresos), por_categoria: porCategoriaEgreso },
        neto_del_dia: Math.round(neto),
        resultado: neto >= 0 ? 'positivo' : 'negativo',
        emoji: neto >= 0 ? '✅' : '⚠️'
      };
    }

    case 'historial_cliente': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const periodos = {
        month: hoy.slice(0,7) + '-01',
        quarter: new Date(Date.now() - 90*86400000).toLocaleDateString('en-CA', bogota),
        year: hoy.slice(0,4) + '-01-01',
        all: '2020-01-01'
      };
      const desde = periodos[toolInput.period || 'all'];
      const limite = toolInput.limit || 20;

      const [{ data: clientHist }, { data: citas }] = await Promise.all([
        supabaseAdmin.from('clients').select('name, phone, notes, total_spent, visits_count').eq('id', toolInput.client_id).single(),
        supabaseAdmin.from('appointments').select('id, scheduled_at, status, price, notes, services(name), employees(name)').eq('client_id', toolInput.client_id).eq('business_id', businessId).gte('scheduled_at', `${desde}T00:00:00-05:00`).order('scheduled_at', { ascending: false }).limit(limite)
      ]);

      const completadas = (citas || []).filter(c => c.status === 'completed');
      const totalGastadoPeriodo = completadas.reduce((s, c) => s + Number(c.price || 0), 0);

      return {
        cliente: { nombre: clientHist?.name, telefono: clientHist?.phone, notas: clientHist?.notes, total_gastado_historico: clientHist?.total_spent || 0, visitas_totales: clientHist?.visits_count || 0 },
        citas: (citas || []).map(c => ({
          fecha: new Date(c.scheduled_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
          hora: new Date(c.scheduled_at).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: true }),
          servicio: c.services?.name || 'Sin servicio',
          empleado: c.employees?.name || 'Sin asignar',
          precio: c.price || 0,
          status: c.status,
          notas: c.notes
        })),
        resumen_periodo: { total_citas: citas?.length || 0, completadas: completadas.length, gastado_en_periodo: Math.round(totalGastadoPeriodo) }
      };
    }

    case 'agregar_nota_cliente': {
      let notaFinal = toolInput.nota;

      if (toolInput.agregar) {
        const { data: clientNota } = await supabaseAdmin.from('clients').select('notes').eq('id', toolInput.client_id).single();
        if (clientNota?.notes) notaFinal = clientNota.notes + '\n' + toolInput.nota;
      }

      const { error } = await supabaseAdmin
        .from('clients')
        .update({ notes: notaFinal })
        .eq('id', toolInput.client_id)
        .eq('business_id', businessId);

      return { success: !error, error: error?.message };
    }

    case 'ajustar_stock': {
      const { data: prodStock } = await supabaseAdmin
        .from('products')
        .select('name, stock')
        .eq('id', toolInput.product_id)
        .eq('business_id', businessId)
        .single();

      if (!prodStock) return { success: false, error: 'Producto no encontrado' };

      const nuevoStock = Math.max(0, prodStock.stock + toolInput.cantidad);

      const { error } = await supabaseAdmin
        .from('products')
        .update({ stock: nuevoStock })
        .eq('id', toolInput.product_id)
        .eq('business_id', businessId);

      if (error) return { success: false, error: error.message };

      return {
        success: true,
        producto: prodStock.name,
        stock_anterior: prodStock.stock,
        ajuste: toolInput.cantidad > 0 ? `+${toolInput.cantidad}` : `${toolInput.cantidad}`,
        stock_nuevo: nuevoStock,
        motivo: toolInput.motivo || 'ajuste manual'
      };
    }

    case 'ver_disponibilidad': {
      const [horaStr, minStr] = toolInput.hora.split(':');
      const hora = parseInt(horaStr);
      const min = parseInt(minStr);
      const dayOfWeek = new Date(toolInput.fecha + 'T12:00:00-05:00').getDay();

      const [{ data: horario }, { data: citasSlot }, { data: cerrado }, { data: empleados }] = await Promise.all([
        supabaseAdmin.from('business_hours').select('open_time, close_time, is_open').eq('business_id', businessId).eq('day_of_week', dayOfWeek).single(),
        supabaseAdmin.from('appointments').select('id, employee_id, employees(name)').eq('business_id', businessId).gte('scheduled_at', `${toolInput.fecha}T${toolInput.hora}:00-05:00`).lt('scheduled_at', `${toolInput.fecha}T${String(hora + 1).padStart(2,'0')}:${String(min).padStart(2,'0')}:00-05:00`).not('status', 'in', '("cancelled")'),
        supabaseAdmin.from('business_closed_days').select('reason').eq('business_id', businessId).eq('date', toolInput.fecha).maybeSingle(),
        supabaseAdmin.from('employees').select('id, name').eq('business_id', businessId).eq('is_active', true)
      ]);

      if (cerrado) return { disponible: false, razon: `Día cerrado: ${cerrado.reason}` };
      if (!horario || !horario.is_open) return { disponible: false, razon: 'El negocio está cerrado ese día' };

      const [openH, openM] = horario.open_time.split(':').map(Number);
      const [closeH, closeM] = horario.close_time.split(':').map(Number);
      const horaMinutos = hora * 60 + min;

      if (horaMinutos < openH * 60 + openM || horaMinutos >= closeH * 60 + closeM) {
        return { disponible: false, razon: `Fuera de horario. El negocio atiende de ${horario.open_time} a ${horario.close_time}` };
      }

      const empleadosOcupados = new Set((citasSlot || []).map(c => c.employee_id).filter(Boolean));
      const empleadosLibres = (empleados || []).filter(e => !empleadosOcupados.has(e.id));

      return {
        disponible: empleadosLibres.length > 0,
        fecha: toolInput.fecha,
        hora: toolInput.hora,
        empleados_libres: empleadosLibres.map(e => e.name),
        empleados_ocupados: (citasSlot || []).map(c => c.employees?.name).filter(Boolean),
        razon: empleadosLibres.length === 0 ? 'Todos los empleados están ocupados en ese horario' : null
      };
    }

    case 'ver_agenda_empleado': {
      const bogota = { timeZone: 'America/Bogota' };
      const hoy = new Date().toLocaleDateString('en-CA', bogota);
      const fecha = toolInput.fecha || hoy;

      const [{ data: empAgenda }, { data: citasEmp }] = await Promise.all([
        supabaseAdmin.from('employees').select('name').eq('id', toolInput.employee_id).single(),
        supabaseAdmin.from('appointments').select('id, scheduled_at, status, price, clients(name), services(name, duration_minutes)').eq('business_id', businessId).eq('employee_id', toolInput.employee_id).gte('scheduled_at', `${fecha}T00:00:00-05:00`).lte('scheduled_at', `${fecha}T23:59:59-05:00`).not('status', 'in', '("cancelled")').order('scheduled_at')
      ]);

      const totalIngresos = (citasEmp || []).filter(c => c.status === 'completed').reduce((s, c) => s + Number(c.price || 0), 0);

      return {
        empleado: empAgenda?.name,
        fecha,
        citas: (citasEmp || []).map(c => ({
          hora: new Date(c.scheduled_at).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: true }),
          cliente: c.clients?.name || 'Walk-in',
          servicio: c.services?.name,
          duracion_min: c.services?.duration_minutes,
          precio: c.price || 0,
          status: c.status
        })),
        total_citas: citasEmp?.length || 0,
        ingresos_generados: totalIngresos
      };
    }

    case 'eliminar_empleado': {
      const { count: citasEmpCount } = await supabaseAdmin
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('employee_id', toolInput.employee_id)
        .eq('business_id', businessId);

      if (citasEmpCount > 0) {
        return { success: false, error: `Este empleado tiene ${citasEmpCount} cita(s) en el historial. Para preservar el historial usa "desactivar empleado" en su lugar.` };
      }

      const { error } = await supabaseAdmin
        .from('employees')
        .delete()
        .eq('id', toolInput.employee_id)
        .eq('business_id', businessId);

      return { success: !error, error: error?.message };
    }

    case 'test_sistema': {
      const { data: bizData } = await supabaseAdmin
        .from('businesses')
        .select('owner_email')
        .eq('id', businessId)
        .single();

      if (bizData?.owner_email !== process.env.SUPERADMIN_EMAIL) {
        return { error: 'No tienes permisos para ejecutar pruebas del sistema.' };
      }

      const resultados = {};
      const modulo = toolInput.modulo;

      if (modulo === 'todos' || modulo === 'supabase') {
        try {
          const inicio = Date.now();
          const { data, error } = await supabaseAdmin
            .from('businesses')
            .select('id')
            .limit(1);
          resultados.supabase = {
            ok: !error,
            latencia_ms: Date.now() - inicio,
            error: error?.message || null
          };
        } catch(e) {
          resultados.supabase = { ok: false, error: e.message };
        }
      }

      if (modulo === 'todos' || modulo === 'anthropic') {
        try {
          const inicio = Date.now();
          const testClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          await testClient.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'di ok' }]
          });
          resultados.anthropic = {
            ok: true,
            latencia_ms: Date.now() - inicio,
            modelo: 'claude-sonnet-4-6'
          };
        } catch(e) {
          resultados.anthropic = { ok: false, error: e.message };
        }
      }

      if (modulo === 'todos' || modulo === 'whatsapp') {
        try {
          const axios = require('axios');
          const inicio = Date.now();
          const response = await axios.get(
            `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}`,
            { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }, timeout: 5000 }
          );
          resultados.whatsapp = {
            ok: response.status === 200,
            latencia_ms: Date.now() - inicio,
            numero: response.data?.display_phone_number || 'N/A'
          };
        } catch(e) {
          resultados.whatsapp = { ok: false, error: e.response?.data?.error?.message || e.message };
        }
      }

      if (modulo === 'todos' || modulo === 'pagos') {
        try {
          const axios = require('axios');
          const inicio = Date.now();
          const wompiUrl = process.env.WOMPI_API_URL || 'https://sandbox.wompi.co/v1';
          const response = await axios.get(
            `${wompiUrl}/merchants/${process.env.WOMPI_PUBLIC_KEY_CO}`,
            { timeout: 5000 }
          );
          resultados.wompi = {
            ok: response.status === 200,
            latencia_ms: Date.now() - inicio,
            ambiente: wompiUrl.includes('sandbox') ? 'sandbox' : 'producción'
          };
        } catch(e) {
          resultados.wompi = { ok: false, error: e.response?.data?.error || e.message };
        }
      }

      if (modulo === 'todos') {
        const varsRequeridas = [
          'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
          'ANTHROPIC_API_KEY', 'WHATSAPP_ACCESS_TOKEN',
          'WHATSAPP_PHONE_NUMBER_ID', 'WOMPI_PUBLIC_KEY_CO',
          'WOMPI_INTEGRITY_SECRET_CO', 'ENCRYPT_SECRET',
          'RESEND_API_KEY', 'FRONTEND_URL'
        ];
        const faltantes = varsRequeridas.filter(v => !process.env[v]);
        resultados.variables_entorno = {
          ok: faltantes.length === 0,
          total: varsRequeridas.length,
          configuradas: varsRequeridas.length - faltantes.length,
          faltantes
        };
      }

      const totalOk = Object.values(resultados).filter(r => r.ok).length;
      const totalTests = Object.keys(resultados).length;

      return {
        timestamp: new Date().toISOString(),
        resumen: `${totalOk}/${totalTests} pruebas exitosas`,
        score: Math.round((totalOk / totalTests) * 100),
        resultados,
        estado_general: totalOk === totalTests ? '🟢 Todo funciona' : totalOk >= totalTests * 0.7 ? '🟡 Funcionando con advertencias' : '🔴 Problemas críticos detectados'
      };
    }

    case 'cerrar_dia_especial': {
      const { date, reason } = toolInput;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { success: false, error: 'Fecha inválida. Usa formato YYYY-MM-DD.' };
      }
      if (!reason || reason.trim().length === 0) {
        return { success: false, error: 'Motivo del cierre es requerido.' };
      }
      const { error } = await supabaseAdmin
        .from('business_closed_days')
        .insert({
          business_id: businessId,
          date: date,
          reason: reason.trim(),
          is_full_day: true
        });
      if (error) return { success: false, error: error.message };
      return { success: true, message: `Día ${date} registrado como cerrado por: ${reason}` };
    }

    default:
      return { error: 'Tool no reconocida' };
    }
  } catch (error) {
    logger.error('executeTool error completo:', error);
    logger.error('executeTool stack:', error.stack);
    logger.error('toolName:', toolName);
    logger.error('toolInput:', JSON.stringify(toolInput));
    throw error;
  }
}

async function processMessage(businessId, userMessage, conversationHistory = []) {
  logger.info('[processMessage] businessId recibido:', businessId);
  logger.info('[processMessage] userMessage:', userMessage?.substring(0, 50));
  logger.info('[processMessage] historyLength:', conversationHistory.length);

  // Verificar límite de mensajes IA
  const { data: biz } = await supabaseAdmin
    .from('businesses')
    .select('plan, ai_messages_today, ai_messages_date, trial_ends_at, plan_expires_at, name, business_type, address, phone')
    .eq('id', businessId)
    .single();

  const plan = biz.plan || 'estandar';
  const planConfig = PLANS[plan];
  const limite = planConfig.ai_messages_day;
  let avisoLimite = '';

  if (limite !== -1) {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const esHoy = biz.ai_messages_date === hoy;
    const mensajesHoy = esHoy ? (biz.ai_messages_today || 0) : 0;

    if (mensajesHoy >= limite) {
      const planActual = plan;
      const mensajeUpgrade = planActual === 'estandar'
        ? '🚀 ¿Quieres mensajes ilimitados? Mejora al **Plan Pro** desde Mi Suscripción en el panel.'
        : planActual === 'lite'
        ? '🚀 ¿Quieres usar el asistente? Mejora al **Plan Estándar** desde Mi Suscripción en el panel.'
        : '';
      return {
        success: false,
        error: `Has alcanzado el límite de ${limite} mensajes diarios de tu plan ${planActual}. ${mensajeUpgrade} Puedes seguir gestionando tu negocio desde el panel en Citas, Clientes, Servicios y Caja.`,
        code: 'AI_LIMIT_REACHED'
      };
    }

    // Sumar 1 al contador
    await supabaseAdmin
      .from('businesses')
      .update({
        ai_messages_today: mensajesHoy + 1,
        ai_messages_date: hoy
      })
      .eq('id', businessId);

    const mensajesRestantes = limite - (mensajesHoy + 1);
    avisoLimite = (mensajesRestantes <= 5 && mensajesRestantes > 0)
      ? `\n\n_(${mensajesRestantes} mensaje${mensajesRestantes !== 1 ? 's' : ''} disponible${mensajesRestantes !== 1 ? 's' : ''} hoy en tu plan)_`
      : '';
  }

  const today = new Date();
  const fechaHoy = today.toLocaleDateString('es-CO', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Bogota'
  });
  const horaActual = today.toLocaleTimeString('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit'
  });
  const fechaISO = today.toLocaleDateString('en-CA', {
    timeZone: 'America/Bogota'
  });
  const mananaISO = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', {
    timeZone: 'America/Bogota'
  });

  // Contexto operativo enriquecido — con cache de 5 minutos
  let businessContext = getCachedContext(businessId);

  if (!businessContext) {
    const bogotaNow = { timeZone: 'America/Bogota' };
    const hoyCtx = new Date().toLocaleDateString('en-CA', bogotaNow);
    const inicioMesCtx = hoyCtx.slice(0,7) + '-01';

    const [
      { data: horariosCtx },
      { data: citasHoyCtx },
      { data: ingresosHoyCtx },
      { data: ingresosMesCtx },
      { data: metaCtx },
      { count: totalClientesCtx },
      { data: alertasStockCtxRaw }
    ] = await Promise.all([
      supabaseAdmin.from('business_hours').select('day_of_week, open_time, close_time, is_open').eq('business_id', businessId).order('day_of_week'),
      supabaseAdmin.from('appointments').select('id, scheduled_at, status, clients(name), services(name)').eq('business_id', businessId).gte('scheduled_at', `${hoyCtx}T00:00:00-05:00`).lte('scheduled_at', `${hoyCtx}T23:59:59-05:00`).not('status', 'in', '("cancelled")').order('scheduled_at').limit(20),
      supabaseAdmin.from('income').select('amount').eq('business_id', businessId).eq('date', hoyCtx),
      supabaseAdmin.from('income').select('amount').eq('business_id', businessId).gte('date', inicioMesCtx).lte('date', hoyCtx),
      supabaseAdmin.from('monthly_goals').select('income_goal').eq('business_id', businessId).order('month', { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from('clients').select('*', { count: 'exact', head: true }).eq('business_id', businessId),
      supabaseAdmin.from('products').select('name, stock, min_stock').eq('business_id', businessId).eq('is_active', true)
    ]);

    const alertasStockCtx = (alertasStockCtxRaw || []).filter(p => p.stock <= p.min_stock).slice(0, 5);

    const diasSemanaCtx = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    const horariosTexto = (horariosCtx || [])
      .map(h => `${diasSemanaCtx[h.day_of_week]}:${h.is_open ? `${h.open_time}-${h.close_time}` : 'X'}`)
      .join(' | ');

    const ingresosDiaCtx = (ingresosHoyCtx || []).reduce((s, i) => s + Number(i.amount), 0);
    const ingresosMesTotal = (ingresosMesCtx || []).reduce((s, i) => s + Number(i.amount), 0);
    const metaValorCtx = metaCtx?.income_goal || null;
    const pctMetaCtx = metaValorCtx ? Math.round((ingresosMesTotal / metaValorCtx) * 100) : null;

    const citasHoyTexto = (citasHoyCtx || []).length > 0
      ? (citasHoyCtx || []).map(c => {
          const h = new Date(c.scheduled_at).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: true });
          return `${h} ${c.clients?.name || 'Walk-in'}/${c.services?.name || '?'}[${c.status}]`;
        }).join('; ')
      : 'ninguna';

    const stockAlerta = (alertasStockCtx || []).length > 0
      ? `⚠️Stock bajo:${(alertasStockCtx || []).map(p => `${p.name}(${p.stock})`).join(',')}`
      : '';

    businessContext = `<biz>
N:${biz.name}|T:${biz.business_type}|P:${biz.plan||'estandar'}|Clientes:${totalClientesCtx||0}
Dir:${biz.address||'?'}|Tel:${biz.phone||'?'}|País:${biz.country||'Colombia'}
Horarios:${horariosTexto||'no configurados'}
Hoy(${hoyCtx})-Citas:${citasHoyTexto}
Ingresos hoy:$${ingresosDiaCtx.toLocaleString('es-CO')} | Mes:$${ingresosMesTotal.toLocaleString('es-CO')}${metaValorCtx?` (${pctMetaCtx}% de meta $${metaValorCtx.toLocaleString('es-CO')})`:' (sin meta)'}
${stockAlerta}
</biz>`;

    setCachedContext(businessId, businessContext);
  }

  const dynamicSystemPrompt = SYSTEM_PROMPT + `

${businessContext}

<fecha_actual>
FECHA Y HORA ACTUAL: ${fechaHoy}, ${horaActual}
FECHA ISO HOY: ${fechaISO}
Cuando el usuario diga "hoy" usar exactamente: ${fechaISO}
Cuando diga "mañana" usar: ${mananaISO}
</fecha_actual>`;

  const limitedConversationHistory = conversationHistory.slice(-12);
  const messages = [
    ...limitedConversationHistory,
    { role: 'user', content: userMessage }
  ];

  let response = await callClaudeWithRetry({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: [
      {
        type: 'text',
        text: dynamicSystemPrompt,
        cache_control: { type: 'ephemeral' }
      }
    ],
    tools: tools,
    tool_choice: { type: 'auto' },
    messages: messages
  });

  let apiMessages = [...messages];
  let actionsExecuted = [];

  // Loop para manejar tool use
  while (response.stop_reason === 'tool_use') {
    const assistantContent = response.content;
    apiMessages.push({ role: 'assistant', content: assistantContent });

    const toolResults = [];
    for (const block of assistantContent) {
      if (block.type === 'tool_use') {
        let result;
        try {
          result = await executeTool(block.name, block.input, businessId);
        } catch (toolError) {
          logger.error(`Tool execution error [${block.name}]:`, toolError.message);
          result = { is_error: true, content: 'Error ejecutando la acción, intenta de nuevo' };
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result)
        });
        actionsExecuted.push(block.name);
      }
    }

    apiMessages.push({ role: 'user', content: toolResults });

    response = await callClaudeWithRetry({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: [
        {
          type: 'text',
          text: dynamicSystemPrompt,
          cache_control: { type: 'ephemeral' }
        }
      ],
      tools: tools,
      messages: apiMessages
    });

    // Si Claude no generó texto después de ejecutar tools, forzar respuesta
    if (response.stop_reason === 'end_turn') {
      const tieneTexto = response.content.some(b => b.type === 'text' && b.text?.trim());
      if (!tieneTexto) {
        const ultimasTools = actionsExecuted.slice(-3).join(', ');
        apiMessages.push({ role: 'assistant', content: response.content });
        apiMessages.push({
          role: 'user',
          content: 'Confirma brevemente al usuario lo que acabas de hacer en español colombiano informal.'
        });
        response = await callClaudeWithRetry({
          model: 'claude-sonnet-4-6',
          max_tokens: 200,
          system: [
            {
              type: 'text',
              text: dynamicSystemPrompt,
              cache_control: { type: 'ephemeral' }
            }
          ],
          tools: tools,
          messages: apiMessages
        });
      }
    }
  }

  const finalText = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  const frasesDeError = [
    'no tengo herramientas',
    'no puedo acceder',
    'no está disponible',
    'no tengo información',
    'no tengo una función',
    'el sistema no proporciona',
    'no tengo acceso',
    'no puedo ver',
    'no tengo esa capacidad'
  ];

  const responseText = finalText.toLowerCase();
  const noSePudo = frasesDeError.some(f => responseText.includes(f));

  if (noSePudo) {
    await notifyAssistantFail(
      businessId,
      userMessage,
      'El asistente respondió que no tiene capacidad para esta acción'
    );
  }

  const cleanHistory = [
    ...limitedConversationHistory,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: finalText }
  ];

  return {
    response: finalText + (avisoLimite || ''),
    history: cleanHistory.slice(-12),
    actionsExecuted
  };
}

module.exports = { processMessage };




