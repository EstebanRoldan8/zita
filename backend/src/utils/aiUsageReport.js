// Resumen del costo de IA (tabla ai_usage, migración 065) por flujo, día y conversación.
// Lo usan GET /api/admin/ai-usage (solo superadmin de ZITA) y scripts/ai-usage-report.js.
// Sin PII: conversation_key ya es un hash; aquí no se lee texto ni teléfonos.

const FLOWS = ['whatsapp_bot', 'assistant', 'store_agent', 'system_test'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000;
const MAX_ROWS = 200000; // tope de seguridad

// Valida los filtros (vienen de query string o de argumentos de consola)
function parseFilters({ days, businessId, flow } = {}) {
  const d = days === undefined || days === '' ? 7 : Number(days);
  if (!Number.isInteger(d) || d < 1 || d > 90) return { error: 'days debe ser un entero entre 1 y 90.' };
  if (businessId && !UUID_RE.test(String(businessId))) return { error: 'business_id inválido.' };
  if (flow && !FLOWS.includes(String(flow))) return { error: `flow debe ser uno de: ${FLOWS.join(', ')}.` };
  return { days: d, businessId: businessId || null, flow: flow || null };
}

const dayInBogota = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

function emptyAgg() {
  return { llamadas: 0, requests: new Set(), input: 0, output: 0, cache_write: 0, cache_read: 0, costo_usd: 0 };
}
function add(agg, r) {
  agg.llamadas += 1;
  if (r.request_id) agg.requests.add(r.request_id);
  agg.input += r.input_tokens || 0;
  agg.output += r.output_tokens || 0;
  agg.cache_write += r.cache_write_tokens || 0;
  agg.cache_read += r.cache_read_tokens || 0;
  agg.costo_usd += Number(r.cost_usd) || 0;
}
function finish(agg) {
  const base = agg.cache_read + agg.cache_write + agg.input;
  const mensajes = agg.requests.size || agg.llamadas;
  return {
    mensajes,
    llamadas: agg.llamadas,
    costo_usd: Math.round(agg.costo_usd * 10000) / 10000,
    costo_por_mensaje_usd: mensajes ? Math.round((agg.costo_usd / mensajes) * 1e6) / 1e6 : 0,
    pct_cache: base ? Math.round((1000 * agg.cache_read) / base) / 10 : 0,
    tokens: { input: agg.input, output: agg.output, cache_write: agg.cache_write, cache_read: agg.cache_read },
  };
}

// rows: filas de ai_usage. Devuelve { total, por_flujo, por_dia, top_conversaciones }
function summarizeAiUsage(rows, { topConversations = 20 } = {}) {
  const total = emptyAgg();
  const byFlow = new Map();
  const byDay = new Map();
  const byConv = new Map();
  for (const r of rows || []) {
    add(total, r);
    if (!byFlow.has(r.flow)) byFlow.set(r.flow, emptyAgg());
    add(byFlow.get(r.flow), r);
    const dk = `${dayInBogota(r.created_at)}|${r.flow}`;
    if (!byDay.has(dk)) byDay.set(dk, emptyAgg());
    add(byDay.get(dk), r);
    if (r.conversation_key) {
      const ck = `${r.flow}|${r.conversation_key}`;
      if (!byConv.has(ck)) byConv.set(ck, { agg: emptyAgg(), business_id: r.business_id || null });
      add(byConv.get(ck).agg, r);
    }
  }
  return {
    total: finish(total),
    por_flujo: [...byFlow].map(([flow, a]) => ({ flow, ...finish(a) })).sort((x, y) => y.costo_usd - x.costo_usd),
    por_dia: [...byDay].map(([k, a]) => { const [dia, flow] = k.split('|'); return { dia, flow, ...finish(a) }; })
      .sort((x, y) => (x.dia === y.dia ? x.flow.localeCompare(y.flow) : y.dia.localeCompare(x.dia))),
    top_conversaciones: [...byConv].map(([k, v]) => { const [flow, conversation_key] = k.split('|'); return { flow, conversation_key, business_id: v.business_id, ...finish(v.agg) }; })
      .sort((x, y) => y.costo_usd - x.costo_usd).slice(0, topConversations),
  };
}

// Lee ai_usage paginado con los filtros. db = cliente de Supabase con service role.
async function fetchAiUsage(db, { days, businessId, flow }) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q = db
      .from('ai_usage')
      .select('created_at, business_id, flow, conversation_key, request_id, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd')
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    if (businessId) q = q.eq('business_id', businessId);
    if (flow) q = q.eq('flow', flow);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { rows, since, truncated: rows.length >= MAX_ROWS };
}

module.exports = { parseFilters, summarizeAiUsage, fetchAiUsage, FLOWS };
