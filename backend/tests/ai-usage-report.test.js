// Reporte de costo de IA (ai_usage) para el superadmin. Ejecutar: node --test tests/ai-usage-report.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');
const { call } = require('./helpers/http');

const now = Date.now();
const iso = (hoursAgo) => new Date(now - hoursAgo * 3600000).toISOString();
const BIZ = '11111111-1111-4111-8111-111111111111';
const row = (o) => ({ business_id: BIZ, input_tokens: 100, output_tokens: 50, cache_write_tokens: 0, cache_read_tokens: 0, cost_usd: 0.001, ...o });
const fake = createFakeSupabase({
  ai_usage: [
    row({ created_at: iso(1), flow: 'whatsapp_bot', conversation_key: 'aaaa', request_id: 'r1', cache_read_tokens: 900, cost_usd: 0.002 }),
    row({ created_at: iso(1), flow: 'whatsapp_bot', conversation_key: 'aaaa', request_id: 'r1', cache_read_tokens: 900, cost_usd: 0.002 }),
    row({ created_at: iso(2), flow: 'whatsapp_bot', conversation_key: 'bbbb', request_id: 'r2', cost_usd: 0.001 }),
    row({ created_at: iso(3), flow: 'assistant', conversation_key: null, request_id: 'r3', cost_usd: 0.01 }),
    row({ created_at: iso(24 * 40), flow: 'assistant', request_id: 'viejo', cost_usd: 99 }),
  ],
});
installFakes(fake);
const { summarizeAiUsage, parseFilters, fetchAiUsage } = require('../src/utils/aiUsageReport');
const { getAiUsage } = require('../src/controllers/aiUsage.controller');

test('resumen por flujo, día y conversación: costo, mensajes (request_id) y % de caché', async () => {
  const { rows } = await fetchAiUsage(fake, parseFilters({ days: 7 }));
  assert.equal(rows.length, 4, 'fuera del rango no entra');
  const r = summarizeAiUsage(rows);
  assert.equal(r.total.costo_usd, 0.015);
  assert.equal(r.total.mensajes, 3);
  assert.equal(r.total.llamadas, 4);
  const bot = r.por_flujo.find((f) => f.flow === 'whatsapp_bot');
  assert.equal(bot.mensajes, 2);
  assert.equal(bot.costo_usd, 0.005);
  // caché: 1800 leídos / (1800 + 300 input) = 85.7 %
  assert.equal(bot.pct_cache, 85.7);
  assert.equal(r.top_conversaciones[0].conversation_key, 'aaaa');
  assert.equal(r.top_conversaciones[0].costo_usd, 0.004);
  assert.equal(r.top_conversaciones.some((c) => c.conversation_key === null), false);
  assert.ok(r.por_dia.length >= 2);
});

test('filtros validados', () => {
  assert.deepEqual(parseFilters({}), { days: 7, businessId: null, flow: null });
  assert.ok(parseFilters({ days: '0' }).error);
  assert.ok(parseFilters({ days: '91' }).error);
  assert.ok(parseFilters({ businessId: "1' or 1=1" }).error);
  assert.ok(parseFilters({ flow: 'otro' }).error);
});

test('endpoint: 200 con el resumen; 400 con filtros inválidos', async () => {
  const ok = await call(getAiUsage, { query: { days: '7', flow: 'assistant' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.total.mensajes, 1);
  assert.equal((await call(getAiUsage, { query: { days: 'x' } })).status, 400);
});

test('la ruta vive en el router de admin, detrás de verifyToken + superadminOnly', () => {
  const router = require(path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js'));
  const { superadminOnly } = require('../src/middlewares/superadmin');
  const guardIdx = router.stack.findIndex((l) => !l.route && l.handle === superadminOnly);
  const routeIdx = router.stack.findIndex((l) => l.route?.path === '/ai-usage' && l.route.methods.get);
  assert.ok(guardIdx > -1 && routeIdx > guardIdx, 'superadminOnly se aplica antes de /ai-usage');
});
