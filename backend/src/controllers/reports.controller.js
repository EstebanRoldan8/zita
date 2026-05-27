const { generateMonthlyReport } = require('../services/reports.service');
const logger = require('../utils/logger');

async function monthlyReportPdf(req, res) {
  try {
    const month = (req.query.month || new Date().toISOString().slice(0, 7)).slice(0, 7);
    const buffer = await generateMonthlyReport(req.businessId, month);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-${month}.pdf"`);
    res.end(buffer);
  } catch (err) {
    logger.error(`reports.monthlyReportPdf: ${err.message}`);
    res.status(500).json({ success: false, error: 'Error al generar el reporte.' });
  }
}

module.exports = { monthlyReportPdf };
