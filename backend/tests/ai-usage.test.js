// Registro del uso de IA (ai_usage): tokens, costo y sin PII.
// Ejecutar: node --test tests/ai-usage.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');

const fake = createFakeSupabase({ ai_usage: [] });
installFakes(fake);
const { costUsd, convKey, logUsage } = require('../src/utils/aiUsage');
const { callClaudeWithRetry } = require('../src/utils/anthropicRetry');

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 5000, cache_read_input_tokens: 10000 };

test('costo con precios de Haiku 4.5 (1 / 5 / 1.25 / 0.10 por millón)', () => {
  // 1000*1 + 200*5 + 5000*1.25 + 10000*0.1 = 1000 + 1000 + 6250 + 1000 = 9250 → /1e6
  assert.equal(costUsd('claude-haiku-4-5-20251001', USAGE), 0.00925);
  assert.equal(costUsd('modelo-desconocido', USAGE), null);
});

test('conversation_key es un hash estable y no contiene el teléfono', () => {
  const k = convKey('biz-1', '573001112233');
  assert.equal(k, convKey('biz-1', '573001112233'));
  assert.equal(k.length, 16);
  assert.ok(!k.includes('3001112233'));
});

test('callClaudeWithRetry con meta guarda una fila por llamada, sin texto ni teléfono', async () => {
  const client = { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hola Juan' }], usage: USAGE }) } };
  await callClaudeWithRetry(client, { model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'mi número es 3001112233' }] }, 0,
    { flow: 'whatsapp_bot', businessId: 'biz-1', conversationKey: convKey('biz-1', '573001112233'), requestId: '00000000-0000-4000-8000-000000000001', iteration: 0 });
  await new Promise((r) => setImmediate(r));
  assert.equal(fake.db.ai_usage.length, 1);
  const row = fake.db.ai_usage[0];
  assert.equal(row.flow, 'whatsapp_bot');
  assert.equal(row.cache_read_tokens, 10000);
  assert.equal(row.cache_write_tokens, 5000);
  assert.equal(Number(row.cost_usd), 0.00925);
  assert.ok(!JSON.stringify(row).includes('3001112233'), 'sin teléfono');
  assert.ok(!JSON.stringify(row).includes('hola Juan'), 'sin texto');
});

test('si la tabla no existe (migración pendiente) no rompe la respuesta', async () => {
  fake.missingTables.add('ai_usage');
  const row = logUsage({ model: 'claude-haiku-4-5' }, { usage: USAGE }, { flow: 'assistant', businessId: 'b' }, 10);
  assert.equal(row.flow, 'assistant');
  fake.missingTables.delete('ai_usage');
});
