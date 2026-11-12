// Asistente del panel: crear_cita / actualizar_cita validan tenant, horario y solape.
// Ejecutar: node --test tests/assistant-appointments.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';
const BIZ = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';
const SRV = 'a0000000-0000-4000-8000-000000000001';
const SRV_LARGO = 'a0000000-0000-4000-8000-000000000002';
const SRV_AJENO = 'a0000000-0000-4000-8000-000000000099';
const CLI = 'b0000000-0000-4000-8000-000000000001';
const CLI_AJENO = 'b0000000-0000-4000-8000-000000000099';
const EMP = 'c0000000-0000-4000-8000-000000000001';
const EMP_AJENO = 'c0000000-0000-4000-8000-000000000099';
const CITA = 'd0000000-0000-4000-8000-000000000001';

function seed() {
  return {
    businesses: [{ id: BIZ, name: 'Barbería', plan: 'pro' }, { id: OTRO, name: 'Otro', plan: 'pro' }],
    business_hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ business_id: BIZ, day_of_week: d, open_time: '08:00', close_time: '20:00', is_open: true })),
    business_closed_days: [],
    services: [
      { id: SRV, business_id: BIZ, name: 'Corte', price: 25000, duration_minutes: 30, active: true },
      { id: SRV_LARGO, business_id: BIZ, name: 'Tinte', price: 45000, duration_minutes: 60, active: true },
      { id: SRV_AJENO, business_id: OTRO, name: 'Ajeno', price: 1, duration_minutes: 30, active: true },
    ],
    clients: [{ id: CLI, business_id: BIZ, name: 'Juan' }, { id: CLI_AJENO, business_id: OTRO, name: 'De otro negocio' }],
    employees: [{ id: EMP, business_id: BIZ, name: 'Carlos', is_active: true }, { id: EMP_AJENO, business_id: OTRO, name: 'Ajeno', is_active: true }],
    appointments: [
      // Cita existente con Carlos a las 10:30 hora Colombia del 2030-03-12
      { id: CITA, business_id: BIZ, client_id: CLI, employee_id: EMP, service_id: SRV, status: 'confirmed', price: 25000, scheduled_at: '2030-03-12T15:30:00+00:00', created_at: '2030-01-01T00:00:00Z' },
    ],
    income: [],
  };
}
const fake = createFakeSupabase(seed());
installFakes(fake);
const { executeTool } = require('../src/services/assistant.service');
function reset() { const f = seed(); for (const k of Object.keys(fake.db)) delete fake.db[k]; Object.assign(fake.db, f); }

test('crear_cita con un service_id de OTRO negocio: no crea nada', async () => {
  reset();
  const r = await executeTool('crear_cita', { service_id: SRV_AJENO, scheduled_at: '2030-03-12T12:00:00-05:00' }, BIZ);
  assert.equal(r.success, false);
  assert.equal(fake.db.appointments.length, 1);
});

test('crear_cita con un client_id de OTRO negocio: no crea nada', async () => {
  reset();
  const r = await executeTool('crear_cita', { service_id: SRV, client_id: CLI_AJENO, scheduled_at: '2030-03-12T12:00:00-05:00' }, BIZ);
  assert.equal(r.success, false);
  assert.equal(fake.db.appointments.length, 1);
});

test('crear_cita de 60 min a las 10:00 con el único empleado ocupado a las 10:30: no la crea (ni sin empleado)', async () => {
  reset();
  const r = await executeTool('crear_cita', { service_id: SRV_LARGO, scheduled_at: '2030-03-12T10:00:00-05:00' }, BIZ);
  assert.equal(r.success, false, JSON.stringify(r));
  assert.equal(fake.db.appointments.length, 1);
});

test('crear_cita con un empleado explícito que está ocupado: no la crea', async () => {
  reset();
  const r = await executeTool('crear_cita', { service_id: SRV, employee_id: EMP, scheduled_at: '2030-03-12T10:45:00-05:00' }, BIZ);
  assert.equal(r.success, false);
});

test('crear_cita "15:00Z" se guarda como 3:00 p. m. hora Colombia (hora de pared que el modelo etiquetó mal)', async () => {
  reset();
  const r = await executeTool('crear_cita', { service_id: SRV, scheduled_at: '2030-03-12T15:00:00Z' }, BIZ);
  assert.equal(r.success, true, JSON.stringify(r));
  const cita = fake.db.appointments.at(-1);
  assert.equal(new Date(cita.scheduled_at).getTime(), new Date('2030-03-12T15:00:00-05:00').getTime());
});

test('crear_cita dos veces seguidas sin cliente: la protección de duplicados funciona con client_id NULL', async () => {
  reset();
  const a = await executeTool('crear_cita', { service_id: SRV, scheduled_at: '2030-03-12T12:00:00-05:00' }, BIZ);
  const b = await executeTool('crear_cita', { service_id: SRV, scheduled_at: '2030-03-12T12:00:00-05:00' }, BIZ);
  assert.equal(a.success, true);
  assert.match(b.message || '', /no se duplicó/);
  assert.equal(fake.db.appointments.length, 2);
});

test('actualizar_cita con un employee_id de OTRO negocio: no la toca', async () => {
  reset();
  const r = await executeTool('actualizar_cita', { appointment_id: CITA, employee_id: EMP_AJENO }, BIZ);
  assert.equal(r.success, false);
  assert.equal(fake.db.appointments[0].employee_id, EMP);
});

test('actualizar_cita con un service_id de OTRO negocio: no la toca', async () => {
  reset();
  const r = await executeTool('actualizar_cita', { appointment_id: CITA, service_id: SRV_AJENO }, BIZ);
  assert.equal(r.success, false);
  assert.equal(fake.db.appointments[0].service_id, SRV);
});

test('actualizar_cita a un servicio de 60 min que se sale del horario: rechaza', async () => {
  reset();
  fake.db.appointments[0].scheduled_at = '2030-03-13T00:30:00+00:00'; // 19:30 local, cierre 20:00
  const r = await executeTool('actualizar_cita', { appointment_id: CITA, service_id: SRV_LARGO }, BIZ);
  assert.equal(r.success, false);
});

test('actualizar_cita cambiando el servicio también actualiza el precio de la cita', async () => {
  reset();
  const r = await executeTool('actualizar_cita', { appointment_id: CITA, service_id: SRV_LARGO }, BIZ);
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(fake.db.appointments[0].price, 45000);
});
