// Registro del uso real de Claude por llamada (tabla ai_usage, migración 065). Sin PII.
const crypto = require('crypto');
const logger = require('./logger');

// USD por millón de tokens: [input, output, escritura de caché 5 min, lectura de caché]
const PRICES = {
  'claude-haiku-4-5': [1, 5, 1.25, 0.10],
};

function costUsd(model, usage) {
  const key = Object.keys(PRICES).find((p) => String(model || '').startsWith(p));
  if (!key || !usage) return null;
  const [i, o, cw, cr] = PRICES[key];
  return ((usage.input_tokens || 0) * i + (usage.output_tokens || 0) * o
    + (usage.cache_creation_input_tokens || 0) * cw + (usage.cache_read_input_tokens || 0) * cr) / 1e6;
}

// Identificador estable de la conversación sin el teléfono en claro
function convKey(businessId, phoneOrSession) {
  return crypto.createHash('sha256').update(`${businessId}:${phoneOrSession}`).digest('hex').slice(0, 16);
}

const newRequestId = () => crypto.randomUUID();

// Fire-and-forget: nunca rompe ni demora la respuesta al usuario
function logUsage(params, response, meta, latencyMs) {
  if (!meta?.flow) return;
  const u = response?.usage || {};
  const row = {
    business_id: meta.businessId || null,
    flow: meta.flow,
    conversation_key: meta.conversationKey || null,
    request_id: meta.requestId || null,
    iteration: meta.iteration ?? null,
    model: params?.model || 'desconocido',
    input_tokens: u.input_tokens || 0,
    output_tokens: u.output_tokens || 0,
    cache_write_tokens: u.cache_creation_input_tokens || 0,
    cache_read_tokens: u.cache_read_input_tokens || 0,
    stop_reason: response?.stop_reason || null,
    latency_ms: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
    cost_usd: costUsd(params?.model, u),
  };
  try {
    const { supabaseAdmin } = require('../config/supabase');
    Promise.resolve(supabaseAdmin.from('ai_usage').insert(row))
      .then((res) => { if (res?.error) logger.warn('[AI_USAGE_LOG_FAILED]', { code: res.error.code }); })
      .catch(() => {});
  } catch (e) {
    logger.warn('[AI_USAGE_LOG_FAILED]', { error: e.message });
  }
  return row;
}

module.exports = { PRICES, costUsd, convKey, newRequestId, logUsage };
