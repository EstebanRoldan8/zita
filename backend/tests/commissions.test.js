// Comisiones por empleado: 0 % se respeta (antes "|| 10" lo convertía en 10 %). Ejecutar: node --test tests/commissions.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { commissionPercent, computeEmployeeCommissions } = require('../src/utils/commissions');

test('commissionPercent: 0 es 0, no 10', () => {
  assert.equal(commissionPercent({ commission_percent: 0 }), 0);
  assert.equal(commissionPercent({ commission_percent: '0' }), 0);
  assert.equal(commissionPercent({ commission_percent: '0.00' }), 0);
});

test('commissionPercent: valores normales y decimales de Postgres (NUMERIC llega como texto)', () => {
  assert.equal(commissionPercent({ commission_percent: 15 }), 15);
  assert.equal(commissionPercent({ commission_percent: '12.50' }), 12.5);
});

test('commissionPercent: nulo, vacío, negativo o basura → 0', () => {
  for (const v of [null, undefined, '', -5, 'abc', NaN]) assert.equal(commissionPercent({ commission_percent: v }), 0, String(v));
  assert.equal(commissionPercent(null), 0);
  assert.equal(commissionPercent(undefined), 0);
});

test('computeEmployeeCommissions: período y hoy por empleado; 0 % da comisión 0', () => {
  const employees = [
    { id: 'a', name: 'Ana', commission_percent: 10 },
    { id: 'b', name: 'Beto', commission_percent: 0 },
  ];
  const period = [
    { employee_id: 'a', price: 20000 }, { employee_id: 'a', price: '30000' },
    { employee_id: 'b', price: 50000 }, { employee_id: 'x', price: 99999 }, { employee_id: null, price: 1 },
  ];
  const today = [{ employee_id: 'a', price: 20000 }, { employee_id: 'b', price: 50000 }];
  const m = computeEmployeeCommissions(employees, period, today);
  assert.deepEqual(m.a, { id: 'a', name: 'Ana', commission_percent: 10, count: 2, income: 50000, commission_period: 5000, commission_today: 2000 });
  assert.deepEqual(m.b, { id: 'b', name: 'Beto', commission_percent: 0, count: 1, income: 50000, commission_period: 0, commission_today: 0 });
  assert.equal(m.x, undefined, 'citas de empleados fuera de la lista no aparecen');
});

test('computeEmployeeCommissions: listas vacías o nulas', () => {
  assert.deepEqual(computeEmployeeCommissions(null, null, null), {});
  const m = computeEmployeeCommissions([{ id: 'a', name: 'Ana', commission_percent: 10 }], [], undefined);
  assert.equal(m.a.commission_period, 0);
});
