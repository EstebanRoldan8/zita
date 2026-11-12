// Envíos que INICIA el sistema (recordatorios y avisos), respetando la ventana de 24 h de WhatsApp.
//
// WhatsApp solo acepta texto libre si el destinatario le escribió a ese número en las últimas 24 h. Fuera de esa
// ventana Meta acepta la petición pero luego la descarta (estado 'failed', error 131047): el mensaje nunca llega.
// Fuera de ventana hay que usar una plantilla aprobada en Meta (ver docs/PLANTILLAS_WHATSAPP.md).
//
// Regla:
//   - dentro de la ventana                     → texto libre (más rico, sin costo de plantilla)
//   - fuera de ventana y WA_TEMPLATES_ENABLED   → plantilla aprobada
//   - fuera de ventana y plantillas apagadas    → texto libre como antes + aviso en el log (probablemente no llegue)
//
// La ventana se calcula con el último mensaje del destinatario guardado en whatsapp_conversations (historial).

const { sendMessage, sendTemplate } = require('../config/whatsapp');
const { loadConversation, lastInboundAt } = require('./conversationStore');
const logger = require('../utils/logger');
const { maskPhone } = require('../utils/phone');

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SAFETY_MARGIN_MS = 10 * 60 * 1000; // no apurar el borde de la ventana

// Nombres de las plantillas (se pueden cambiar con variables de entorno sin tocar código)
const TEMPLATES = {
  recordatorio_cita: process.env.WA_TPL_RECORDATORIO || 'recordatorio_cita',
  aviso_nueva_cita: process.env.WA_TPL_NUEVA_CITA || 'aviso_nueva_cita',
  aviso_escalamiento: process.env.WA_TPL_ESCALAMIENTO || 'aviso_escalamiento',
  resumen_diario: process.env.WA_TPL_RESUMEN || 'resumen_diario',
  plan_vencido: process.env.WA_TPL_PLAN_VENCIDO || 'plan_vencido',
  aviso_fin_prueba: process.env.WA_TPL_FIN_PRUEBA || 'aviso_fin_prueba',
  pago_rechazado: process.env.WA_TPL_PAGO_RECHAZADO || 'pago_rechazado',
  te_extranamos: process.env.WA_TPL_TE_EXTRANAMOS || 'te_extranamos',
};

const templatesEnabled = () => String(process.env.WA_TEMPLATES_ENABLED || '').toLowerCase() === 'true';

function insideWindow(lastInbound, now = Date.now()) {
  if (!lastInbound) return false;
  return now - new Date(lastInbound).getTime() < WINDOW_MS - SAFETY_MARGIN_MS;
}

// Último mensaje del destinatario a este negocio (null si nunca escribió o no hay negocio)
async function lastInboundFor(businessId, phone) {
  if (!businessId || !phone) return null;
  const conv = await loadConversation(businessId, phone);
  return lastInboundAt(conv?.messages);
}

/**
 * @param {object} p
 * @param {string} p.to                 teléfono destino
 * @param {string} p.text               texto libre (dentro de la ventana o sin plantillas)
 * @param {object} p.template           { key, body: [params], buttons?: ['PAYLOAD'] }
 * @param {string} [p.token]            token del negocio (desencriptado). Sin token = número global de ZITA.
 * @param {string} [p.phoneNumberId]
 * @param {string} [p.businessId]       para calcular la ventana con el historial
 * @param {Date|string|null} [p.lastInbound]  si ya se conoce, evita la consulta
 * @returns {Promise<{ via: 'text'|'template', result: object }>}
 */
async function notify({ to, text, template, token = null, phoneNumberId = null, businessId = null, lastInbound }) {
  const inbound = lastInbound !== undefined ? lastInbound : await lastInboundFor(businessId, to);
  if (insideWindow(inbound) || !template) {
    return { via: 'text', result: await sendMessage(to, text, token, phoneNumberId) };
  }
  if (templatesEnabled()) {
    const name = TEMPLATES[template.key] || template.key;
    return { via: 'template', result: await sendTemplate(to, name, { body: template.body, buttons: template.buttons }, token, phoneNumberId) };
  }
  logger.warn('[WA_FUERA_DE_VENTANA_SIN_PLANTILLA] se manda texto libre; Meta probablemente lo descarte (131047)', { template: template.key, to: maskPhone(to) });
  return { via: 'text', result: await sendMessage(to, text, token, phoneNumberId) };
}

module.exports = { notify, insideWindow, lastInboundFor, TEMPLATES, templatesEnabled };
