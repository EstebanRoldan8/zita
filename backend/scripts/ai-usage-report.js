// Reporte de costo de IA desde la consola (para el equipo de ZITA; usa la llave de servicio del .env).
//   cd backend && node scripts/ai-usage-report.js [--days 7] [--business <uuid>] [--flow whatsapp_bot] [--json]
// Mismo cálculo que GET /api/admin/ai-usage (utils/aiUsageReport.js). Sin PII: conversation_key es un hash.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { parseFilters, summarizeAiUsage, fetchAiUsage } = require('../src/utils/aiUsageReport');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function table(rows, cols) {
  if (!rows.length) return '  (sin datos)';
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (vals) => '  ' + vals.map((v, i) => String(v ?? '').padEnd(w[i])).join('  ');
  return [line(cols), line(w.map((n) => '-'.repeat(n))), ...rows.map((r) => line(cols.map((c) => r[c])))].join('\n');
}

(async () => {
  const filters = parseFilters({ days: arg('days'), businessId: arg('business'), flow: arg('flow') });
  if (filters.error) { console.error(filters.error); process.exit(1); }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en backend/.env');
    process.exit(1);
  }
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { rows, since, truncated } = await fetchAiUsage(db, filters);
  const r = summarizeAiUsage(rows);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ desde: since, filtros: filters, filas: rows.length, truncado: truncated, ...r }, null, 2));
    return;
  }
  const cols = ['mensajes', 'llamadas', 'costo_usd', 'costo_por_mensaje_usd', 'pct_cache'];
  console.log(`\nCosto de IA desde ${since} (${rows.length} llamadas${truncated ? ', TRUNCADO' : ''})`);
  console.log(`\nTotal: ${r.total.costo_usd} USD · ${r.total.mensajes} mensajes · ${r.total.pct_cache} % caché\n`);
  console.log('Por flujo:\n' + table(r.por_flujo, ['flow', ...cols]));
  console.log('\nPor día:\n' + table(r.por_dia, ['dia', 'flow', ...cols]));
  console.log('\nConversaciones más caras:\n' + table(r.top_conversaciones, ['flow', 'conversation_key', ...cols]));
})().catch((err) => {
  console.error(err.code === '42P01' ? 'La tabla ai_usage no existe (falta la migración 065).' : err.message);
  process.exit(1);
});
