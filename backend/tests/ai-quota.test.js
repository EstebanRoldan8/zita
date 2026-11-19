// Límite diario de mensajes del asistente IA (businesses.ai_messages_today).
// Caracterización + concurrencia: dos mensajes simultáneos no pueden pasarse del límite del plan.
// Ejecutar: node --test tests/ai-quota.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes, scriptedAnthropic, text } = require('./helpers/fakeSupabase');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';
const BIZ = '11111111-1111-4111-8111-111111111111';
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

const fake = createFakeSupabase({});
installFakes(fake);

// La función de la migración 067 en el doble: un UPDATE condicional atómico (JS no intercala dentro de esta función)
let rpcAvailable = true;
const baseRpc = fake.rpc;
fake.rpc = async (name, params) => {
  if (name !== 'consume_ai_message') return baseRpc(name, params);
  if (!rpcAvailable) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.consume_ai_message' } };
  const b = fake.db.businesses.find((x) => x.id === params.p_business_id);
  if (!b) return { data: null, error: null };
  const sameDay = b.ai_messages_date === params.p_date;
  const current = sameDay ? (b.ai_messages_today || 0) : 0;
  if (current >= params.p_limit) return { data: null, error: null };
  b.ai_messages_today = current + 1;
  b.ai_messages_date = params.p_date;
  return { data: b.ai_messages_today, error: null };
};

const assistant = require('../src/services/assistant.service');

function seed({ count, date = hoy(), plan = 'estandar' }) {
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  Object.assign(fake.db, {
    businesses: [{ id: BIZ, name: 'Barbería', business_type: 'barberia', plan, ai_messages_today: count, ai_messages_date: date, plan_expires_at: new Date(Date.now() + 9e8).toISOString() }],
    business_hours: [], appointments: [], income: [], monthly_goals: [], clients: [], products: [], services: [], employees: [], ai_usage: [], expenses: [], notifications: [],
  });
}
function script(n) {
  const ai = scriptedAnthropic(Array.from({ length: n }, () => text('ok')));
  assistant.__setAnthropicClientForTests(ai);
  return ai;
}
const biz = () => fake.db.businesses[0];

test('en el límite (20 de 20 en Estándar): bloquea sin llamar a Claude', async () => {
  seed({ count: 20 });
  const ai = script(1);
  const r = await assistant.processMessage(BIZ, 'hola', []);
  assert.equal(r.code, 'AI_LIMIT_REACHED');
  assert.equal(ai.requests.length, 0);
  assert.equal(biz().ai_messages_today, 20);
});

test('debajo del límite: responde y suma 1', async () => {
  seed({ count: 5 });
  script(1);
  const r = await assistant.processMessage(BIZ, 'hola', []);
  assert.equal(r.response.startsWith('ok'), true);
  assert.equal(biz().ai_messages_today, 6);
  assert.equal(biz().ai_messages_date, hoy());
});

test('día nuevo: el contador vuelve a empezar (20 de ayer → 1 hoy)', async () => {
  seed({ count: 20, date: '2020-01-01' });
  script(1);
  const r = await assistant.processMessage(BIZ, 'hola', []);
  assert.equal(r.code, undefined);
  assert.equal(biz().ai_messages_today, 1);
  assert.equal(biz().ai_messages_date, hoy());
});

test('plan Pro sin límite (-1 no aplica) y aviso de mensajes restantes', async () => {
  seed({ count: 16 });
  script(1);
  const r = await assistant.processMessage(BIZ, 'hola', []);
  assert.match(r.response, /3 mensajes disponibles hoy/);
});

test('CONCURRENCIA: con 19 de 20, tres mensajes simultáneos → solo uno pasa y el contador queda en 20', async () => {
  seed({ count: 19 });
  const ai = script(3);
  const results = await Promise.all([1, 2, 3].map(() => assistant.processMessage(BIZ, 'hola', [])));
  const passed = results.filter((r) => r.code !== 'AI_LIMIT_REACHED');
  assert.equal(passed.length, 1, `pasaron ${passed.length}`);
  assert.equal(ai.requests.length, 1, 'una sola llamada a Claude');
  assert.equal(biz().ai_messages_today, 20);
});

test('sin la migración 067 (función inexistente): respaldo al leer-y-escribir anterior, sin romper', async () => {
  rpcAvailable = false;
  try {
    seed({ count: 5 });
    script(1);
    const r = await assistant.processMessage(BIZ, 'hola', []);
    assert.equal(r.response.startsWith('ok'), true);
    assert.equal(biz().ai_messages_today, 6);
    seed({ count: 20 });
    assert.equal((await assistant.processMessage(BIZ, 'hola', [])).code, 'AI_LIMIT_REACHED');
  } finally {
    rpcAvailable = true;
  }
});
