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

// Se llama a wa.sendMessage / wa.sendTemplate en cada envío (no desestructurado) para que los dobles de prueba apliquen
const wa = require('../config/whatsapp');
const { loadConversation, lastInboundAt } = require('./conversationStore');
const logger = require('../utils/logger');
const { maskPhone } = require('../utils/phone');

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SAFETY_MARGIN_MS = 10 * 60 * 1000; // no apurar el borde de la ventana

// ÚNICO lugar con el nombre y el idioma de cada plantilla, tal como quedaron aprobadas en Meta
// (ver la tabla en docs/PLANTILLAS_WHATSAPP.md). El idioma debe ser EXACTAMENTE el de Meta: si no coincide,
// Meta responde 132001 ("template name does not exist in the translation") y el mensaje no sale.
//   env:  variable con el nombre aprobado (permite cambiarlo sin tocar código)
//   name: nombre por defecto; null = obligatorio por variable (en Meta quedaron como *_v2)
//   lang: código de idioma aprobado en Meta
const TEMPLATE_CONFIG = {
  recordatorio_cita:  { env: 'WA_TPL_RECORDATORIO',   name: 'recordatorio_cita',  lang: 'es_CO' },
  aviso_nueva_cita:   { env: 'WA_TPL_NUEVA_CITA',     name: 'aviso_nueva_cita',   lang: 'es' },
  aviso_escalamiento: { env: 'WA_TPL_ESCALAMIENTO',   name: 'aviso_escalamiento', lang: 'es_CO' },
  resumen_diario:     { env: 'WA_TPL_RESUMEN',        name: 'resumen_diario',     lang: 'es_CO' },
  plan_vencido:       { env: 'WA_TPL_PLAN_VENCIDO',   name: 'plan_vencido',       lang: 'es_CO' },
  aviso_fin_prueba:   { env: 'WA_TPL_FIN_PRUEBA',     name: null,                 lang: 'es_CO' },
  pago_rechazado:     { env: 'WA_TPL_PAGO_RECHAZADO', name: null,                 lang: 'es_CO' },
  te_extranamos:      { env: 'WA_TPL_TE_EXTRANAMOS',  name: 'te_extranamos',      lang: 'es_CO' },
};

// { name, lang } de una plantilla, o null si su nombre es obligatorio y falta la variable.
// Se lee en cada envío (no al cargar el módulo) para que un cambio de variables aplique sin sorpresas.
function resolveTemplate(key) {
  const cfg = TEMPLATE_CONFIG[key];
  if (!cfg) return { name: key, lang: process.env.WA_TEMPLATE_LANG || 'es' }; // plantilla fuera del mapa
  const name = String(process.env[cfg.env] || '').trim() || cfg.name;
  return name ? { name, lang: cfg.lang } : null;
}

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
 * @param {string} [p.kind]             tipo de aviso (solo para logs), p. ej. 'cita_cancelada'
 * @returns {Promise<{ via: 'text'|'template', result: object }>}
 */
async function notify({ to, text, template, token = null, phoneNumberId = null, businessId = null, lastInbound, kind = null }) {
  const inbound = lastInbound !== undefined ? lastInbound : await lastInboundFor(businessId, to);
  if (insideWindow(inbound)) {
    return { via: 'text', result: await wa.sendMessage(to, text, token, phoneNumberId) };
  }
  if (!template) {
    // Aviso sin plantilla aprobada en Meta: fuera de la ventana no hay alternativa. Se manda texto (como antes)
    // y queda marcado para saber qué plantilla falta crear (ver docs/PLANTILLAS_WHATSAPP.md).
    logger.warn('[WA_FUERA_DE_VENTANA_SIN_PLANTILLA_APROBADA] aviso sin plantilla en Meta; texto libre, puede no llegar (131047)', { kind, to: maskPhone(to) });
    return { via: 'text', result: await wa.sendMessage(to, text, token, phoneNumberId) };
  }
  if (templatesEnabled()) {
    const tpl = resolveTemplate(template.key);
    if (!tpl) {
      // Falla segura: sin el nombre aprobado no se intenta una plantilla que Meta rechazaría; no se rompe el flujo
      logger.error('[WA_PLANTILLA_SIN_NOMBRE] falta la variable con el nombre aprobado; se manda texto libre (probablemente no llegue)', {
        template: template.key, variable: TEMPLATE_CONFIG[template.key].env, to: maskPhone(to),
      });
      return { via: 'text', result: await wa.sendMessage(to, text, token, phoneNumberId) };
    }
    return { via: 'template', result: await wa.sendTemplate(to, tpl.name, { body: template.body, buttons: template.buttons }, token, phoneNumberId, tpl.lang) };
  }
  logger.warn('[WA_FUERA_DE_VENTANA_SIN_PLANTILLA] se manda texto libre; Meta probablemente lo descarte (131047)', { template: template.key, kind, to: maskPhone(to) });
  return { via: 'text', result: await wa.sendMessage(to, text, token, phoneNumberId) };
}

module.exports = { notify, insideWindow, lastInboundFor, TEMPLATE_CONFIG, resolveTemplate, templatesEnabled };
