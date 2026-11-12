// Disponibilidad: el solape debe considerar la duración de la cita NUEVA, no solo su hora de inicio.
// Ejecutar: node --test tests/bot-availability.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');

const BIZ = 'biz-1';
const FECHA = '2030-03-12'; // martes, futuro
const fake = createFakeSupabase({
  business_hours: [{ business_id: BIZ, day_of_week: 2, open_time: '09:00:00', close_time: '18:00:00', is_open: true }],
  business_closed_days: [],
  employees: [{ id: 'emp-carlos', business_id: BIZ, name: 'Carlos', is_active: true }],
  services: [{ id: 'srv-30', business_id: BIZ, name: 'Corte', duration_minutes: 30 }, { id: 'srv-60', business_id: BIZ, name: 'Tinte', duration_minutes: 60 }],
  appointments: [
    // Carlos tiene una cita de 30 min a las 10:30 (hora Colombia) = 15:30 UTC
    { id: 'cita-1030', business_id: BIZ, employee_id: 'emp-carlos', service_id: 'srv-30', status: 'confirmed', scheduled_at: '2030-03-12T15:30:00+00:00' },
  ],
});
installFakes(fake);
const av = require('../src/utils/availability');

test('servicio de 60 min a las 10:00 choca con la cita de las 10:30 (antes se aceptaba)', async () => {
  const emp = await av.getAvailableEmployee(BIZ, FECHA, '10:00', 60);
  assert.equal(emp, null);
});

test('servicio de 30 min a las 10:00 sí cabe (termina justo cuando empieza la otra)', async () => {
  const emp = await av.getAvailableEmployee(BIZ, FECHA, '10:00', 30);
  assert.equal(emp?.id, 'emp-carlos');
});

test('una cita que empieza antes y sigue en curso también bloquea', async () => {
  const emp = await av.getAvailableEmployee(BIZ, FECHA, '10:45', 30);
  assert.equal(emp, null);
});

test('los slots libres para 60 min excluyen 10:00 y 10:30, e incluyen 11:00', async () => {
  const day = await av.loadDay(BIZ, FECHA);
  const slots = av.freeSlots(day, 60, { nowMs: 0 });
  assert.ok(!slots.includes('10:00'));
  assert.ok(!slots.includes('10:30'));
  assert.ok(slots.includes('11:00'));
  assert.ok(!slots.includes('17:30'), 'una cita de 60 min a las 17:30 terminaría después del cierre');
});

test('localParts convierte un timestamptz UTC a la hora de Colombia', () => {
  assert.deepEqual(av.localParts('2030-03-12T15:00:00+00:00'), { fecha: '2030-03-12', hora: '10:00' });
  assert.deepEqual(av.localParts('2030-03-13T02:30:00+00:00'), { fecha: '2030-03-12', hora: '21:30' });
});

test('excluir la propia cita al reagendar (mover 10:30 → 10:45 no choca consigo misma)', async () => {
  const emp = await av.getAvailableEmployee(BIZ, FECHA, '10:45', 30, { excludeAppointmentId: 'cita-1030' });
  assert.equal(emp?.id, 'emp-carlos');
});
