// Límite de mensajes de IA del plan en la ruta de TIENDA (processMessage real con Supabase simulado).
// Ejecutar: node --test tests/store-limits.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
let db;
function q(table) {
  const f = []; let op = 'select'; let payload = null; let one = false;
  const run = () => {
    const rows = (db[table] || []).filter((r) => f.every(([k, v]) => r[k] === v));
    if (op === 'update') { rows.forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
    if (op === 'insert') { (db[table] ||= []).push({ id: `x${Date.now()}`, created_at: new Date().toISOString(), ...payload }); return { data: null, error: null }; }
    return { data: one ? rows[0] || null : rows, error: null };
  };
  const b = {
    select() { return b; }, eq(k, v) { f.push([k, v]); return b; }, neq() { return b; }, in() { return b; }, gte() { return b; }, lte() { return b; },
    order() { return b; }, limit() { return b; }, update(p) { op = 'update'; payload = p; return b; }, insert(p) { op = 'insert'; payload = p; return b; },
    single() { one = true; return Promise.resolve(run()); }, maybeSingle() { one = true; return Promise.resolve(run()); },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  return b;
}
const fake = { from: q, rpc: async () => ({ data: null, error: null }) };
const supaPath = require.resolve('../src/config/supabase');
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { supabaseAdmin: fake, createUserClient: () => fake } };
const loggerPath = require.resolve('../src/utils/logger');
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: { info() {}, warn() {}, error() {} } };
const { processMessage } = require('../src/services/assistant.service');

function reset(aiToday) {
  db = {
    businesses: [{ id: 'tienda-1', plan: 'estandar', business_type: 'Tienda', name: 'FLOW', slug: 'flow', status: 'active', ai_messages_today: aiToday, ai_messages_date: today, store_settings: {} }],
    assistant_actions: [], products: [], product_variants: [], orders: [],
  };
}

test('tienda en el límite del plan (Estándar = 20/día): no se procesa nada y avisa', async () => {
  reset(20);
  const r = await processMessage('tienda-1', 'registra un gasto de 50 mil en bolsas', [], { authorization: 'Bearer u' });
  assert.equal(r.success, false);
  assert.equal(r.code, 'AI_LIMIT_REACHED');
  assert.equal(db.businesses[0].ai_messages_today, 20, 'no suma');
});

test('tienda por debajo del límite: suma 1 al contador y responde el agente de tienda', async () => {
  reset(3);
  const r = await processMessage('tienda-1', 'hola', [], { authorization: 'Bearer u' });
  assert.match(r.response, /Soy el asistente de FLOW/);
  assert.equal(db.businesses[0].ai_messages_today, 4);
});
