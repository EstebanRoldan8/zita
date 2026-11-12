// Asistente de barbería: enrutamiento de tools por dominio, pedir_herramientas, caché y registro de uso.
// Ejecutar: node --test tests/assistant-routing.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes, scriptedAnthropic, toolUse, text } = require('./helpers/fakeSupabase');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';
const BIZ = '11111111-1111-4111-8111-111111111111';
const fake = createFakeSupabase({
  businesses: [{ id: BIZ, name: 'Barbería', business_type: 'barberia', plan: 'pro', ai_messages_today: 0, ai_messages_date: null, plan_expires_at: new Date(Date.now() + 9e8).toISOString() }],
  business_hours: [], appointments: [], income: [], monthly_goals: [], clients: [], products: [], services: [], employees: [], ai_usage: [], expenses: [], notifications: [],
});
installFakes(fake);
const assistant = require('../src/services/assistant.service');
const { TOOL_DOMAINS, CORE_TOOLS } = require('../src/services/assistant/prompt');

// El cliente de Anthropic del asistente es interno: se reemplaza su messages.create
function useScript(responses) {
  const ai = scriptedAnthropic(responses);
  assistant.__setAnthropicClientForTests(ai);
  return ai;
}

test('todas las 78 tools pertenecen a algún dominio (no se pierde ninguna capacidad)', () => {
  const covered = new Set([...CORE_TOOLS, ...Object.values(TOOL_DOMAINS).flat()]);
  assert.equal(assistant.tools.length, 78);
  assert.deepEqual(assistant.tools.filter((t) => !covered.has(t.name)).map((t) => t.name), []);
});

test('un mensaje de caja manda ~15 tools (antes 78) y el prompt solo con su sección', () => {
  const r = assistant.buildAssistantRequest({ userMessage: 'registra un gasto de 50 mil en arriendo' });
  assert.deepEqual(r.domains, ['caja']);
  assert.ok(r.tools.length <= 18, `tools: ${r.tools.length}`);
  assert.ok(r.tools.some((t) => t.name === 'registrar_egreso'));
  assert.ok(r.tools.some((t) => t.name === 'pedir_herramientas'));
  assert.match(r.system[0].text, /<caja>/);
  assert.doesNotMatch(r.system[0].text, /<productos>/);
});

test('"sí" sin tema hereda el dominio del mensaje anterior del dueño', () => {
  const r = assistant.buildAssistantRequest({ userMessage: 'sí', history: [{ role: 'user', content: 'llegaron 20 ceras' }, { role: 'assistant', content: '¿Cuál cera?' }] });
  assert.deepEqual(r.domains, ['productos']);
});

test('mismo conjunto de dominios → mismas tools y mismo prompt (prefijo cacheable)', () => {
  const a = assistant.buildAssistantRequest({ userMessage: 'cancela la cita de Juan' });
  const b = assistant.buildAssistantRequest({ userMessage: 'agéndale una cita a Ana mañana' });
  assert.deepEqual(a.tools, b.tools);
  assert.equal(a.system[0].text, b.system[0].text);
});

test('pedir_herramientas: en la siguiente vuelta del loop llegan las tools pedidas', async () => {
  const ai = useScript([
    toolUse('pedir_herramientas', { dominios: ['productos'] }),
    text('Listo, ¿qué producto?'),
  ]);
  const r = await assistant.processMessage(BIZ, 'hazme un favor rápido', []);
  assert.equal(r.response, 'Listo, ¿qué producto?');
  assert.ok(!ai.requests[0].tools.some((t) => t.name === 'ajustar_stock'));
  assert.ok(ai.requests[1].tools.some((t) => t.name === 'ajustar_stock'));
});

test('caché: ≤ 4 breakpoints, contexto del negocio al final del mensaje y uso registrado sin texto', async () => {
  fake.db.ai_usage.length = 0;
  const ai = useScript([text('¡Hola! ¿En qué te ayudo?')]);
  await assistant.processMessage(BIZ, 'hola', [{ role: 'user', content: 'antes' }, { role: 'assistant', content: 'ok' }]);
  const req = ai.requests[0];
  assert.ok(JSON.stringify(req).split('"cache_control"').length - 1 <= 4);
  assert.ok(req.system[0].cache_control);
  const user = req.messages.at(-1);
  assert.ok(user.content[0].cache_control);
  assert.match(user.content[1].text, /<contexto_negocio>/);
  assert.doesNotMatch(req.system[0].text, /FECHA Y HORA ACTUAL/);
  await new Promise((r) => setImmediate(r));
  assert.equal(fake.db.ai_usage.length, 1);
  assert.equal(fake.db.ai_usage[0].flow, 'assistant');
  assert.ok(!JSON.stringify(fake.db.ai_usage[0]).includes('hola'));
});
