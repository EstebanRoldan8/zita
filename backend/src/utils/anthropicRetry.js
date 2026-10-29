const logger = require('./logger');

function isTransientError(error) {
  if (!error.response) {
    return true;
  }
  const status = error.status || error.response?.status;
  return status !== 400 && status !== 401 && status !== 403;
}

async function callClaudeWithRetry(client, params, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.messages.create(params);
      // Solo el nombre del modelo (nunca el contenido del usuario): permite saber qué modelo corre en producción
      logger.info(`[claude] modelo=${params?.model || 'desconocido'}`);
      return response;
    } catch (error) {
      const isTransient = isTransientError(error);
      const attemptsLeft = maxRetries - attempt;

      if (!isTransient || attemptsLeft <= 0) {
        logger.error('Claude API error (no reintent)', {
          attempt: attempt + 1,
          status: error.status || error.response?.status,
          message: error.message,
          isTransient
        });
        throw error;
      }

      const delay = Math.pow(2, attempt) * 1000;
      logger.warn(`Claude API error (transient), reintentando en ${delay}ms...`, {
        attempt: attempt + 1,
        status: error.status || error.response?.status,
        error: error.message
      });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

module.exports = { callClaudeWithRetry };
