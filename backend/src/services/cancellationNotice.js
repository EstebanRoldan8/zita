// Aviso al cliente de que su cita fue cancelada por el negocio. ÚNICA función para todos los caminos
// que cancelan en nombre del negocio: panel del dueño (PATCH y DELETE), panel del barbero (/api/me) y
// asistente IA (cancelar_cita). El bot NO la usa: ahí cancela el propio cliente en el chat y el bot
// ya le responde en la conversación.
//
// Remitente: SOLO el número del negocio dueño de la cita, con su token descifrado (AES-256) (businessSender).
// Sin número, sin token o con token ilegible no se envía y queda en el log. Nunca sale de otro número.
// Dentro de la ventana de 24 h: texto libre. Fuera: plantilla aviso_cita_cancelada (si WA_TEMPLATES_ENABLED).
// Solo se avisa si la cita vino por WhatsApp (el cliente conversó con ese número), como antes.
// Nunca se loguea el token ni el teléfono completo.
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { maskPhone } = require('../utils/phone');
const { getTimezone } = require('../utils/timezone');
const { notify } = require('./whatsappNotify');
const { businessSender } = require('./businessSender');

// Fecha y hora de la cita como en el mensaje de siempre (es-CO, zona del negocio; Colombia por defecto)
function fechaHoraCita(scheduledAt, country) {
  const tz = getTimezone(country);
  const fecha = new Date(scheduledAt).toLocaleDateString('es-CO', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
  const hora = new Date(scheduledAt).toLocaleTimeString('es-CO', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  return { fecha, hora };
}

function cancellationText(serviceName, scheduledAt, country) {
  const { fecha, hora } = fechaHoraCita(scheduledAt, country);
  return `Hola! 😔 Lamentamos informarte que tu cita de ${serviceName} el ${fecha} a las ${hora} tuvo que ser cancelada.\n¿Te gustaría reagendarla? Con gusto te buscamos otro horario 🗓️`;
}

// Devuelve { sent: true } | { sent: false, reason }. Nunca lanza: un fallo del aviso no deshace la cancelación.
async function notifyClientOfCancellation({ businessId, appointmentId }) {
  try {
    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('id, client_id, scheduled_at, source, services(name), clients(name, phone)')
      .eq('id', appointmentId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (!appt) return { sent: false, reason: 'cita_no_encontrada' };
    if (appt.source !== 'whatsapp' || !appt.client_id) return { sent: false, reason: 'no_vino_por_whatsapp' };
    const clientPhone = appt.clients?.phone;
    if (!clientPhone) return { sent: false, reason: 'sin_telefono' };

    const { data: business } = await supabaseAdmin
      .from('businesses')
      .select('name, country, whatsapp_access_token, whatsapp_phone_number_id')
      .eq('id', businessId)
      .maybeSingle();
    if (!business?.whatsapp_access_token) {
      logger.warn('[WA_SIN_TOKEN] el negocio no tiene WhatsApp conectado; no se envía', { businessId, context: 'cita_cancelada' });
      return { sent: false, reason: 'sin_token' };
    }
    if (!business.whatsapp_phone_number_id) {
      businessSender(business, { businessId, context: 'cita_cancelada' }); // deja el log WA_SIN_NUMERO
      return { sent: false, reason: 'sin_numero' };
    }

    const sender = businessSender(business, { businessId, context: 'cita_cancelada' });
    if (!sender) return { sent: false, reason: 'token_ilegible' };
    const { token, phoneNumberId } = sender;

    const servicio = appt.services?.name || 'tu servicio';
    const text = cancellationText(servicio, appt.scheduled_at, business.country);
    const { fecha, hora } = fechaHoraCita(appt.scheduled_at, business.country);
    const { result } = await notify({
      to: clientPhone, text, token, phoneNumberId, businessId, kind: 'cita_cancelada',
      // {{1}} cliente · {{2}} servicio · {{3}} fecha y hora · {{4}} negocio (notify las sanea y limita)
      template: { key: 'aviso_cita_cancelada', body: [appt.clients?.name, servicio, `${fecha} a las ${hora}`, business.name] },
    });
    if (result?.success === false) {
      logger.error('[CANCEL_NOTICE_ENVIO_FALLIDO]', { businessId, to: maskPhone(clientPhone), status: result.status, metaCode: result.metaCode });
      return { sent: false, reason: 'envio_fallido' };
    }
    logger.info(`Mensaje de cancelación enviado a cliente ${maskPhone(clientPhone)}`);

    // Igual que antes: limpiar el historial para que el bot empiece de cero con ese cliente
    await supabaseAdmin
      .from('whatsapp_conversations')
      .upsert({ business_id: businessId, client_phone: clientPhone, messages: [] }, { onConflict: 'business_id,client_phone' });
    logger.info(`Historial de conversación limpiado para ${maskPhone(clientPhone)}`);
    return { sent: true };
  } catch (err) {
    logger.error(`[CANCEL_NOTICE_ERROR] ${err.message}`);
    return { sent: false, reason: 'error' };
  }
}

module.exports = { notifyClientOfCancellation, cancellationText, fechaHoraCita };
