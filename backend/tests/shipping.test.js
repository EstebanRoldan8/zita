// Pruebas del envío por ciudad y de las casillas obligatorias del checkout.
// Ejecutar: node --test tests/shipping.test.js   (no necesita base de datos ni red)
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { calculateShipping, normalizeCity } = require('../src/config/shipping');
const { validateStoreOrder } = require('../src/middlewares/sanitize');

// Valores de FLOW
const FLOW = { shipping_local_cost: 15000, shipping_local_city: 'cali', shipping_flat_cost: 18000, free_shipping_from: 250000 };
// Negocio sin tarifa local: cobra la tarifa plana en todo, como antes
const LEGACY = { shipping_flat_cost: 12000, free_shipping_from: 200000 };
const ship = (subtotal, city, settings = FLOW) => calculateShipping({ subtotal, city, settings });

test('Cali con 249.999 → 15.000', () => assert.deepEqual(ship(249999, 'Cali'), { zone: 'cali', cost: 15000 }));
test('Cali con 250.000 → gratis', () => assert.deepEqual(ship(250000, 'Cali'), { zone: 'cali', cost: 0 }));
test('"cali " y "Santiago de Cali" son la misma zona', () => {
  assert.equal(ship(100000, 'cali ').zone, 'cali');
  assert.equal(ship(100000, 'Santiago de Cali').zone, 'cali');
  assert.equal(ship(100000, '  SANTIAGO  DE  CALÍ ').cost, 15000);
  assert.equal(normalizeCity('Cali, Valle'), 'cali');
});
test('Bogotá con 100.000 → 18.000', () => assert.deepEqual(ship(100000, 'Bogotá'), { zone: 'nacional', cost: 18000 }));
test('Bogotá con 250.000 → gratis', () => assert.deepEqual(ship(250000, 'Bogotá'), { zone: 'nacional', cost: 0 }));
test('carrito con un set: el subtotal es la línea del set por su cantidad', () => {
  // Misma regla que createOrder: total_price = unit_price × cantidad, sin importar los componentes
  const lines = [
    { unit_price: 189900, quantity: 1 }, // set (una línea, un precio)
    { unit_price: 69900, quantity: 1 },  // pieza suelta
  ];
  const subtotal = lines.reduce((s, l) => s + l.unit_price * l.quantity, 0); // 259.800
  assert.deepEqual(ship(subtotal, 'Cali'), { zone: 'cali', cost: 0 });
  assert.deepEqual(ship(189900, 'Medellín'), { zone: 'nacional', cost: 18000 });
});
test('negocio SIN shipping_local_cost cobra la tarifa plana en todo (también en Cali)', () => {
  assert.deepEqual(ship(100000, 'Cali', LEGACY), { zone: 'nacional', cost: 12000 });
  assert.deepEqual(ship(100000, 'Bogotá', LEGACY), { zone: 'nacional', cost: 12000 });
  assert.deepEqual(ship(200000, 'Cali', LEGACY), { zone: 'nacional', cost: 0 });
  assert.equal(ship(100000, 'Cali', { ...LEGACY, shipping_local_cost: '' }).cost, 12000);
});
test('sin free_shipping_from nunca es gratis', () => {
  assert.equal(ship(9999999, 'Bogotá', { shipping_flat_cost: 18000 }).cost, 18000);
});

// ── Casillas: el validador del endpoint responde 400 si faltan ──
const baseBody = () => ({
  items: [{ product_id: '11111111-1111-4111-8111-111111111111', quantity: 1 }],
  customer: { name: 'Persona Prueba', phone: '3001234567' },
  shipping: { address: 'Calle 1 # 2-3', city: 'Cali' },
  payment_method: 'transferencia',
  idempotency_key: 'clave-de-prueba-123',
  consents: { terms: true, data_auth: true },
});

async function post(body) {
  const app = express();
  app.use(express.json());
  app.post('/', validateStoreOrder, (req, res) => res.json({ ok: true, consents: req.body.consents }));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  } finally { server.close(); }
}

test('pedido con las dos casillas obligatorias pasa', async () => assert.equal((await post(baseBody())).status, 200));
test('sin consents → 400', async () => {
  const b = baseBody(); delete b.consents;
  const r = await post(b); assert.equal(r.status, 400); assert.equal(r.json.field, 'consents.terms');
});
test('sin términos → 400', async () => {
  const b = baseBody(); b.consents.terms = false;
  const r = await post(b); assert.equal(r.status, 400); assert.equal(r.json.field, 'consents.terms');
});
test('sin autorización de datos → 400', async () => {
  const b = baseBody(); delete b.consents.data_auth;
  const r = await post(b); assert.equal(r.status, 400); assert.equal(r.json.field, 'consents.data_auth');
});
test('"true" como texto no cuenta como aceptar → 400', async () => {
  const b = baseBody(); b.consents.terms = 'true';
  assert.equal((await post(b)).status, 400);
});
test('marketing opcional: sin marcar o marcado pasa; basura → 400', async () => {
  const ok = baseBody(); ok.consents.marketing_whatsapp = true; ok.consents.marketing_email = false;
  assert.equal((await post(ok)).status, 200);
  const bad = baseBody(); bad.consents.marketing_email = 'si';
  assert.equal((await post(bad)).status, 400);
});

