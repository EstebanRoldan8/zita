const axios = require('axios');

const WHATSAPP_API_URL = `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v18.0'}`;

async function sendMessage(to, message, accessToken = null, phoneNumberId = null) {
  const token = accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  const numberId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  console.log('=== ENVIANDO WA ===', { to, message: message?.slice(0, 50) });
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
    console.log('WA RESPONSE:', response.status, response.data?.messages);
    return response.data;
  } catch (error) {
    console.error('WA ERROR:', error.response?.status, error.message);
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
