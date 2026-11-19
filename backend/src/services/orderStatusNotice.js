// Aviso al cliente de un PEDIDO WEB (tienda, source 'web') cuando el negocio le cambia el estado.
// Lo dispara orders.updateStatus (panel y asistente de tienda pasan por ahí), después de un cambio exitoso.
//
// - Solo con WA_TEMPLATES_ENABLED=true (sin flag nuevo). Apagado: no se envía nada, igual que antes.
// - Dentro de la ventana de 24 h: texto libre. Fuera: plantilla aviso_pedido_web. Si la plantilla falla, se
//   registra con la etiqueta y NO se manda texto (Meta lo rechazaría igual fuera de la ventana).
// - Sale SOLO del número del negocio con su token (businessSender). Sin número o sin token no se envía y se loguea.
// - Es transaccional (sobre su propio pedido); no depende del consentimiento de marketing del checkout.
// - Nunca lanza: un fallo del aviso no afecta el cambio de estado. Sin teléfonos completos ni tokens en logs.
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { maskPhone } = require('../utils/phone');
const { orderCode } = require('../utils/inventoryHistory');
const { notify, templatesEnabled } = require('./whatsappNotify');
const { businessSender } = require('./businessSender');

// Estado en texto legible (mismos nombres que el panel de Pedidos, en minúscula)
const STATUS_LABELS = {
  recibido: 'recibido',
  en_proceso: 'en proceso',
  listo: 'listo',
  enviado: 'enviado',
  entregado: 'entregado',
  cancelado: 'cancelado',
};

function orderStatusText({ clientName, code, businessName, label }) {
  return `Hola ${clientName || ''}, tu pedido #${code} en ${businessName} cambió de estado: ${label}. Cualquier duda, responde este mensaje.`
    .replace('Hola ,', 'Hola,');
}

// Devuelve { sent: true } | { sent: false, reason }
async function notifyOrderStatusChange({ businessId, orderId, previousStatus, newStatus }) {
  try {
    if (!templatesEnabled()) return { sent: false, reason: 'plantillas_apagadas' };
    if (!STATUS_LABELS[newStatus] || newStatus === 'recibido' || newStatus === previousStatus) {
      return { sent: false, reason: 'sin_cambio' };
    }

    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('id, client_name, client_phone, source')
      .eq('id', orderId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (!order) return { sent: false, reason: 'pedido_no_encontrado' };
    if (order.source !== 'web') return { sent: false, reason: 'no_es_pedido_web' };
    if (!order.client_phone) return { sent: false, reason: 'sin_telefono' };

    const { data: business } = await supabaseAdmin
      .from('businesses')
      .select('name, whatsapp_access_token, whatsapp_phone_number_id')
      .eq('id', businessId)
      .maybeSingle();
    if (!business?.whatsapp_access_token) {
      logger.warn('[WA_SIN_TOKEN] el negocio no tiene WhatsApp conectado; no se envía', { businessId, context: 'pedido_web_estado' });
      return { sent: false, reason: 'sin_token' };
    }
    const sender = businessSender(business, { businessId, context: 'pedido_web_estado' }); // sin número: WA_SIN_NUMERO
    if (!sender) return { sent: false, reason: 'sin_numero_o_token_ilegible' };

    const code = orderCode(order.id);
    const label = STATUS_LABELS[newStatus];
    const text = orderStatusText({ clientName: order.client_name, code, businessName: business.name, label });
    const { via, result } = await notify({
      to: order.client_phone, text, token: sender.token, phoneNumberId: sender.phoneNumberId, businessId, kind: 'pedido_web_estado',
      // {{1}} cliente · {{2}} número de pedido · {{3}} negocio · {{4}} estado (notify las sanea y limita)
      template: { key: 'aviso_pedido_web', body: [order.client_name, code, business.name, label] },
    });
    if (result?.success === false) {
      logger.error('[PEDIDO_WEB_AVISO_FALLIDO]', { businessId, orderId, via, to: maskPhone(order.client_phone), status: result.status, metaCode: result.metaCode });
      return { sent: false, reason: 'envio_fallido' };
    }
    logger.info('[PEDIDO_WEB_AVISO_ENVIADO]', { businessId, orderId, via, estado: newStatus, to: maskPhone(order.client_phone) });
    return { sent: true, via };
  } catch (err) {
    logger.error(`[PEDIDO_WEB_AVISO_ERROR] ${err.message}`);
    return { sent: false, reason: 'error' };
  }
}

module.exports = { notifyOrderStatusChange, STATUS_LABELS, orderStatusText };