// ── Revisión: reconocimiento de Cali con complementos ──
test('Cali con complementos es zona local; Calima y Caliente no', () => {
  for (const c of ['Cali Valle', 'cali valle del cauca', 'Santiago de Cali Valle del Cauca Colombia', 'Santiago de Cali, Valle', 'CALÍ']) {
    assert.deepEqual(ship(100000, c), { zone: 'cali', cost: 15000 }, c);
  }
  for (const c of ['Calima', 'Caliente', 'Calidonia', 'Bogotá Cali', 'Jamundí']) {
    assert.deepEqual(ship(100000, c), { zone: 'nacional', cost: 18000 }, c);
  }
  assert.equal(normalizeCity('Santiago de Cali Valle del Cauca Colombia'), 'cali');
});
test('ciudad local mal configurada (se normaliza a vacío) se ignora: todo es tarifa plana', () => {
  const bad = { ...FLOW, shipping_local_city: '!!' };
  assert.deepEqual(ship(100000, '##', bad), { zone: 'nacional', cost: 18000 });
  assert.deepEqual(ship(100000, 'Cali', bad), { zone: 'nacional', cost: 18000 });
});
test('ciudad del cliente que se normaliza a vacío cae en nacional, nunca en local', () => {
  assert.deepEqual(ship(100000, '##'), { zone: 'nacional', cost: 18000 });
  assert.deepEqual(ship(100000, '   '), { zone: 'nacional', cost: 18000 });
  assert.deepEqual(ship(100000, undefined), { zone: 'nacional', cost: 18000 });
});

// ── Revisión: marketing exige el dato de contacto ──
test('marketing_email: true sin correo → 400; con correo pasa', async () => {
  const b = baseBody(); b.consents.marketing_email = true;
  const r = await post(b);
  assert.equal(r.status, 400); assert.equal(r.json.field, 'consents.marketing_email');
  b.customer.email = 'persona@correo.com';
  assert.equal((await post(b)).status, 200);
});
test('marketing_whatsapp: true sin teléfono → 400; con teléfono pasa', async () => {
  const b = baseBody(); b.consents.marketing_whatsapp = true;
  assert.equal((await post(b)).status, 200);
  delete b.customer.phone;
  assert.equal((await post(b)).status, 400);
});

// ── Revisión: limpieza de pedidos fallidos ──
const { discardOrder, flagForReview } = require('../src/utils/orderCleanup');

// Cliente falso: registra cada operación y responde con el error configurado por tabla/operación
function fakeDb(errors = {}) {
  const calls = [];
  const from = (table) => ({
    delete() { calls.push({ table, op: 'delete' }); return chain(errors[`${table}.delete`]); },
    update(values) { calls.push({ table, op: 'update', values }); return chain(errors[`${table}.update`]); },
  });
  const chain = (error) => {
    const o = { eq: () => o, then: (resolve) => resolve({ error: error ? { message: error } : null }) };
    return o;
  };
  return { db: { from }, calls };
}
const fakeLog = () => { const lines = []; return { lines, error: (m) => lines.push(m), warn: (m) => lines.push(m) }; };

test('discardOrder: borra ítems y pedido, devuelve true y no registra nada', async () => {
  const { db, calls } = fakeDb(); const log = fakeLog();
  assert.equal(await discardOrder(db, log, { orderId: 'o1', businessId: 'b1' }), true);
  assert.deepEqual(calls.map((c) => `${c.table}.${c.op}`), ['order_items.delete', 'orders.delete']);
  assert.equal(log.lines.length, 0);
});
test('discardOrder: si un borrado falla, devuelve false y registra solo id y mensaje', async () => {
  const { db } = fakeDb({ 'orders.delete': 'conexión perdida' }); const log = fakeLog();
  assert.equal(await discardOrder(db, log, { orderId: 'o1', businessId: 'b1' }), false);
  assert.equal(log.lines.length, 1);
  assert.match(log.lines[0], /order=o1/); assert.match(log.lines[0], /conexión perdida/);
  assert.doesNotMatch(log.lines[0], /b1/);
});
test('flagForReview: no borra; cancela, libera la idempotency_key y marca [REVISAR STOCK]', async () => {
  const { db, calls } = fakeDb(); const log = fakeLog();
  assert.equal(await flagForReview(db, log, { orderId: 'o1', businessId: 'b1' }), true);
  assert.equal(calls.some((c) => c.op === 'delete'), false);
  const u = calls.find((c) => c.op === 'update').values;
  assert.equal(u.status, 'cancelado'); assert.equal(u.idempotency_key, null); assert.match(u.notes, /REVISAR STOCK/);
  assert.match(log.lines[0], /order=o1/);
});
test('flagForReview: si la marca falla, lo registra y devuelve false', async () => {
  const { db } = fakeDb({ 'orders.update': 'sin permisos' }); const log = fakeLog();
  assert.equal(await flagForReview(db, log, { orderId: 'o1', businessId: 'b1' }), false);
  assert.match(log.lines[0], /sin permisos/);
});
