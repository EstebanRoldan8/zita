// Flujo completo del bot (processWhatsAppMessage): límites por plan, atajo de sí/no, deduplicación, pausa.
// Supabase en memoria, WhatsApp y Claude simulados.
// Ejecutar: node --test tests/bot-flow.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes, scriptedAnthropic, toolUse, text } = require('./helpers/fakeSupabase');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';
const BIZ = 'biz-1';
const PNID = 'pnid-1';
const PHONE = '573001112233';
const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const EN_3H = new Date(Date.now() + 3 * 3600000).toISOString();
const EN_2D = new Date(Date.now() + 2 * 86400000).toISOString();

function seed(plan = 'pro') {
  return {
    businesses: [{ id: BIZ, name: 'Barbería Test', plan, status: 'active', phone: '573000000000', whatsapp_phone_number_id: PNID, whatsapp_access_token: null, trial_ends_at: null, plan_expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }],
    business_hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ business_id: BIZ, day_of_week: d, open_time: '08:00:00', close_time: '20:00:00', is_open: true })),
    business_closed_days: [],
    employees: [{ id: 'emp-carlos', business_id: BIZ, name: 'Carlos', is_active: true }],
    services: [{ id: 'srv-corte', business_id: BIZ, name: 'Corte', price: 25000, duration_minutes: 30, active: true }],
    clients: [{ id: 'cli-juan', business_id: BIZ, phone: PHONE, name: 'Juan Pérez' }],
    appointments: [
      { id: 'cccccccc-0000-4000-8000-000000000001', business_id: BIZ, client_id: 'cli-juan', employee_id: 'emp-carlos', service_id: 'srv-corte', status: 'confirmed', price: 25000, scheduled_at: EN_3H },
      { id: 'cccccccc-0000-4000-8000-000000000002', business_id: BIZ, client_id: 'cli-juan', employee_id: 'emp-carlos', service_id: 'srv-corte', status: 'confirmed', price: 25000, scheduled_at: EN_2D },
    ],
    income: [],
    whatsapp_conversations: [],
    bot_daily_message_counts: [],
    system_alerts: [],
    wa_processed_messages: [],
  };
}

const fake = createFakeSupabase(seed(), { unique: { wa_processed_messages: [['message_id']] } });
const env = installFakes(fake);
const chatbot = require('../src/services/chatbot.service');

function reset(plan) {
  const fresh = seed(plan);
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  Object.assign(fake.db, fresh);
  env.sent.length = 0;
}
let n = 0;
const msg = (messageText, extra = {}) => ({ from: PHONE, phoneNumberId: PNID, messageText, messageId: `wamid.${++n}`, ...extra });

test('plan Pro con 45 mensajes del negocio hoy: el bot sigue respondiendo (antes se cortaba en 40 = Lite)', async () => {
  reset('pro');
  fake.db.bot_daily_message_counts.push({ business_id: BIZ, client_phone: '573000000001', date: HOY, message_count: 45 });
  chatbot.__setAnthropicClientForTests(scriptedAnthropic([text('¡Claro! ¿Para cuándo?')]));
  await chatbot.processWhatsAppMessage(msg('quiero un corte'));
  assert.equal(env.sent.length, 1);
  assert.equal(env.sent[0].text, '¡Claro! ¿Para cuándo?');
});

test('plan Lite con 40 mensajes hoy: responde con el aviso de límite', async () => {
  reset('lite');
  fake.db.bot_daily_message_counts.push({ business_id: BIZ, client_phone: '573000000001', date: HOY, message_count: 40 });
  chatbot.__setAnthropicClientForTests(scriptedAnthropic([text('no debería llamarse')]));
  await chatbot.processWhatsAppMessage(msg('quiero un corte'));
  assert.equal(env.sent.length, 1);
  assert.match(env.sent[0].text, /límite de mensajes/);
});

