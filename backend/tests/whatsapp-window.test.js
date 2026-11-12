// Ventana de 24 h de WhatsApp: texto libre dentro de la ventana, plantilla aprobada fuera de ella.
// Ejecutar: node --test tests/whatsapp-window.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');

process.env.ENCRYPT_SECRET = process.env.ENCRYPT_SECRET || 'secreto-de-prueba';
const BIZ = 'biz-1';
const PHONE = '573001112233';
const { encrypt } = require('../src/utils/encrypt');
const fake = createFakeSupabase({
  businesses: [{ id: BIZ, name: 'Barbería Test' }],
  clients: [{ id: 'cli-1', business_id: BIZ, phone: PHONE, name: 'Juan Pérez' }],
  services: [{ id: 'srv-1', business_id: BIZ, name: 'Corte', duration_minutes: 30 }],
  appointments: [], whatsapp_conversations: [], system_alerts: [],
});
const env = installFakes(fake);
const { notify, insideWindow } = require('../src/services/whatsappNotify');
const { sendAppointmentReminders } = require('../src/services/scheduler.service');

const TPL = { key: 'recordatorio_cita', body: ['Juan', 'Barbería Test', '03:00 p. m.', 'Corte'], buttons: ['CONFIRMAR_CITA', 'CANCELAR_CITA'] };

test('insideWindow: 2 h → sí; 23 h 55 min → no (margen); nunca escribió → no', () => {
  assert.equal(insideWindow(new Date(Date.now() - 2 * 3600000)), true);
  assert.equal(insideWindow(new Date(Date.now() - (24 * 60 - 5) * 60000)), false);
  assert.equal(insideWindow(null), false);
});

test('fuera de ventana con plantillas activas → plantilla con parámetros y botones', async () => {
  env.sent.length = 0;
  process.env.WA_TEMPLATES_ENABLED = 'true';
  const r = await notify({ to: PHONE, text: 'texto libre', template: TPL, lastInbound: new Date(Date.now() - 3 * 86400000) });
  assert.equal(r.via, 'template');
  assert.equal(env.sent[0].type, 'template');
  assert.equal(env.sent[0].name, 'recordatorio_cita');
  assert.deepEqual(env.sent[0].components.buttons, ['CONFIRMAR_CITA', 'CANCELAR_CITA']);
});

test('dentro de la ventana → texto libre aunque haya plantilla', async () => {
  env.sent.length = 0;
  process.env.WA_TEMPLATES_ENABLED = 'true';
  const r = await notify({ to: PHONE, text: 'texto libre', template: TPL, lastInbound: new Date(Date.now() - 3600000) });
  assert.equal(r.via, 'text');
  assert.equal(env.sent[0].text, 'texto libre');
});

test('fuera de ventana con plantillas apagadas → texto libre (comportamiento anterior) y aviso en el log', async () => {
  env.sent.length = 0;
  process.env.WA_TEMPLATES_ENABLED = 'false';
  const r = await notify({ to: PHONE, text: 'texto libre', template: TPL, lastInbound: null });
  assert.equal(r.via, 'text');
  assert.ok(env.logs.some((l) => String(l[1]).includes('WA_FUERA_DE_VENTANA_SIN_PLANTILLA')));
});

test('recordatorio a un cliente que no escribe hace días → sale como plantilla y queda en el historial', async () => {
  env.sent.length = 0;
  process.env.WA_TEMPLATES_ENABLED = 'true';
  fake.db.businesses[0].whatsapp_phone_number_id = 'pnid-1';
  fake.db.businesses[0].whatsapp_access_token = encrypt('tok');
  fake.db.whatsapp_conversations.push({ id: 'c1', business_id: BIZ, client_phone: PHONE, messages: [{ role: 'user', content: 'hola', timestamp: new Date(Date.now() - 5 * 86400000).toISOString() }] });
  fake.db.appointments.push({ id: 'ffffffff-0000-4000-8000-000000000001', business_id: BIZ, client_id: 'cli-1', service_id: 'srv-1', status: 'confirmed', scheduled_at: new Date(Date.now() + 118 * 60000).toISOString(), reminder_sent_at: null });
  const r = await sendAppointmentReminders();
  assert.equal(r.sent, 1);
  assert.equal(env.sent[0].type, 'template');
  assert.deepEqual(env.sent[0].components.body, ['Juan Pérez', 'Barbería Test', env.sent[0].components.body[2], 'Corte']);
  assert.equal(fake.db.whatsapp_conversations[0].messages.at(-1).kind, 'reminder');
});
