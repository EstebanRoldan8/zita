const axios = require('axios');
const logger = require('../utils/logger');

const WHATSAPP_API_URL = `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v18.0'}`;

async function sendMessage(to, message, accessToken = null, phoneNumberId = null) {
  const token = accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  const numberId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  logger.info('Enviando mensaje WhatsApp', { to, message: message?.slice(0, 50) });
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
        }
      }
    );
    logger.info('WhatsApp response', { status: response.status, messages: response.data?.messages });
    return response.data;
  } catch (error) {
    logger.error('WhatsApp error', { status: error.response?.status, message: error.message });
    throw error;
  }
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
