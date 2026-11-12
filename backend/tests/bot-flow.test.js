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

module.exports = { fake, env, chatbot, reset, msg, BIZ, PNID, PHONE, EN_3H, EN_2D, seed };
