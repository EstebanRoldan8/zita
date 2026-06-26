// ZITA Assistant v2.1
const Anthropic = require('@anthropic-ai/sdk');
const { supabaseAdmin } = require('../config/supabase');
const { PLANS } = require('../config/plans');
const logger = require('../utils/logger');
const { getTimezone, getOffsetForTz } = require('../utils/timezone');
const { getAvailableEmployee } = require('../utils/availability');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
</identity>

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
- Si hay múltiples clientes → usar el PRIMERO automáticamente, menciona: “encontré a [nombre]”
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
- Cuando el usuario mencione un nombre, SIEMPRE usa buscar_cliente primero
- Si buscar_cliente encuentra el cliente → usar ese cliente directamente, NUNCA pedir teléfono ni datos adicionales
- Solo pedir datos si buscar_cliente retorna found: false
- Si hay múltiples clientes con ese nombre → SIEMPRE usa el PRIMERO sin preguntar

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
- "Cambia la comisión de X a Y%" → buscar_empleado → actualizar_empleado
- "Desactiva al empleado X" → buscar_empleado → actualizar_empleado con is_active: false
- "Crea el servicio X por $Y en Z minutos" → crear_servicio

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

RECORDATORIOS A CLIENTES EN RIESGO:
- SOLO puedes enviar recordatorios a clientes identificados como "en riesgo" (30-90 días sin visita)
- Primero usa clientes_riesgo para obtener la lista
- Luego usa enviar_recordatorio_riesgo con confirmar: false para mostrar preview
- Espera confirmación del dueño antes de enviar con confirmar: true
- Informa siempre cuántos mensajes quedan disponibles hoy
- Si el dueño quiere enviar a otros segmentos → "Para campañas masivas necesitas el Plan Pro"
- Si el dueño quiere agregar foto → "El mensaje se enviará con la foto configurada en Configuración → Recordatorio"
</gestion_avanzada>

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
    description: 'Lista todos los empleados activos del negocio.',
    input_schema: { type: 'object', properties: {} }
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
    name: 'crear_cita',
    description: 'Crea una cita. Client_id es opcional (para clientes walk-in). Requiere: service_id, scheduled_at.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Opcional - ID del cliente. Si no se proporciona, serÃ¡ una cita walk-in.' },
        service_id: { type: 'string' },
        scheduled_at: { type: 'string', description: 'Fecha y hora en formato ISO con timezone Colombia: YYYY-MM-DDTHH:mm:00-05:00. SIEMPRE incluir -05:00 al final. NUNCA usar Z o UTC.' },
        employee_id: { type: 'string', description: 'Opcional' },
        notes: { type: 'string', description: 'Notas opcionales' }
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
    description: 'Actualiza el cliente o empleado de una cita existente. Usar cuando el usuario dice que se equivocó de cliente.',
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string', description: 'ID de la cita a actualizar' },
        client_id: { type: 'string', description: 'Nuevo client_id (opcional)' },
        employee_id: { type: 'string', description: 'Nuevo employee_id (opcional)' },
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
        commission_percent: { type: 'number', description: 'Porcentaje de comisión opcional' }
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
        category: { type: 'string', description: 'Categoría: arriendo, nomina, servicios, insumos, otro' },
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
      const { data: allClients } = await supabaseAdmin
        .from('clients')
        .select('id, name, phone')
        .eq('business_id', businessId);

      if (!allClients || allClients.length === 0) {
        return { not_found: true, searched_for: toolInput.nombre, can_create: true };
      }

      const searchNormalized = normalizeForSearch(toolInput.nombre);
      const searchWords = searchNormalized.split(/\s+/);

      const conPuntaje = allClients.map(c => {
        const clientNormalized = normalizeForSearch(c.name);
        const clientWords = clientNormalized.split(/\s+/);
        let totalDistance = 0;
        let matches = 0;

        for (const searchWord of searchWords) {
          let bestDistance = Infinity;
          for (const clientWord of clientWords) {
            const dist = levenshtein(searchWord, clientWord);
            if (dist <= 2) matches++;
            bestDistance = Math.min(bestDistance, dist);
          }
          totalDistance += bestDistance === Infinity ? 10 : bestDistance;
        }

        return { ...c, puntaje: matches, distancia: totalDistance };
      }).filter(c => c.puntaje > 0 || c.distancia < 10)
        .sort((a, b) => b.puntaje - a.puntaje || a.distancia - b.distancia);

      if (!conPuntaje?.length) {
        return { not_found: true, searched_for: toolInput.nombre, can_create: true };
      }

      return { found: true, client: conPuntaje[0], multiple_found: conPuntaje.length > 1 ? conPuntaje.length : undefined };
    }

    case 'crear_cliente': {
      const { data, error } = await supabaseAdmin
        .from('clients')
        .insert({
          business_id: businessId,
          name: formatName(toolInput.name),
          phone: toolInput.phone || null
        })
        .select('id, name')
        .single();

      if (error) return { success: false, error: error.message };
      return { success: true, client: data };
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

      const matches = allProducts.filter(p =>
        normalize(p.name).includes(normalizedSearch) || normalizedSearch.split(' ').some(w => normalize(p.name).includes(w))
      );

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
      const { data } = await supabaseAdmin
        .from('employees')
        .select('id, name, phone, commission_percent')
        .eq('business_id', businessId);
      logger.info('Empleados encontrados:', data?.length);
      return { employees: data || [] };
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

    case 'crear_cita': {
      logger.info('=== CREAR CITA ===');
      logger.info('input:', JSON.stringify(toolInput));
      logger.info('businessId:', businessId);

      let scheduledAt = toolInput.scheduled_at;
      if (scheduledAt && !scheduledAt.includes('Z') && !scheduledAt.includes('+') && !scheduledAt.includes('-05:00')) {
        scheduledAt = scheduledAt.includes('T') ? scheduledAt + '-05:00' : scheduledAt;
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

      // Fetch service price for income creation
      const { data: service } = await supabaseAdmin
        .from('services')
        .select('price')
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

      const insertData = {
        business_id: businessId,
        client_id: toolInput.client_id || null,
        service_id: toolInput.service_id,
        employee_id: finalEmployeeId || null,
        scheduled_at: scheduledAt,
        status: 'confirmed',
        source: 'manual',
        notes: toolInput.notes || null,
        price: service?.price || 0
      };

      logger.info('insertData:', JSON.stringify(insertData));

      // Validar límite de citas del mes
      const { PLANS: PLANSast } = require('../config/plans');
      const { data: bizast } = await supabaseAdmin
        .from('businesses')
        .select('plan')
        .eq('id', businessId)
        .single();

      const planast = bizast.plan || 'estandar';
      const limiteast = PLANSast[planast].max_appointments_month;

      if (limiteast !== -1) {
        const _tzast = getTimezone();
        const _offzast = getOffsetForTz(_tzast);
        const mesActualast = new Date().toLocaleDateString('en-CA', { timeZone: _tzast }).slice(0, 7);
        const inicioMesast = `${mesActualast}-01T00:00:00${_offzast}`;
        const [yrast, moast] = mesActualast.split('-').map(Number);
        const ultimoDiaast = new Date(yrast, moast, 0).getDate();
        const finMesast = `${mesActualast}-${String(ultimoDiaast).padStart(2, '0')}T23:59:59${_offzast}`;

        const { count: countast } = await supabaseAdmin
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .gte('scheduled_at', inicioMesast)
          .lte('scheduled_at', finMesast)
          .neq('status', 'cancelled');

        if (countast >= limiteast) {
          return { success: false, error: 'Has alcanzado el límite de citas este mes de tu plan.' };
        }
      }

      const { data, error } = await supabaseAdmin
        .from('appointments')
        .insert(insertData)
        .select('id, scheduled_at')
        .single();

      logger.info('resultado:', JSON.stringify(data), 'error:', JSON.stringify(error));

      if (error) return { success: false, error: error.message };

      // Create income entry automatically
      if (data && service?.price > 0) {
        const { data: existingIncome } = await supabaseAdmin
          .from('income')
          .select('id')
          .eq('appointment_id', data.id)
          .maybeSingle();

        if (!existingIncome) {
          const incomeDate = scheduledAt.split('T')[0];
          const incomeData = {
            business_id: businessId,
            appointment_id: data.id,
            amount: service.price,
            date: incomeDate,
            description: `Cita manual registrada`,
            source: 'appointment'
          };
          const { error: incomeError } = await supabaseAdmin
            .from('income')
            .insert(incomeData);
          if (incomeError) {
            logger.error('Error creating income for appointment:', incomeError);
          }
        }
      }

      return { success: true, appointment: data };
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
        .eq('id', toolInput.product_id)
        .single();

      if (!product || product.stock < toolInput.quantity) {
        return { success: false, error: 'Stock insuficiente' };
      }

      await supabaseAdmin
        .from('products')
        .update({ stock: product.stock - toolInput.quantity })
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

      return { success: true, sale: data };
    }

    case 'cancelar_cita': {
      const { error } = await supabaseAdmin
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('id', toolInput.appointment_id)
        .eq('business_id', businessId);
      return { success: !error };
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
      const { error } = await supabaseAdmin
        .from('services')
        .update({ active: false })
        .eq('id', toolInput.service_id)
        .eq('business_id', businessId);
      return { success: !error };
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
      const { error } = await supabaseAdmin
        .from('products')
        .update({ is_active: true })
        .eq('id', toolInput.product_id)
        .eq('business_id', businessId);
      return { success: !error };
    }

    case 'desactivar_producto': {
      const { error } = await supabaseAdmin
        .from('products')
        .update({ is_active: false })
        .eq('id', toolInput.product_id)
        .eq('business_id', businessId);
      return { success: !error };
    }

    case 'activar_servicio': {
      const { error } = await supabaseAdmin
        .from('services')
        .update({ active: true })
        .eq('id', toolInput.service_id)
        .eq('business_id', businessId);
      return { success: !error };
    }

    case 'actualizar_servicio': {
      const updateData = {};
      if (toolInput.price) updateData.price = toolInput.price;
      if (toolInput.duration_minutes) updateData.duration_minutes = toolInput.duration_minutes;
      const { error } = await supabaseAdmin
        .from('services')
        .update(updateData)
        .eq('id', toolInput.service_id)
        .eq('business_id', businessId);
      return { success: !error };
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
        .select('scheduled_at, status, services(name, price)')
        .eq('client_id', toolInput.client_id)
        .eq('business_id', businessId)
        .eq('status', 'completed')
        .order('scheduled_at', { ascending: false })
        .limit(5);

      const totalGastado = appointments?.reduce((sum, a) =>
        sum + (a.services?.price || 0), 0) || 0;

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
      if (toolInput.notes !== undefined)
        updateData.notes = toolInput.notes;

      const { error } = await supabaseAdmin
        .from('appointments')
        .update(updateData)
        .eq('id', toolInput.appointment_id)
        .eq('business_id', businessId);

      return { success: !error, error: error?.message };
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
        const dia = diasSemana[fecha.toLocaleDateString('en-US', { timeZone: 'America/Bogota', weekday: 'short' }) === 'Sun' ? 0 : fecha.getDay()];
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
        { data: productosBajoStock },
        { data: citasUltimos7 },
        { data: empleados },
        { data: citasEmpleados },
        { data: ingresosActual },
        { data: ingresosAnterior },
        { data: citasRiesgo },
        { data: citasRecientes }
      ] = await Promise.all([
        supabaseAdmin.from('products').select('name, stock, min_stock').eq('business_id', businessId).eq('is_active', true).filter('stock', 'lte', 'min_stock'),
        supabaseAdmin.from('appointments').select('scheduled_at').eq('business_id', businessId).gte('scheduled_at', hace7 + 'T00:00:00-05:00').lte('scheduled_at', hoy + 'T23:59:59-05:00'),
        supabaseAdmin.from('employees').select('id, name').eq('business_id', businessId).eq('is_active', true),
        supabaseAdmin.from('appointments').select('employee_id').eq('business_id', businessId).eq('status','completed').gte('scheduled_at', hace7 + 'T00:00:00-05:00'),
        supabaseAdmin.from('income').select('amount').eq('business_id', businessId).gte('date', inicioMes),
        supabaseAdmin.from('income').select('amount').eq('business_id', businessId).gte('date', hoy.slice(0,4) + '-' + String(parseInt(hoy.split('-')[1]) === 1 ? 12 : parseInt(hoy.split('-')[1]) - 1).padStart(2,'0') + '-01').lt('date', inicioMes),
        supabaseAdmin.from('appointments').select('client_id').eq('business_id', businessId).eq('status','completed').gte('scheduled_at', hace90 + 'T00:00:00-05:00').lte('scheduled_at', hace30 + 'T23:59:59-05:00').not('client_id','is',null),
        supabaseAdmin.from('appointments').select('client_id').eq('business_id', businessId).eq('status','completed').gte('scheduled_at', hace30 + 'T00:00:00-05:00').not('client_id','is',null)
      ]);

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
      const { data, error } = await supabaseAdmin
        .from('employees')
        .insert({
          business_id: businessId,
          name: formatName(toolInput.name),
          phone: toolInput.phone || null,
          email: toolInput.email || null,
          commission_percent: toolInput.commission_percent || null,
          is_active: true
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
      const { error } = await supabaseAdmin
        .from('employees')
        .update(updateData)
        .eq('id', toolInput.employee_id)
        .eq('business_id', businessId);
      return { success: !error, error: error?.message };
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
        .gte('date', inicios[toolInput.period])
        .lte('date', hoy)
        .order('date', { ascending: false });

      const total = (data || []).reduce((s,e) => s + Number(e.amount), 0);
      const porCategoria = {};
      (data || []).forEach(e => {
        porCategoria[e.category] = (porCategoria[e.category] || 0) + Number(e.amount);
      });

      return { egresos: data || [], total, por_categoria: porCategoria, period: toolInput.period };
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
            category: 'productos',
            description: `Costo de venta: ${product.name} (${toolInput.quantity} unidades)`,
            date: saleDate
          });
      }

      return { success: true, product_name: product.name, quantity: toolInput.quantity, total_amount: product.price * toolInput.quantity };
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
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'di ok' }]
          });
          resultados.anthropic = {
            ok: true,
            latencia_ms: Date.now() - inicio,
            modelo: 'claude-haiku-4-5-20251001'
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

  if (limite !== -1) {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const esHoy = biz.ai_messages_date === hoy;
    const mensajesHoy = esHoy ? (biz.ai_messages_today || 0) : 0;

    if (mensajesHoy >= limite) {
      return {
        success: false,
        error: `Has alcanzado el límite de ${limite} mensajes diarios del plan Estándar. Para aumentar tu límite o gestionar tu negocio, visita la sección de Citas, Clientes o Servicios en el panel. También puedes actualizar a un plan superior desde Mi Suscripción.`,
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

  // Dynamic business context
  const businessContext = `<business>
Nombre del negocio: ${biz.name || 'No especificado'}
Tipo de negocio: ${biz.business_type || 'No especificado'}
Dirección: ${biz.address || 'No especificado'}
Teléfono: ${biz.phone || 'No especificado'}
</business>`;

  const dynamicSystemPrompt = SYSTEM_PROMPT + `

${businessContext}

<fecha_actual>
FECHA Y HORA ACTUAL: ${fechaHoy}, ${horaActual}
FECHA ISO HOY: ${fechaISO}
Cuando el usuario diga "hoy" usar exactamente: ${fechaISO}
Cuando diga "mañana" usar: ${mananaISO}
</fecha_actual>`;

  const limitedConversationHistory = conversationHistory.slice(-10);
  const messages = [
    ...limitedConversationHistory,
    { role: 'user', content: userMessage }
  ];

  let response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: dynamicSystemPrompt,
    tools: tools,
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
        const result = await executeTool(block.name, block.input, businessId);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result)
        });
        actionsExecuted.push(block.name);
      }
    }

    apiMessages.push({ role: 'user', content: toolResults });

    response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: dynamicSystemPrompt,
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
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          system: dynamicSystemPrompt,
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
    'no estÃ¡ disponible',
    'no tengo informaciÃ³n',
    'no tengo una funciÃ³n',
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
    response: finalText,
    history: cleanHistory.slice(-10),
    actionsExecuted
  };
}

module.exports = { processMessage };




