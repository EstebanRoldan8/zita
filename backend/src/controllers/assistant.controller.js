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
    const result = await processMessage(businessId, userMessage, history || []);

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
