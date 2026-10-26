// Métodos de pago del checkout por negocio. Ejecutar: node --test tests/payment-methods.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { enabledPaymentMethods } = require('../src/config/paymentMethods');
const { validateStoreOrder } = require('../src/middlewares/sanitize');

const body = (method) => ({
  items: [{ product_id: '11111111-1111-4111-8111-111111111111', quantity: 1 }],
  customer: { name: 'Persona Prueba', phone: '3001234567' },
  shipping: { address: 'Calle 1 # 2-3', city: 'Cali' },
  payment_method: method,
  idempotency_key: 'clave-de-prueba-123',
  consents: { terms: true, data_auth: true },
});

// Simula storeContext: el negocio (y sus store_settings) llegan por el slug, nunca por el body
async function post(settings, payload) {
  const app = express();
  app.use(express.json());
  app.post('/', (req, _res, next) => { req.storeBusiness = { settings }; next(); }, validateStoreOrder, (req, res) => res.json({ ok: true, method: req.body.payment_method }));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: res.status, json: await res.json() };
  } finally { server.close(); }
}

test('enabledPaymentMethods: sin la clave → solo transferencia', () => {
  assert.deepEqual(enabledPaymentMethods({}), ['transferencia']);
  assert.deepEqual(enabledPaymentMethods(undefined), ['transferencia']);
  assert.deepEqual(enabledPaymentMethods({ payment_methods: 'Nequi, transferencia o efectivo' }), ['transferencia']); // el texto informativo no habilita nada
});
test('enabledPaymentMethods: lista válida, sin repetidos ni métodos desconocidos', () => {
  assert.deepEqual(enabledPaymentMethods({ checkout_payment_methods: ['Transferencia', 'nequi', 'nequi', 'bitcoin', 7] }), ['transferencia', 'nequi']);
  assert.deepEqual(enabledPaymentMethods({ checkout_payment_methods: ['nequi'] }), ['nequi']);
  assert.deepEqual(enabledPaymentMethods({ checkout_payment_methods: [] }), ['transferencia']);
  assert.deepEqual(enabledPaymentMethods({ checkout_payment_methods: 'nequi' }), ['transferencia']);
});

test('Nequi habilitado: el pedido con nequi pasa', async () => {
  const r = await post({ checkout_payment_methods: ['transferencia', 'nequi'] }, body('nequi'));
  assert.equal(r.status, 200); assert.equal(r.json.method, 'nequi');
});
test('Nequi habilitado: transferencia sigue pasando', async () => {
  assert.equal((await post({ checkout_payment_methods: ['transferencia', 'nequi'] }, body('transferencia'))).status, 200);
});
test('Nequi NO habilitado (solo transferencia): nequi → 400 en payment_method', async () => {
  const r = await post({ checkout_payment_methods: ['transferencia'] }, body('nequi'));
  assert.equal(r.status, 400); assert.equal(r.json.field, 'payment_method');
});
test('negocio sin checkout_payment_methods: transferencia pasa y nequi → 400', async () => {
  assert.equal((await post({ shipping_flat_cost: 18000 }, body('transferencia'))).status, 200);
  const r = await post({ shipping_flat_cost: 18000 }, body('nequi'));
  assert.equal(r.status, 400); assert.equal(r.json.field, 'payment_method');
});
test('métodos que ya no se ofrecen o inventados → 400 aunque estén en el texto de la tienda', async () => {
  const settings = { payment_methods: 'Nequi, transferencia o efectivo', checkout_payment_methods: ['transferencia', 'nequi'] };
  for (const m of ['efectivo', 'tarjeta', 'wompi', 'bitcoin', '']) assert.equal((await post(settings, body(m))).status, 400, m);
});
test('el body no puede habilitar métodos: store_settings del body se ignora', async () => {
  const payload = { ...body('nequi'), store_settings: { checkout_payment_methods: ['nequi'] }, checkout_payment_methods: ['nequi'] };
  assert.equal((await post({}, payload)).status, 400);
});
