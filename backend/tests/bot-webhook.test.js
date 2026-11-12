// Webhook de WhatsApp: 200 inmediato (también con el bot pausado), idempotencia por message_id, varios mensajes
// por POST, mensajes viejos sin respuesta y botones de la plantilla de recordatorio.
// Ejecutar: node --test tests/bot-webhook.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes, scriptedAnthropic, text } = require('./helpers/fakeSupabase');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';
const BIZ = 'biz-1';
const PNID = 'pnid-1';
const PHONE = '573001112233';
const PHONE_2 = '573004445566';
const CITA = 'eeeeeeee-0000-4000-8000-000000000001';

function seed() {
  return {
    businesses: [{ id: BIZ, name: 'Barbería Test', plan: 'pro', status: 'active', phone: '573000000000', whatsapp_phone_number_id: PNID, whatsapp_access_token: null, plan_expires_at: new Date(Date.now() + 9e8).toISOString() }],
    clients: [{ id: 'cli-juan', business_id: BIZ, phone: PHONE, name: 'Juan Pérez' }],
    services: [{ id: 'srv-corte', business_id: BIZ, name: 'Corte', price: 25000, duration_minutes: 30, active: true }],
    employees: [], business_hours: [], business_closed_days: [],
    appointments: [{ id: CITA, business_id: BIZ, client_id: 'cli-juan', service_id: 'srv-corte', status: 'confirmed', scheduled_at: new Date(Date.now() + 2 * 3600000).toISOString() }],
    whatsapp_conversations: [], income: [], bot_daily_message_counts: [], system_alerts: [], wa_processed_messages: [],
  };
}
const fake = createFakeSupabase(seed(), { unique: { wa_processed_messages: [['message_id']] } });
const env = installFakes(fake);
const chatbot = require('../src/services/chatbot.service');
const { handleWebhook } = require('../src/controllers/webhook.controller');

function reset() {
  const fresh = seed();
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  Object.assign(fake.db, fresh);
  env.sent.length = 0;
  fake.calls.length = 0;
}
const idle = () => new Promise((r) => setTimeout(r, 60));
function fakeRes() {
  const res = { statusCode: null, callsAtResponse: null };
  res.sendStatus = (c) => { res.statusCode = c; res.callsAtResponse = fake.calls.length; return res; };
  res.status = (c) => { res.statusCode = c; res.callsAtResponse = fake.calls.length; return res; };
  res.json = () => res; res.send = () => res;
  return res;
}
const nowTs = () => String(Math.floor(Date.now() / 1000));
function body(messages, pnid = PNID) {
  return { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: pnid }, messages } }] }] };
}
const textMsg = (id, from, t, ts = nowTs()) => ({ id, from, type: 'text', timestamp: ts, text: { body: t } });

test('bot pausado: responde 200 de inmediato, no contesta y guarda el mensaje en el historial', async () => {
  reset();
  fake.db.whatsapp_conversations.push({ id: 'c1', business_id: BIZ, client_phone: PHONE, messages: [], bot_paused_until: new Date(Date.now() + 3600000).toISOString() });
  chatbot.__setAnthropicClientForTests(scriptedAnthropic([text('no debería responder')]));
  const res = fakeRes();
  await handleWebhook({ body: body([textMsg('wamid.p1', PHONE, 'hola, ¿siguen ahí?')]) }, res);
  await idle();
  assert.equal(res.statusCode, 200);
  assert.equal(res.callsAtResponse, 0, 'el 200 sale antes de cualquier consulta a la BD');
  assert.equal(env.sent.length, 0);
  assert.equal(fake.db.whatsapp_conversations[0].messages.at(-1).content, 'hola, ¿siguen ahí?');
});

test('Meta reenvía el mismo message_id: se procesa una sola vez', async () => {
  reset();
  const ai = scriptedAnthropic([text('¡Hola Juan! ¿Qué servicio buscas?'), text('respuesta duplicada')]);
  chatbot.__setAnthropicClientForTests(ai);
  const m = textMsg('wamid.dup', PHONE, 'quiero agendar');
  await handleWebhook({ body: body([m]) }, fakeRes());
  await idle();
  await handleWebhook({ body: body([m]) }, fakeRes());
  await idle();
  assert.equal(ai.requests.length, 1);
  assert.equal(env.sent.length, 1);
});

test('un POST con mensajes de dos clientes: se procesan los dos', async () => {
  reset();
  chatbot.__setAnthropicClientForTests(scriptedAnthropic([text('r1'), text('r2')]));
  await handleWebhook({ body: body([textMsg('wamid.a', PHONE, 'quiero agendar'), textMsg('wamid.b', PHONE_2, 'qué precios tienen')]) }, fakeRes());
  await idle();
  assert.deepEqual(env.sent.map((s) => s.to).sort(), [PHONE, PHONE_2].sort());
});

test('mensaje viejo (reintento de Meta horas después): no se responde fuera de contexto', async () => {
  reset();
  const ai = scriptedAnthropic([text('no debería responder')]);
  chatbot.__setAnthropicClientForTests(ai);
  const hace3h = String(Math.floor((Date.now() - 3 * 3600000) / 1000));
  await handleWebhook({ body: body([textMsg('wamid.old', PHONE, 'no', hace3h)]) }, fakeRes());
  await idle();
  assert.equal(ai.requests.length, 0);
  assert.equal(env.sent.length, 0);
  assert.equal(fake.db.appointments[0].status, 'confirmed');
});

test('botón "Cancelar" de la plantilla de recordatorio: cancela la cita del recordatorio', async () => {
  reset();
  fake.db.whatsapp_conversations.push({ id: 'c1', business_id: BIZ, client_phone: PHONE, messages: [
    { role: 'assistant', content: 'recordatorio', timestamp: new Date().toISOString(), kind: 'reminder', appointment_id: CITA },
  ] });
  chatbot.__setAnthropicClientForTests(scriptedAnthropic([]));
  await handleWebhook({ body: body([{ id: 'wamid.btn', from: PHONE, type: 'button', timestamp: nowTs(), button: { payload: 'CANCELAR_CITA', text: 'Cancelar' } }]) }, fakeRes());
  await idle();
  assert.equal(fake.db.appointments[0].status, 'cancelled');
});

test('sin la tabla wa_processed_messages (migración pendiente): igual deduplica con el respaldo', async () => {
  reset();
  fake.missingTables.add('wa_processed_messages');
  try {
    const { claimMessageId } = require('../src/services/conversationStore');
    assert.equal(await claimMessageId(BIZ, PHONE, 'wamid.x1'), true);
    assert.equal(await claimMessageId(BIZ, PHONE, 'wamid.x1'), false);
    assert.ok(fake.db.whatsapp_conversations[0].processed_message_ids.includes('wamid.x1'));
  } finally {
    fake.missingTables.delete('wa_processed_messages');
  }
});
