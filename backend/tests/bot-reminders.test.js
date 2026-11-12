// Recordatorios de cita: se envían una sola vez, quedan en el historial y el "sí"/"no" del cliente actúa sobre esa cita.
// Ejecutar: node --test tests/bot-reminders.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes, scriptedAnthropic } = require('./helpers/fakeSupabase');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';
process.env.ENCRYPT_SECRET = process.env.ENCRYPT_SECRET || 'secreto-de-prueba';
const BIZ = 'biz-1';
const PNID = 'pnid-1';
const PHONE = '573001112233';
const { encrypt } = require('../src/utils/encrypt');

function seed() {
  const enDosHoras = new Date(Date.now() + 118 * 60000).toISOString();
  return {
    businesses: [{ id: BIZ, name: 'Barbería Test', plan: 'pro', status: 'active', whatsapp_phone_number_id: PNID, whatsapp_access_token: encrypt('token-negocio'), plan_expires_at: new Date(Date.now() + 9e8).toISOString() }],
    clients: [{ id: 'cli-juan', business_id: BIZ, phone: PHONE, name: 'Juan Pérez' }],
    services: [{ id: 'srv-corte', business_id: BIZ, name: 'Corte', price: 25000, duration_minutes: 30, active: true }],
    employees: [{ id: 'emp-1', business_id: BIZ, name: 'Carlos', is_active: true }],
    appointments: [
      { id: 'dddddddd-0000-4000-8000-000000000001', business_id: BIZ, client_id: 'cli-juan', service_id: 'srv-corte', employee_id: 'emp-1', status: 'confirmed', scheduled_at: enDosHoras, reminder_sent_at: null },
      // otra cita de Juan más adelante: el "no" NO debe cancelar esta
      { id: 'dddddddd-0000-4000-8000-000000000002', business_id: BIZ, client_id: 'cli-juan', service_id: 'srv-corte', employee_id: 'emp-1', status: 'confirmed', scheduled_at: new Date(Date.now() + 3 * 86400000).toISOString(), reminder_sent_at: null },
    ],
    whatsapp_conversations: [], income: [], bot_daily_message_counts: [], system_alerts: [], business_hours: [], business_closed_days: [],
  };
}
const fake = createFakeSupabase(seed());
const env = installFakes(fake);
const { sendAppointmentReminders } = require('../src/services/scheduler.service');
const chatbot = require('../src/services/chatbot.service');

test('el recordatorio se envía una sola vez, pide SÍ/NO y queda en el historial con su cita', async () => {
  const r1 = await sendAppointmentReminders();
  const r2 = await sendAppointmentReminders(); // segunda corrida del cron: no repite
  assert.equal(r1.sent, 1);
  assert.equal(r2.sent, 0);
  assert.equal(env.sent.length, 1);
  assert.match(env.sent[0].text, /SÍ.*NO/s);
  assert.equal(env.sent[0].token, 'token-negocio');
  const conv = fake.db.whatsapp_conversations[0];
  assert.equal(conv.messages.at(-1).kind, 'reminder');
  assert.equal(conv.messages.at(-1).appointment_id, 'dddddddd-0000-4000-8000-000000000001');
  assert.ok(env.logs.every((l) => !JSON.stringify(l).includes(PHONE)), 'el teléfono completo no aparece en los logs');
});

test('el cliente responde "No" al recordatorio: se cancela esa cita y no la otra', async () => {
  env.sent.length = 0;
  const ai = scriptedAnthropic([]);
  chatbot.__setAnthropicClientForTests(ai);
  await chatbot.processWhatsAppMessage({ from: PHONE, phoneNumberId: PNID, messageText: 'No', messageId: 'wamid.r1' });
  assert.equal(fake.db.appointments[0].status, 'cancelled');
  assert.equal(fake.db.appointments[1].status, 'confirmed');
  assert.equal(ai.requests.length, 0);
  assert.match(env.sent[0].text, /cancelé/);
});
