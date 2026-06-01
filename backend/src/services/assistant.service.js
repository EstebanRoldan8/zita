const Anthropic = require('@anthropic-ai/sdk');
const { supabaseAdmin } = require('../config/supabase');
const { PLANS } = require('../config/plans');
const logger = require('../utils/logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
        scheduled_at: { type: 'string', description: 'Fecha y hora en formato ISO: YYYY-MM-DDTHH:mm:00' },
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
  }
];

// Ejecutar cada tool
async function executeTool(toolName, toolInput, businessId) {
  try {
    const today = new Date().toISOString().split('T')[0];

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
        .select('id, name, price, stock')
        .eq('business_id', businessId)
        .eq('is_active', true);

      if (!allProducts || allProducts.length === 0) {
        return { found: false, message: 'No encontré ese producto' };
      }

      const matches = allProducts.filter(p =>
        normalize(p.name).includes(normalizedSearch) || normalizedSearch.split(' ').some(w => normalize(p.name).includes(w))
      );

      if (matches.length === 0) {
        return { found: false, message: 'No encontré ese producto' };
      }

      if (matches.length === 1) return { found: true, product: matches[0] };

      const bestMatch = matches.reduce((best, current) => {
        const currentScore = calculateSimilarity(toolInput.nombre, current.name);
        const bestScore = calculateSimilarity(toolInput.nombre, best.name);
        return currentScore > bestScore ? current : best;
      });
      return { found: true, product: bestMatch };
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
        .gte('scheduled_at', `${fecha}T00:00:00`)
        .lte('scheduled_at', `${fecha}T23:59:59`)
        .order('scheduled_at');
      return { appointments: data, date: fecha };
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

      const insertData = {
        business_id: businessId,
        client_id: toolInput.client_id || null,
        service_id: toolInput.service_id,
        employee_id: toolInput.employee_id || null,
        scheduled_at: scheduledAt,
        status: 'confirmed',
        source: 'manual',
        notes: toolInput.notes || null,
        price: service?.price || 0
      };

      logger.info('insertData:', JSON.stringify(insertData));

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
            source: 'appointment',
            payment_method: 'cash'
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
      const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
      const primerDiaDelMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        .toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

      const { data: ingresos } = await supabaseAdmin
        .from('income')
        .select('amount')
        .eq('business_id', businessId)
        .gte('date', toolInput.periodo === 'day' ? hoy : toolInput.periodo === 'week'
          ? new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
          : primerDiaDelMes);

      const total = ingresos?.reduce((sum, i) => sum + (i.amount || 0), 0) || 0;
      return { total_income: total, period: toolInput.periodo, currency: 'COP' };
    }

    case 'registrar_venta': {
      const { data: product } = await supabaseAdmin
        .from('products')
        .select('stock, price')
        .eq('id', toolInput.product_id)
        .single();

      if (!product || product.stock < toolInput.quantity) {
        return { success: false, error: 'Stock insuficiente' };
      }

      await supabaseAdmin
        .from('products')
        .update({ stock: product.stock - toolInput.quantity })
        .eq('id', toolInput.product_id);

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
        .select('id, name, price, stock')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('name');
      return { products: data };
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

      return {
        total_visits: loyalty?.total_visits || 0,
        loyalty_visits: loyalty?.loyalty_visits || 0,
        total_spent: totalGastado,
        last_visit: appointments?.[0]?.scheduled_at || null,
        recent_appointments: appointments
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
        error: `Alcanzaste el límite de ${limite} mensajes diarios del asistente IA. Renueva mañana o mejora tu plan.`,
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

  const limitedConversationHistory = conversationHistory.slice(-6);
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
    history: cleanHistory.slice(-6),
    actionsExecuted
  };
}

module.exports = { processMessage };




