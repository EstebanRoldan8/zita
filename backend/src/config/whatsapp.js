const axios = require('axios');
const logger = require('../utils/logger');
const { maskPhone } = require('../utils/phone');

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

// POST a la Cloud API con reintentos para errores transitorios. Nunca loguea el token, el número completo
// ni el texto del mensaje (PII). Devuelve la respuesta de Meta o { success: false, error, status }.
async function postMessage(payload, accessToken, phoneNumberId, kind) {
  const token = accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  const numberId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  let lastError = null;
  for (let attempt = 0; attempt <= WHATSAPP_RETRIES; attempt++) {
    try {
      const response = await axios.post(`${WHATSAPP_API_URL}/${numberId}/messages`, payload, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: WHATSAPP_TIMEOUT,
      });
      logger.info('WhatsApp enviado', { kind, to: maskPhone(payload.to), status: response.status });
      return response.data;
    } catch (error) {
      lastError = error;
      const isTransient = isTransientError(error);
      if (!isTransient || attempt === WHATSAPP_RETRIES) {
        logger.error('WhatsApp error (sin reintento)', {
          kind, attempt: attempt + 1, status: error.response?.status, code: error.code,
          metaCode: error.response?.data?.error?.code, isTransient,
        });
        return { success: false, error: error.response?.data?.error?.message || error.message, status: error.response?.status || error.code, metaCode: error.response?.data?.error?.code };
      }
      logger.warn(`WhatsApp reintento ${attempt + 1}/${WHATSAPP_RETRIES}`, { kind, code: error.code, status: error.response?.status });
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  return { success: false, error: lastError?.message, status: lastError?.response?.status || lastError?.code };
}

async function sendMessage(to, message, accessToken = null, phoneNumberId = null) {
  return postMessage({ messaging_product: 'whatsapp', to, type: 'text', text: { body: message } }, accessToken, phoneNumberId, 'text');
}

// Parámetros de plantilla: Meta no acepta saltos de línea, tabs ni más de 4 espacios seguidos, ni texto vacío
function templateParam(value) {
  const t = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 1000);
  return t || '-';
}

// components puede venir armado (formato de la API) o como { body: [...], buttons: ['PAYLOAD', ...] }
function buildComponents(components) {
  if (Array.isArray(components)) return components;
  const out = [];
  if (components?.body?.length) {
    out.push({ type: 'body', parameters: components.body.map((p) => ({ type: 'text', text: templateParam(p) })) });
  }
  (components?.buttons || []).forEach((payload, i) => {
    out.push({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload }] });
  });
  return out;
}

async function sendTemplate(to, templateName, components = [], accessToken = null, phoneNumberId = null, languageCode = null) {
  return postMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode || process.env.WA_TEMPLATE_LANG || 'es' },
      components: buildComponents(components),
    },
  }, accessToken, phoneNumberId, `template:${templateName}`);
}

module.exports = { sendMessage, sendTemplate, templateParam, buildComponents };
