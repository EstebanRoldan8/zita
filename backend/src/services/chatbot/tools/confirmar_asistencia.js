// Tool 'confirmar_asistencia' del bot de WhatsApp (descripción y parámetros en ../prompt.js → BOT_TOOLS).
// ctx: { businessId, clientPhone, business, clientInfo, citaDelCliente, CITA_NO_ENCONTRADA }
const { supabaseAdmin } = require('../shared');

module.exports = async function confirmar_asistencia(toolInput, ctx) {
  const { businessId, citaDelCliente, CITA_NO_ENCONTRADA } = ctx;
  const cita = await citaDelCliente(toolInput.appointment_id);
  if (!cita) return CITA_NO_ENCONTRADA;
  const { data, error } = await supabaseAdmin
    .from('appointments')
    .update({ status: 'confirmed' })
    .eq('id', cita.id)
    .eq('business_id', businessId)
    .in('status', ['pending', 'confirmed'])
    .select('id');

  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) {
    return { success: false, error: 'Cita no encontrada' };
  }
  return { success: true, message: 'Asistencia confirmada correctamente' };
};
