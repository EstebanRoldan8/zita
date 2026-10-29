const logger = require('../utils/logger');

async function message(req, res) {
  try {
    const { message: userMessage, history } = req.body;
    const businessId = req.businessId;

    logger.info('=== ASSISTANT DEBUG ===');
    logger.info('businessId:', businessId);
    logger.info('messageLength:', userMessage?.length || 0);

    if (!businessId) {
      return res.status(400).json({
        success: false,
        error: 'No se encontró el businessId'
      });
    }

    const { processMessage } = require('../services/assistant.service');
    // businessId y token SIEMPRE de la sesión (JWT); un business_id en el body o en el mensaje se ignora
    const result = await processMessage(businessId, userMessage, history || [], {
      authorization: req.headers.authorization,
    });

    if (result.success === false) {
      return res.json({ success: false, error: result.error, code: result.code });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Process message error:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Error procesando tu solicitud'
    });
  }
}

module.exports = { message };
