// Pedido manual: cliente opcional y descuento en pesos. Ejecutar: node --test tests/orders-manual.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCustomer, parseDiscount, computeTotals } = require('../src/utils/orderTotals');

const items = [{ quantity: 2, unit_price: 50000 }, { quantity: 1, unit_price: 20000 }]; // subtotal 120.000

test('sin nombre ni teléfono: pedido sin cliente', () => {
  assert.deepEqual(parseCustomer({}), { customer: { client_name: null, client_phone: null } });
  assert.deepEqual(parseCustomer({ client_name: '  ', client_phone: '' }), { customer: { client_name: null, client_phone: null } });
});
test('solo nombre: se conserva y el teléfono queda nulo', () => {
  assert.deepEqual(parseCustomer({ client_name: '  Ana   María ' }), { customer: { client_name: 'Ana María', client_phone: null } });
});
test('nombre y teléfono se sanitizan (control y espacios) y se limitan', () => {
  assert.equal(parseCustomer({ client_name: 'Ana\n\t<b>', client_phone: ' 300 123 4567 ' }).customer.client_phone, '300 123 4567');
  assert.ok(parseCustomer({ client_name: 'x'.repeat(121) }).error);
  assert.ok(parseCustomer({ client_phone: '1'.repeat(31) }).error);
  assert.ok(parseCustomer({ client_name: 123 }).error);
});
test('descuento válido: total = subtotal − descuento', () => {
  const sub = computeTotals(items).subtotal;
  assert.equal(sub, 120000);
  const d = parseDiscount(20000, sub);
  assert.deepEqual(d, { discount: 20000 });
  assert.equal(computeTotals(items, { discount: d.discount }).total, 100000);
});
test('descuento ausente o vacío = 0; igual al subtotal = permitido (total 0)', () => {
  assert.deepEqual(parseDiscount(undefined, 120000), { discount: 0 });
  assert.deepEqual(parseDiscount('', 120000), { discount: 0 });
  assert.deepEqual(parseDiscount('120000', 120000), { discount: 120000 });
  assert.equal(computeTotals(items, { discount: 120000 }).total, 0);
});
test('descuento mayor al subtotal → error (400)', () => {
  assert.match(parseDiscount(120001, 120000).error, /mayor/);
});
test('descuento negativo, decimal o no numérico → error (400)', () => {
  for (const bad of [-1, '-5', 10.5, '10.5', 'abc', NaN, Infinity, {}, [5]]) assert.ok(parseDiscount(bad, 120000).error, String(bad));
});
test('el total lo calcula el servidor: un total_amount del cliente no influye', () => {
  const body = { total_amount: 1, items, discount_amount: 5000 };
  const subtotal = computeTotals(body.items).subtotal;
  const { discount } = parseDiscount(body.discount_amount, subtotal);
  assert.equal(computeTotals(body.items, { discount }).total, 115000);
});
test('con envío: total = subtotal + envío − descuento', () => {
  assert.equal(computeTotals(items, { shipping: 15000, discount: 10000 }).total, 125000);
});
