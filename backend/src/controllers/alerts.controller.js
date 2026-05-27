const { getAlerts } = require('../services/alerts.service');
const logger = require('../utils/logger');

async function getAlertsHandler(req, res) {
  try {
    const data = await getAlerts(req.businessId);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`alerts.getAlerts: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = { getAlertsHandler };
