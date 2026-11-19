// Aviso al cliente de que su cita fue cancelada por el negocio. ÚNICA función para todos los caminos
// que cancelan en nombre del negocio: panel del dueño (PATCH y DELETE), panel del barbero (/api/me) y
// asistente IA (cancelar_cita). El bot NO la usa: ahí cancela el propio cliente en el chat y el bot
// ya le responde en la conversación.
//
// Remitente: el número del negocio dueño de la cita, con su token descifrado (AES-256).
//   - negocio con token y phone_number_id → sale de su número
//   - negocio con token pero sin phone_number_id → respaldo al comportamiento anterior: número por
//     defecto (variables de entorno), con aviso en el log
//   - negocio sin token o token ilegible → no se envía (antes tampoco salía sin token)
// Solo se avisa si la cita vino por WhatsApp (el cliente conversó con ese número), como antes.
// Nunca se loguea el token ni el teléfono completo.
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { decrypt } = require('../utils/encrypt');
const { maskPhone } = require('../utils/phone');
const { getTimezone } = require('../utils/timezone');
const { notify } = require('./whatsappNotify');

function safeDecrypt(cipher) {
  try {
    const plain = decrypt(cipher);
    return typeof plain === 'string' && plain.trim() ? plain : null;
  } catch {
    return null;
  }
}

function cancellationText(serviceName, scheduledAt, country) {
  const tz = getTimezone(country);
  const fecha = new Date(scheduledAt).toLocaleDateString('es-CO', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
  const hora = new Date(scheduledAt).toLocaleTimeString('es-CO', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  return `Hola! 😔 Lamentamos informarte que tu cita de ${serviceName} el ${fecha} a las ${hora} tuvo que ser cancelada.\n¿Te gustaría reagendarla? Con gusto te buscamos otro horario 🗓️`;
}

// Devuelve { sent: true } | { sent: false, reason }. Nunca lanza: un fallo del aviso no deshace la cancelación.
async function notifyClientOfCancellation({ businessId, appointmentId }) {
  try {
    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('id, client_id, scheduled_at, source, services(name), clients(phone)')
      .eq('id', appointmentId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (!appt) return { sent: false, reason: 'cita_no_encontrada' };
    if (appt.source !== 'whatsapp' || !appt.client_id) return { sent: false, reason: 'no_vino_por_whatsapp' };
    const clientPhone = appt.clients?.phone;
    if (!clientPhone) return { sent: false, reason: 'sin_telefono' };

    const { data: business } = await supabaseAdmin
      .from('businesses')
      .select('country, whatsapp_access_token, whatsapp_phone_number_id')
      .eq('id', businessId)
      .maybeSingle();
    if (!business?.whatsapp_access_token) return { sent: false, reason: 'sin_token' };

    let token = null;
    let phoneNumberId = null;
    if (business.whatsapp_phone_number_id) {
      token = safeDecrypt(business.whatsapp_access_token);
      if (!token) {
        logger.error('[CANCEL_NOTICE_TOKEN_ILEGIBLE] no se pudo descifrar el token del negocio; no se envía', { businessId });
        return { sent: false, reason: 'token_ilegible' };
      }
      phoneNumberId = business.whatsapp_phone_number_id;
    } else {
      logger.warn('[CANCEL_NOTICE_NUMERO_POR_DEFECTO] el negocio no tiene número configurado; se usa el número por defecto', { businessId });
    }

    const text = cancellationText(appt.services?.name || 'tu servicio', appt.scheduled_at, business.country);
    // Sin plantilla aprobada para este aviso: siempre texto libre (lastInbound null evita la consulta de la ventana)
    const { result } = await notify({ to: clientPhone, text, token, phoneNumberId, businessId, lastInbound: null });
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

module.exports = { notifyClientOfCancellation, cancellationText };
