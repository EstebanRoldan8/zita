const { supabaseAdmin } = require('../config/supabase');
const logger = require('./logger');

async function logSystemAlert(tipo, mensaje, businessId = null, metadata = {}) {
  try {
    const { data, error } = await supabaseAdmin
      .from('system_alerts')
      .insert({
        tipo,
        mensaje,
        business_id: businessId,
        metadata
      })
      .select()
      .single();

    if (error) {
      logger.error(`[SYSTEM_ALERT_INSERT_FAILED] tipo=${tipo}, error=${error.message}`);
      return null;
    }

    logger.error(`[${tipo}] ${mensaje}`);
    return data;
  } catch (err) {
    logger.error(`[SYSTEM_ALERT_INSERT_ERROR] ${err.message}`);
    return null;
  }
}

module.exports = { logSystemAlert };
