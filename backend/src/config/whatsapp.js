const axios = require('axios');
const logger = require('../utils/logger');

const WHATSAPP_API_URL = `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v18.0'}`;
const WHATSAPP_TIMEOUT = 15000; // 15 segundos
const WHATSAPP_RETRIES = 2;
const TRANSIENT_ERROR_CODES = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNABORTED', 'ECONNREFUSED', 'ENETUNREACH'];
const TRANSIENT_HTTP_CODES = [429, 500, 502, 503, 504]; // rate-limit y 5xx

function isTransientError(error) {
  if (!error.response) {
    return TRANSIENT_ERROR_CODES.includes(error.code);
  }
  return TRANSIENT_HTTP_CODES.includes(error.response.status);
}

async function sendMessage(to, message, accessToken = null, phoneNumberId = null) {
  const token = accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  const numberId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  logger.info('Enviando mensaje WhatsApp', { to, message: message?.slice(0, 50) });

  let lastError = null;
  for (let attempt = 0; attempt <= WHATSAPP_RETRIES; attempt++) {
    try {
      const response = await axios.post(
        `${WHATSAPP_API_URL}/${numberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: to,
          type: 'text',
          text: { body: message }
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: WHATSAPP_TIMEOUT
        }
      );
      logger.info('WhatsApp response', { status: response.status, messages: response.data?.messages });
      return response.data;
    } catch (error) {
      lastError = error;
      const isTransient = isTransientError(error);
      const attemptsLeft = WHATSAPP_RETRIES - attempt;

      if (!isTransient || attemptsLeft <= 0) {
        logger.error('WhatsApp error (no reintent)', {
          attempt: attempt + 1,
          status: error.response?.status,
          code: error.code,
          message: error.message,
          isTransient
        });
        return { success: false, error: error.message, status: error.response?.status || error.code };
      }

      logger.warn(`WhatsApp reintent ${attempt + 1}/${WHATSAPP_RETRIES}`, {
        code: error.code,
        status: error.response?.status
      });
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  return { success: false, error: lastError?.message, status: lastError?.response?.status || lastError?.code };
}

async function sendTemplate(to, templateName, components = [], accessToken = null, phoneNumberId = null) {
  const token = accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  const numberId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  const response = await axios.post(
    `${WHATSAPP_API_URL}/${numberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'es' },
        components
      }
    },
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data;
}

module.exports = { sendMessage, sendTemplate };
