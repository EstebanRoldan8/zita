// Servicio de notificaciones
// checkTrialExpiringWarnings()            — avisa por WhatsApp a negocios en trial que vence en ~3 días
// notifyPaymentDeclined(business, payment) — avisa por WhatsApp al dueño cuando un pago Wompi es rechazado
//
// TODO futuro: notifySuperadmin(type, payload), sendEmail(to, subject, body)

const { notify } = require('./whatsappNotify');
const { maskPhone } = require('../utils/phone');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

const RAZON_GENERICA_PAGO_RECHAZADO = 'Tu tarjeta no fue autorizada. Verifica los datos o contacta a tu banco.';

function formatearCOP(amountInCents) {
  return Math.round((amountInCents || 0) / 100).toLocaleString('es-CO');
}

// Busca negocios en trial cuyo trial_ends_at cae entre ahora y ahora+4 días
// y a los que aún no se les ha enviado el aviso (trial_warning_sent_at IS NULL).
// Envía WhatsApp al dueño y marca trial_warning_sent_at para no reenviar.
async function checkTrialExpiringWarnings() {
  const errors = [];
  let sent = 0;

  logger.info('[TRIAL_WARNING_CHECK] Iniciando verificación de trials por vencer...');

  try {
    const ahora = new Date();
    const en4Dias = new Date(ahora.getTime() + 4 * 24 * 60 * 60 * 1000);

    const { data: negocios, error: selectError } = await supabaseAdmin
      .from('businesses')
      .select('id, name, phone, trial_ends_at')
      .eq('status', 'trial')
      .is('trial_warning_sent_at', null)
      .gte('trial_ends_at', ahora.toISOString())
      .lte('trial_ends_at', en4Dias.toISOString());

    if (selectError) {
      logger.error('[TRIAL_WARNING_CHECK] Error consultando negocios:', selectError.message);
      errors.push(selectError.message);
      return { sent, errors };
    }

    logger.info(`[TRIAL_WARNING_CHECK] Negocios encontrados: ${negocios?.length || 0}`);

    for (const negocio of negocios || []) {
      try {
        if (!negocio.phone) {
          logger.warn('[TRIAL_WARNING_CHECK] Negocio sin teléfono, se omite', { business_id: negocio.id });
          continue;
        }

        const mensaje = `Hola ${negocio.name}, tu período de prueba en ZITA termina en 3 días. \n` +
          `Renueva tu plan para seguir atendiendo clientes sin interrupciones. \n` +
          `https://app.zita.co/dashboard/suscripcion`;

        // Desde el número de ZITA al dueño: fuera de ventana → plantilla aviso_fin_prueba (si están activas)
        const { result: envio } = await notify({ to: negocio.phone, text: mensaje, template: { key: 'aviso_fin_prueba', body: [negocio.name] }, lastInbound: null });
        if (envio && envio.success === false) {
          errors.push(`business ${negocio.id}: WhatsApp no aceptó el aviso`);
          continue; // no se marca como enviado: se reintenta en la próxima corrida
        }

        const { error: updateError } = await supabaseAdmin
          .from('businesses')
          .update({ trial_warning_sent_at: new Date().toISOString() })
          .eq('id', negocio.id);

        if (updateError) {
          logger.error(`[TRIAL_WARNING_CHECK] Error marcando trial_warning_sent_at para ${negocio.id}:`, updateError.message);
          errors.push(`business ${negocio.id}: ${updateError.message}`);
          continue;
        }

        sent++;
        logger.info('[TRIAL_WARNING_SENT]', { business_id: negocio.id, phone: maskPhone(negocio.phone) });
      } catch (error) {
        logger.error(`[TRIAL_WARNING_CHECK] Error notificando a negocio ${negocio.id}:`, error.message);
        errors.push(`business ${negocio.id}: ${error.message}`);
      }
    }

    logger.info(`[TRIAL_WARNING_CHECK] Finalizado. Enviados: ${sent}, errores: ${errors.length}`);
    return { sent, errors };
  } catch (error) {
    logger.error('[TRIAL_WARNING_CHECK] Error general:', error.message);
    errors.push(error.message);
    return { sent, errors };
  }
}

// Notifica por WhatsApp al dueño de un negocio que su pago fue rechazado/erróneo.
// business: { id, phone, name, ... } — payment: { amount, decline_reason }
async function notifyPaymentDeclined(business, payment) {
  const reason = payment?.decline_reason || RAZON_GENERICA_PAGO_RECHAZADO;
  const amount = payment?.amount;

  logger.warn('[PAYMENT_DECLINED_NOTIFICATION]', {
    business_id: business?.id,
    amount,
    reason
  });

  if (!business?.phone) {
    logger.warn('[PAYMENT_DECLINED_NOTIFICATION] Negocio sin teléfono, no se puede notificar', { business_id: business?.id });
    return;
  }

  const mensaje = `Tu pago de $${formatearCOP(amount)} en ZITA no pudo procesarse. ${reason} \n` +
    `Intenta de nuevo desde tu panel de Suscripción: https://app.zita.co/dashboard/suscripcion`;

  await notify({ to: business.phone, text: mensaje, template: { key: 'pago_rechazado', body: [`${formatearCOP(amount)}`, reason] }, lastInbound: null });
}

module.exports = { checkTrialExpiringWarnings, notifyPaymentDeclined };
