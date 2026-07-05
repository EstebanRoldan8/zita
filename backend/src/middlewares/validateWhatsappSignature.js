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

  // En Express, req.rawBody ya debería estar disponible si usamos un middleware raw-body-capture ANTES.
  // Si no está disponible, construir manualmente desde req.body (JSON parseado).
  // Idealmente, el raw body se captura en app.js con un middleware custom.
  //
  // Por ahora, si existe req.rawBody, usarlo. Si no, reconstituir del body parseado (menos seguro pero funcional).
  let bodyBuffer;

  if (req.rawBody) {
    bodyBuffer = typeof req.rawBody === 'string'
      ? Buffer.from(req.rawBody, 'utf-8')
      : req.rawBody;
  } else {
    // Fallback: reconstituir del body parseado (menos seguro porque el order de JSON properties puede cambiar)
    logger.warn('validateWhatsappSignature: req.rawBody no disponible. Usando JSON parseado (menos seguro).');
    bodyBuffer = Buffer.from(JSON.stringify(req.body), 'utf-8');
  }

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
