// Tool 'escalar_a_humano' del bot de WhatsApp (descripción y parámetros en ../prompt.js → BOT_TOOLS).
// ctx: { businessId, clientPhone, business, clientInfo, citaDelCliente, CITA_NO_ENCONTRADA }
const { supabaseAdmin, logger, logSystemAlert, maskPhone, notify, ownerSender } = require('../shared');

module.exports = async function escalar_a_humano(toolInput, ctx) {
  const { businessId, clientPhone, business, clientInfo } = ctx;
  try {
    const { data: negocio } = await supabaseAdmin
      .from('businesses')
      .select('phone, name')
      .eq('id', businessId)
      .single();

    if (!negocio?.phone) {
      return { success: false, message: 'No se pudo notificar al dueño — número no configurado.' };
    }

    const clientNombre = clientInfo?.name && clientInfo.name !== 'Cliente WhatsApp'
      ? clientInfo.name
      : 'Un cliente';

    // El motivo lo redacta el modelo a partir del texto del cliente: se recorta (riesgo de phishing al dueño)
    const motivo = String(toolInput.motivo || 'Quiere hablar con una persona').replace(/[\r\n]+/g, ' ').slice(0, 200);
    const mensajeDueño = `⚠️ *Atención requerida en ${negocio.name}*\n\n` +
      `Tu cliente *${clientNombre}* (${clientPhone}) quiere hablar contigo.\n\n` +
      `*Motivo:* ${motivo}\n\n` +
      `Contáctalo directamente por WhatsApp.`;

    // Fuera de la ventana de 24 h con el dueño → plantilla aviso_escalamiento (si están activas)
    const sender = ownerSender(business);
    const { result: sendResult } = await notify({
      to: negocio.phone,
      text: mensajeDueño,
      template: { key: 'aviso_escalamiento', body: [negocio.name, clientNombre, clientPhone, motivo] },
      token: sender.token,
      phoneNumberId: sender.phoneNumberId,
      businessId,
    });

    if (!sendResult.success && sendResult.success !== undefined) {
      logger.error('[ESCALAMIENTO_SEND_FAILED]', {
        to: maskPhone(negocio.phone),
        businessId,
        error: sendResult.error
      });
      await logSystemAlert('whatsapp_send_failed',
        `CRÍTICO: Fallo notificación de escalamiento a dueño de ${negocio.name}`,
        businessId,
        { to: maskPhone(negocio.phone), error: sendResult.error, messageType: 'escalamiento_humano' });
      return {
        success: false,
        message: 'No se pudo notificar al dueño del escalamiento. Intenta de nuevo o contacta directamente.'
      };
    }

    const pausadoHasta = new Date();
    pausadoHasta.setHours(pausadoHasta.getHours() + 3);

    const { data: pauseData, error: updateError } = await supabaseAdmin
      .from('whatsapp_conversations')
      .update({ bot_paused_until: pausadoHasta.toISOString() })
      .eq('business_id', businessId)
      .eq('client_phone', clientPhone)
      .select('id');

    if (updateError || !pauseData || pauseData.length === 0) {
      logger.error('[ESCALAR_PAUSE_FAILED]', {
        businessId,
        phone: maskPhone(clientPhone),
        error: updateError?.message
      });
      return {
        success: false,
        message: 'Le avisé al dueño pero no pude pausar el bot correctamente. Por favor intenta de nuevo o escribe directamente.'
      };
    }

    logger.info('Bot pausado por 3 horas para cliente:', { phone: maskPhone(clientPhone), hasta: pausadoHasta.toISOString() });

    return {
      success: true,
      message: 'Dueño notificado correctamente.'
    };
  } catch(e) {
    logger.error('Error escalando a humano:', e.message);
    return { success: false, message: 'No se pudo notificar al dueño.' };
  }
};
