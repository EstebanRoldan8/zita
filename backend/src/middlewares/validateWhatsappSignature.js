const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Middleware para validar la firma HMAC del webhook de Meta/WhatsApp.
 * Meta firma cada webhook con X-Hub-Signature-256: sha256=<HMAC-SHA256 del body crudo>
 *
 * REQUISITO: WHATSAPP_APP_SECRET debe estar configurada en variables de entorno.
 */
async function validateWhatsappSignature(req, res, next) {
  // Permite peticiones GET (handshake inicial de verificación de webhook)
  if (req.method === 'GET') {
    return next();
  }

  // Solo valida POST
  if (req.method !== 'POST') {
    return next();
  }

  const signature = req.header('X-Hub-Signature-256');
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  // Si no está configurado el secret, falla en forma segura
  if (!appSecret) {
    logger.error(
      'validateWhatsappSignature: WHATSAPP_APP_SECRET no está configurada. Configure esta variable de entorno con el App Secret de Meta for Developers antes de usar webhooks.'
    );
    return res.status(500).json({
      success: false,
      error: 'Webhook validation not configured. Contact administrator.'
    });
  }

  if (!signature) {
    logger.warn('validateWhatsappSignature: Header X-Hub-Signature-256 faltante');
    return res.status(401).json({ success: false, error: 'Missing signature header' });
  }

  // req.rawBody DEBE estar disponible porque app.js monta express.json con verify
  // que captura el buffer crudo ANTES de parsearse.
  if (!req.rawBody) {
    logger.error(
      'validateWhatsappSignature: req.rawBody not available. This indicates incorrect middleware configuration in app.js — the webhook parser with verify() is not being applied.'
    );
    return res.status(500).json({
      success: false,
      error: 'Webhook signature validation middleware not properly configured'
    });
  }

  const bodyBuffer = typeof req.rawBody === 'string'
    ? Buffer.from(req.rawBody, 'utf-8')
    : req.rawBody;

  // Calcular HMAC-SHA256
  const expectedSignature =
    'sha256=' +
    crypto
      .createHmac('sha256', appSecret)
      .update(bodyBuffer)
      .digest('hex');

  // Comparar usando timingSafeEqual para evitar timing attacks
  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

    if (!isValid) {
      logger.warn('validateWhatsappSignature: Firma HMAC inválida. Webhook rechazado.');
      return res.status(401).json({ success: false, error: 'Invalid signature' });
    }

    logger.info('validateWhatsappSignature: Firma válida. Webhook aceptado.');
    next();
  } catch (err) {
    logger.error(`validateWhatsappSignature: Error en comparación de firma: ${err.message}`);
    return res.status(401).json({ success: false, error: 'Signature validation failed' });
  }
}

module.exports = { validateWhatsappSignature };