// ── Atajo de sí/no: SOLO cuando el último mensaje del bot fue el recordatorio de una cita ─────────────────
const CITA_HOY = 'cccccccc-0000-4000-8000-000000000001';
const CITA_2D = 'cccccccc-0000-4000-8000-000000000002';
const conv = (messages) => fake.db.whatsapp_conversations.push({ id: 'conv-1', business_id: BIZ, client_phone: PHONE, messages, context: {}, processed_message_ids: [] });
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

test('"no" a una pregunta cualquiera del bot NO cancela ninguna cita (lo atiende Claude con contexto)', async () => {
  reset('pro');
  conv([
    { role: 'user', content: 'quiero un corte para el viernes', timestamp: ago(3) },
    { role: 'assistant', content: '¿Sigues queriendo para el viernes?', timestamp: ago(2) },
  ]);
  const ai = scriptedAnthropic([text('Listo, ¿para qué día entonces?')]);
  chatbot.__setAnthropicClientForTests(ai);
  await chatbot.processWhatsAppMessage(msg('no'));
  assert.ok(fake.db.appointments.every((a) => a.status === 'confirmed'), 'ninguna cita cancelada');
  assert.equal(ai.requests.length, 1, 'el mensaje fue a Claude');
  assert.equal(env.sent[0].text, 'Listo, ¿para qué día entonces?');
});

test('"sí" a una pregunta cualquiera tampoco responde "tu cita está confirmada"', async () => {
  reset('pro');
  conv([{ role: 'assistant', content: '¿La cita de Corte a las 3?', timestamp: ago(1) }]);
  chatbot.__setAnthropicClientForTests(scriptedAnthropic([text('Perfecto, la cancelo entonces?')]));
  await chatbot.processWhatsAppMessage(msg('sí'));
  assert.doesNotMatch(env.sent[0].text, /está confirmada/);
});

test('"no" justo después del recordatorio cancela ESA cita (no la más próxima)', async () => {
  reset('pro');
  conv([{ role: 'assistant', content: '⏰ Recordatorio...', timestamp: ago(5), kind: 'reminder', appointment_id: CITA_2D }]);
  const ai = scriptedAnthropic([]);
  chatbot.__setAnthropicClientForTests(ai);
  await chatbot.processWhatsAppMessage(msg('no'));
  assert.equal(fake.db.appointments.find((a) => a.id === CITA_2D).status, 'cancelled');
  assert.equal(fake.db.appointments.find((a) => a.id === CITA_HOY).status, 'confirmed');
  assert.equal(ai.requests.length, 0, 'sin llamar a Claude');
  assert.match(env.sent[0].text, /cancelé/);
});

test('"sí" después del recordatorio confirma esa cita', async () => {
  reset('pro');
  fake.db.appointments.find((a) => a.id === CITA_HOY).status = 'pending';
  conv([{ role: 'assistant', content: '⏰ Recordatorio...', timestamp: ago(5), kind: 'reminder', appointment_id: CITA_HOY }]);
  chatbot.__setAnthropicClientForTests(scriptedAnthropic([]));
  await chatbot.processWhatsAppMessage(msg('si'));
  assert.equal(fake.db.appointments.find((a) => a.id === CITA_HOY).status, 'confirmed');
  assert.match(env.sent[0].text, /confirmada/);
});

test('recordatorio seguido de otra conversación: el "no" ya no es respuesta al recordatorio', async () => {
  reset('pro');
  conv([
    { role: 'assistant', content: '⏰ Recordatorio...', timestamp: ago(30), kind: 'reminder', appointment_id: CITA_HOY },
    { role: 'user', content: '¿tienen cera?', timestamp: ago(10) },
    { role: 'assistant', content: 'Sí, ¿quieres apartar una?', timestamp: ago(9) },
  ]);
  chatbot.__setAnthropicClientForTests(scriptedAnthropic([text('Listo 👍')]));
  await chatbot.processWhatsAppMessage(msg('no'));
  assert.ok(fake.db.appointments.every((a) => a.status === 'confirmed'));
});

module.exports = { fake, env, chatbot, reset, msg, conv, ago, BIZ, PNID, PHONE, EN_3H, EN_2D, CITA_HOY, CITA_2D, seed };
