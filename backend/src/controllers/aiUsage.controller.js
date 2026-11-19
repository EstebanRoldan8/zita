// GET /api/admin/ai-usage?days=7&business_id=&flow= — solo superadmin de ZITA (router admin: verifyToken + superadminOnly).
// Resumen del costo de IA por flujo, día y conversación (costo, mensajes, % caché). Ver utils/aiUsageReport.js.
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { parseFilters, summarizeAiUsage, fetchAiUsage } = require('../utils/aiUsageReport');

async function getAiUsage(req, res) {
  try {
    const filters = parseFilters({ days: req.query.days, businessId: req.query.business_id, flow: req.query.flow });
    if (filters.error) return res.status(400).json({ success: false, error: filters.error });

    const { rows, since, truncated } = await fetchAiUsage(supabaseAdmin, filters);
    return res.json({
      success: true,
      data: { desde: since, filtros: filters, filas: rows.length, truncado: truncated, ...summarizeAiUsage(rows) },
    });
  } catch (err) {
    if (err?.code === '42P01') {
      return res.status(503).json({ success: false, error: 'La tabla ai_usage no existe todavía (migración 065).' });
    }
    logger.error(`admin.getAiUsage: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = { getAiUsage };
