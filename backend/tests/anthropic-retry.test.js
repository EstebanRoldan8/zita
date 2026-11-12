// Reintentos a Anthropic: solo errores transitorios (red, 408, 409, 429, 5xx/529), nunca 400/401/403/404.
// Ejecutar: node --test tests/anthropic-retry.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const lp = require.resolve(path.join(__dirname, '..', 'src', 'utils', 'logger'));
require.cache[lp] = { id: lp, filename: lp, loaded: true, exports: { info() {}, warn() {}, error() {} } };
const { callClaudeWithRetry, isTransientError } = require('../src/utils/anthropicRetry');

// Error con la forma del SDK de Anthropic: expone .status (no .response)
const apiError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

test('400 / 401 / 403 / 404 no se reintentan (el SDK no trae .response y antes se reintentaba todo)', async () => {
  for (const status of [400, 401, 403, 404]) {
    let calls = 0;
    const client = { messages: { create: async () => { calls++; throw apiError(status); } } };
    await assert.rejects(callClaudeWithRetry(client, { model: 'm' }, 2, null, { baseDelayMs: 1 }));
    assert.equal(calls, 1, `status ${status}`);
  }
});

test('429 / 529 / error de red sí se reintentan', async () => {
  assert.equal(isTransientError(apiError(429)), true);
  assert.equal(isTransientError(apiError(529)), true);
  assert.equal(isTransientError(apiError(500)), true);
  assert.equal(isTransientError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })), true);
  let calls = 0;
  const client = { messages: { create: async () => { calls++; if (calls < 3) throw apiError(529); return { content: [], usage: {} }; } } };
  await callClaudeWithRetry(client, { model: 'm' }, 2, null, { baseDelayMs: 1 });
  assert.equal(calls, 3);
});
