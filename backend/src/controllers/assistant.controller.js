const logger = require('../utils/logger');

async function message(req, res) {
  try {
    const { message: userMessage, history } = req.body;
    const businessId = req.businessId;

    logger.info('=== ASSISTANT DEBUG ===');
    logger.info('businessId:', businessId);
    logger.info('message:', userMessage);

    if (!businessId) {
      return res.status(400).json({
        success: false,
        error: 'No se encontró el businessId'
      });
    }

    // Probar query directo de servicios antes de llamar al assistant
    const { supabaseAdmin } = require('../config/supabase');
    const { data: testServices, error: testError } = await supabaseAdmin
      .from('services')
      .select('id, name')
      .eq('business_id', businessId)
      .eq('is_active', true);

    logger.info('Servicios encontrados directamente:', testServices?.length, testError?.message);

    const { processMessage } = require('../services/assistant.service');
    const result = await processMessage(businessId, userMessage, history || []);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('assistant error completo:', error);
    logger.error('stack:', error.stack);
    res.status(500).json({
      success: false,
      error: error.message,
      detail: error.stack
    });
  }
}

module.exports = { message };
