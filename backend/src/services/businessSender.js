// Remitente de WhatsApp de un negocio para avisos que inicia el panel: su número y su token (AES-256 descifrado).
// Nunca mezcla credenciales (token del negocio con número global o al revés).
//   - token y phone_number_id → { mode: 'business', token, phoneNumberId }
//   - token sin phone_number_id → { mode: 'default', token: null, phoneNumberId: null } (número por defecto, como antes)
//   - sin token o ilegible      → null (no se envía)
const { decrypt } = require('../utils/encrypt');
const logger = require('../utils/logger');

function safeDecrypt(cipher) {
  try {
    const plain = decrypt(cipher);
    return typeof plain === 'string' && plain.trim() ? plain : null;
  } catch {
    return null;
  }
}

function businessSender(business, { businessId, context } = {}) {
  if (!business?.whatsapp_access_token) return null;
  if (!business.whatsapp_phone_number_id) {
    logger.warn('[WA_NUMERO_POR_DEFECTO] el negocio no tiene número configurado; se usa el número por defecto', { businessId, context });
    return { mode: 'default', token: null, phoneNumberId: null };
  }
  const token = safeDecrypt(business.whatsapp_access_token);
  if (!token) {
    logger.error('[WA_TOKEN_ILEGIBLE] no se pudo descifrar el token del negocio; no se envía', { businessId, context });
    return null;
  }
  return { mode: 'business', token, phoneNumberId: business.whatsapp_phone_number_id };
}

module.exports = { businessSender, safeDecrypt };
