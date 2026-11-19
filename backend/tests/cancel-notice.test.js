// Aviso de cancelación al cliente: sale del número del negocio dueño de la cita (token AES descifrado),
// por la MISMA función desde el panel del dueño, el panel del barbero y el asistente IA.
// Ejecutar: node --test tests/cancel-notice.test.js
process.env.ENCRYPT_SECRET = process.env.ENCRYPT_SECRET || 'test-secret';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');
const { call } = require('./helpers/http');

const fake = createFakeSupabase({});
const { sent, logs } = installFakes(fake);
const { encrypt } = require('../src/utils/encrypt');
const appointments = require('../src/controllers/appointments.controller');
const me = require('../src/controllers/me.controller');
const { executeTool } = require('../src/services/assistant.service');
const { notifyClientOfCancellation } = require('../src/services/cancellationNotice');

const BIZ = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const SERVICE = '33333333-3333-4333-8333-333333333333';
const EMP = '44444444-4444-4444-8444-444444444444';
const APPT = '55555555-5555-4555-8555-555555555555';
const PHONE = '573001112233';
const TOKEN = 'EAAG-token-del-negocio';

function seed({ pnid = 'pnid-negocio', token = TOKEN, source = 'whatsapp' } = {}) {
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  sent.length = 0; logs.length = 0;
  Object.assign(fake.db, {
    businesses: [{
      id: BIZ, user_id: 'owner-1', name: 'Barbería Test', country: 'colombia', plan: 'pro',
      whatsapp_phone_number_id: pnid, whatsapp_access_token: token ? encrypt(token) : null,
    }],
    clients: [{ id: CLIENT, business_id: BIZ, name: 'Carlos', phone: PHONE }],
    services: [{ id: SERVICE, business_id: BIZ, name: 'Corte clásico', price: 30000, duration_minutes: 30 }],
    employees: [{ id: EMP, business_id: BIZ, name: 'Juan', is_active: true }],
    appointments: [{
      id: APPT, business_id: BIZ, client_id: CLIENT, service_id: SERVICE, employee_id: EMP,
      scheduled_at: '2030-11-12T15:00:00-05:00', status: 'confirmed', price: 30000, source,
    }],
    income: [],
  });
}

function assertSentFromBusiness() {
  assert.equal(sent.length, 1, 'un aviso');
  assert.equal(sent[0].type, 'text');
  assert.equal(sent[0].to, PHONE);
  assert.equal(sent[0].token, TOKEN, 'token del negocio descifrado');
  assert.equal(sent[0].pnid, 'pnid-negocio', 'número del negocio');
  assert.match(sent[0].text, /Corte clásico/);
  assert.match(sent[0].text, /cancelada/);
}

function assertNoSecretsInLogs() {
  const all = JSON.stringify(logs);
  assert.equal(all.includes(PHONE), false, 'sin teléfono completo');
  assert.equal(all.includes(TOKEN), false, 'sin token');
}

test('dueño (PATCH estado → cancelled): sale del número del negocio', async () => {
  seed();
  const r = await call(appointments.update, { businessId: BIZ, params: { id: APPT }, body: { status: 'cancelled' } });
  assert.equal(r.status, 200);
  assertSentFromBusiness();
  assert.deepEqual(fake.db.whatsapp_conversations.map((c) => c.messages), [[]], 'se limpia la conversación como antes');
  assertNoSecretsInLogs();
});

test('dueño (DELETE): también avisa por la misma función', async () => {
  seed();
  const r = await call(appointments.remove, { businessId: BIZ, params: { id: APPT } });
  assert.equal(r.status, 200);
  assert.equal(fake.db.appointments[0].status, 'cancelled');
  assertSentFromBusiness();
});

test('barbero (/api/me cancel): sale del número del negocio', async () => {
  seed();
  const r = await call(me.cancelAppointment, { businessId: BIZ, role: 'employee', employeeId: EMP, params: { id: APPT } });
  assert.equal(r.status, 200);
  assertSentFromBusiness();
});

test('asistente IA (cancelar_cita): cancela, borra el ingreso y avisa desde el número del negocio', async () => {
  seed();
  fake.db.income.push({ id: 'inc-1', business_id: BIZ, appointment_id: APPT, amount: 30000 });
  const r = await executeTool('cancelar_cita', { appointment_id: APPT }, BIZ);
  assert.equal(r.success, true);
  assert.equal(fake.db.appointments[0].status, 'cancelled');
  assert.equal(fake.db.income.length, 0);
  assertSentFromBusiness();
  assertNoSecretsInLogs();
});

test('cita que no vino por WhatsApp: no se avisa (igual que antes)', async () => {
  seed({ source: 'manual' });
  await call(appointments.update, { businessId: BIZ, params: { id: APPT }, body: { status: 'cancelled' } });
  assert.equal(sent.length, 0);
});

test('negocio sin número configurado (sin phone_number_id): respaldo al comportamiento anterior (número por defecto)', async () => {
  seed({ pnid: null });
  const r = await notifyClientOfCancellation({ businessId: BIZ, appointmentId: APPT });
  assert.equal(r.sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].token, null, 'token por defecto (variables de entorno)');
  assert.equal(sent[0].pnid, null, 'número por defecto');
  assert.ok(logs.some((l) => String(l[1]).includes('CANCEL_NOTICE_NUMERO_POR_DEFECTO')));
  assertNoSecretsInLogs();
});

test('negocio sin token: no se envía (igual que antes)', async () => {
  seed({ token: null });
  const r = await notifyClientOfCancellation({ businessId: BIZ, appointmentId: APPT });
  assert.deepEqual(r, { sent: false, reason: 'sin_token' });
  assert.equal(sent.length, 0);
});

test('token que no se puede descifrar: no se envía con un token roto', async () => {
  seed();
  fake.db.businesses[0].whatsapp_access_token = 'no-es-aes';
  const r = await notifyClientOfCancellation({ businessId: BIZ, appointmentId: APPT });
  assert.equal(r.sent, false);
  assert.equal(sent.length, 0);
});

test('cita de otro negocio: no se avisa', async () => {
  seed();
  const r = await notifyClientOfCancellation({ businessId: '99999999-9999-4999-8999-999999999999', appointmentId: APPT });
  assert.equal(r.sent, false);
  assert.equal(sent.length, 0);
});
