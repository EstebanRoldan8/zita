// Tool 'lista_espera' del bot de WhatsApp (descripción y parámetros en ../prompt.js → BOT_TOOLS).
// ctx: { businessId, clientPhone, business, clientInfo, citaDelCliente, CITA_NO_ENCONTRADA }
const { supabaseAdmin, logger } = require('../shared');

module.exports = async function lista_espera(toolInput, ctx) {
  const { businessId, clientPhone } = ctx;
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
};
