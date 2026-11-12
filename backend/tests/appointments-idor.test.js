// Citas del dueño: no se puede referenciar ni tocar datos de otro negocio. Ejecutar: node --test tests/appointments-idor.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');
const { call } = require('./helpers/http');

const fake = createFakeSupabase({});
installFakes(fake);
const appointments = require('../src/controllers/appointments.controller');

const BIZ = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const ids = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const CLIENT = ids(2); const CLIENT_OTHER = ids(3); const SERVICE = ids(4); const SERVICE_OTHER = ids(5);
const EMP = ids(6); const EMP_OTHER = ids(7); const APPT_OTHER = ids(8);

function seed() {
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  Object.assign(fake.db, {
    businesses: [{ id: BIZ, plan: 'pro', country: 'colombia' }, { id: OTHER, plan: 'pro', country: 'colombia' }],
    clients: [{ id: CLIENT, business_id: BIZ, name: 'Ana' }, { id: CLIENT_OTHER, business_id: OTHER, name: 'Ajeno' }],
    services: [{ id: SERVICE, business_id: BIZ, name: 'Corte', price: 20000, duration_minutes: 30 }, { id: SERVICE_OTHER, business_id: OTHER, name: 'Ajeno', price: 1, duration_minutes: 30 }],
    employees: [{ id: EMP, business_id: BIZ, name: 'Juan', is_active: true }, { id: EMP_OTHER, business_id: OTHER, name: 'Otro', is_active: true }],
    appointments: [{ id: APPT_OTHER, business_id: OTHER, status: 'confirmed', scheduled_at: '2026-11-12T15:00:00-05:00', employee_id: EMP_OTHER }],
  });
}
const owner = (over) => ({ businessId: BIZ, ...over });
const base = { service_id: SERVICE, scheduled_at: '2026-11-20T10:00:00-05:00', employee_id: EMP };

test('crear con cliente de otro negocio → 400 y no inserta', async () => {
  seed();
  const r = await call(appointments.create, owner({ body: { ...base, client_id: CLIENT_OTHER } }));
  assert.equal(r.status, 400);
  assert.equal(fake.db.appointments.length, 1);
});

test('crear con servicio de otro negocio aunque venga precio → 400', async () => {
  seed();
  const r = await call(appointments.create, owner({ body: { ...base, service_id: SERVICE_OTHER, price: 1000, client_id: CLIENT } }));
  assert.equal(r.status, 400);
  assert.equal(fake.db.appointments.length, 1);
});

test('crear con cliente y servicio propios sigue funcionando', async () => {
  seed();
  const r = await call(appointments.create, owner({ body: { ...base, client_id: CLIENT } }));
  assert.equal(r.status, 201);
  assert.equal(r.body.data.price, 20000);
  assert.equal(r.body.data.business_id, BIZ);
});

test('reprogramar (PUT) una cita ajena → 404 y no la toca', async () => {
  seed();
  const r = await call(appointments.updateAppointment, owner({ params: { id: APPT_OTHER }, body: { employee_id: EMP } }));
  assert.equal(r.status, 404);
  assert.equal(fake.db.appointments[0].employee_id, EMP_OTHER);
});

test('reprogramar con empleado o servicio de otro negocio → 400', async () => {
  seed();
  fake.db.appointments.push({ id: ids(9), business_id: BIZ, status: 'confirmed', scheduled_at: '2026-11-12T15:00:00-05:00', employee_id: EMP, service_id: SERVICE });
  assert.equal((await call(appointments.updateAppointment, owner({ params: { id: ids(9) }, body: { employee_id: EMP_OTHER } }))).status, 400);
  assert.equal((await call(appointments.updateAppointment, owner({ params: { id: ids(9) }, body: { service_id: SERVICE_OTHER } }))).status, 400);
  assert.equal(fake.db.appointments[1].employee_id, EMP);
});

test('cancelar (DELETE) o cambiar estado de una cita ajena → 404', async () => {
  seed();
  assert.equal((await call(appointments.remove, owner({ params: { id: APPT_OTHER } }))).status, 404);
  assert.equal((await call(appointments.update, owner({ params: { id: APPT_OTHER }, body: { status: 'cancelled' } }))).status, 404);
  assert.equal(fake.db.appointments[0].status, 'confirmed');
});
