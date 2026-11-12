const logger = require('./logger');

// Transitorio = vale la pena reintentar: red/timeout (sin status), 408, 409, 429 y 5xx (incluye 529 = overloaded).
// El SDK de Anthropic expone el código en error.status (no en error.response): antes se reintentaba TODO,
// incluidos 400/401, y con los 2 reintentos internos del SDK eran hasta 9 llamadas por intento.
// Los clientes que pasan por aquí se crean con maxRetries: 0 para que los reintentos sean solo estos.
function isTransientError(error) {
  const status = error?.status ?? error?.response?.status;
  if (status == null) return true;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/**
 * @param {object} client     cliente del SDK (o uno con la misma forma: { messages: { create } })
 * @param {object} params     parámetros de messages.create
 * @param {number} maxRetries reintentos además del primer intento
 * @param {object|null} meta  { flow, businessId, conversationKey, requestId, iteration } para registrar el uso
 * @param {object} [opts]     { baseDelayMs } (tests)
 */
async function callClaudeWithRetry(client, params, maxRetries = 2, meta = null, opts = {}) {
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const t0 = Date.now();
    try {
      const response = await client.messages.create(params);
      // Solo el modelo y los tokens (nunca el contenido del usuario)
      logger.info(`[claude] modelo=${params?.model || 'desconocido'}`);
      if (meta) {
        try {
          require('./aiUsage').logUsage(params, response, meta, Date.now() - t0);
        } catch (e) {
          logger.warn('[AI_USAGE_LOG_FAILED]', { error: e.message });
        }
      }
      return response;
    } catch (error) {
      const isTransient = isTransientError(error);
      const status = error?.status ?? error?.response?.status;
      if (!isTransient || attempt >= maxRetries) {
        logger.error('Claude API error (sin reintento)', { attempt: attempt + 1, status, message: error.message, isTransient });
        throw error;
      }
      const delay = Math.pow(2, attempt) * baseDelayMs;
      logger.warn(`Claude API error transitorio, reintento en ${delay}ms`, { attempt: attempt + 1, status });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return undefined;
}

module.exports = { callClaudeWithRetry, isTransientError };
