// Ejecutor de tools del bot: una tool por archivo. business_id y el teléfono salen del contexto del mensaje
// (mapeo phone_number_id → negocio), nunca del input del modelo.
const { supabaseAdmin, logger, UUID_RE } = require('../shared');

const TOOLS = {
  ver_servicios: require('./ver_servicios'),
  verificar_disponibilidad: require('./verificar_disponibilidad'),
  agendar_cita: require('./agendar_cita'),
  ver_mis_citas: require('./ver_mis_citas'),
  cancelar_cita: require('./cancelar_cita'),
  ver_productos: require('./ver_productos'),
  ver_mi_fidelizacion: require('./ver_mi_fidelizacion'),
  ver_empleados: require('./ver_empleados'),
  ver_horarios: require('./ver_horarios'),
  confirmar_asistencia: require('./confirmar_asistencia'),
  lista_espera: require('./lista_espera'),
  actualizar_cita: require('./actualizar_cita'),
  escalar_a_humano: require('./escalar_a_humano'),
  gestionar_grupo: require('./gestionar_grupo'),
};

const CITA_NO_ENCONTRADA = { success: false, error: 'No encontré esa cita entre tus citas. Revisa la lista de citas activas.' };

function createToolExecutor({ businessId, clientPhone, business, clientInfo }) {
  // La cita debe ser del negocio Y del cliente que escribe (identificado por su teléfono). Nunca se confía en el
  // appointment_id que mande el modelo: puede venir de un prompt injection o de otra conversación.
  async function citaDelCliente(appointmentId, cols = 'id, scheduled_at, status, employee_id, service_id, services(name, price, duration_minutes)') {
    if (!UUID_RE.test(String(appointmentId || ''))) return null;
    const { data: cli } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('business_id', businessId)
      .eq('phone', clientPhone)
      .limit(1);
    const clientId = cli?.[0]?.id;
    if (!clientId) return null;
    const { data } = await supabaseAdmin
      .from('appointments')
      .select(cols)
      .eq('id', appointmentId)
      .eq('business_id', businessId)
      .eq('client_id', clientId)
      .maybeSingle();
    return data || null;
  }

  const ctx = { businessId, clientPhone, business, clientInfo, citaDelCliente, CITA_NO_ENCONTRADA };

  return async function executeChatbotTool(toolName, toolInput) {
    const tool = Object.prototype.hasOwnProperty.call(TOOLS, toolName) ? TOOLS[toolName] : null;
    if (!tool) return { error: 'Función no disponible' };
    try {
      return await tool(toolInput || {}, ctx);
    } catch (error) {
      logger.error('TOOL_ERROR_' + toolName + '_' + (error.message || String(error)).replace(/\s+/g, '_').slice(0, 300));
      return { error: error.message };
    }
  };
}

module.exports = { createToolExecutor, TOOL_NAMES: Object.keys(TOOLS) };
