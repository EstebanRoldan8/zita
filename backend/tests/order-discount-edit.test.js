// Editar el descuento en pesos de un pedido ya creado (PATCH /api/orders/:id/discount).
// Base en memoria (sin red ni Supabase). Ejecutar: node --test tests/order-discount-edit.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const BIZ = 'biz-1';
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = (o) => JSON.parse(JSON.stringify(o));
let db;
let failIncome = false;

function q(table) {
  const st = { op: 'select', f: [], payload: null, one: false };
  const match = (r) => st.f.every(([k, op, v]) => (op === 'eq' ? r[k] === v : op === 'notin' ? !v.includes(r[k]) : true));
  const run = () => {
    if (table === 'income' && failIncome && st.op !== 'select') return { data: null, error: { message: 'caja caída' } };
    if (st.op === 'insert') { const row = { id: `${table}-${db[table].length + 1}`, ...clone(st.payload) }; db[table].push(row); return { data: [clone(row)], error: null }; }
    if (st.op === 'update') { const rows = db[table].filter(match); rows.forEach((r) => Object.assign(r, clone(st.payload))); return { data: rows.map(clone), error: null }; }
    if (st.op === 'delete') { const keep = db[table].filter((r) => !match(r)); const gone = db[table].length - keep.length; db[table] = keep; return { data: gone, error: null }; }
    const rows = db[table].filter(match).map(clone);
    if (st.one) return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  };
  const b = {
    select() { return b; },
    eq(k, v) { st.f.push([k, 'eq', v]); return b; },
    not(k, op, v) { st.f.push([k, 'notin', v.replace(/[()]/g, '').split(',')]); return b; },
    insert(p) { st.op = 'insert'; st.payload = p; return b; },
    update(p) { st.op = 'update'; st.payload = p; return b; },
    delete() { st.op = 'delete'; return b; },
    maybeSingle() { st.one = true; return Promise.resolve(run()); },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  return b;
}
const fake = { from: (t) => q(t) };
const supaPath = require.resolve('../src/config/supabase');
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { supabaseAdmin: fake, createUserClient: () => fake } };
const logs = [];
const loggerPath = require.resolve('../src/utils/logger');
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: { info: (m) => logs.push(m), warn() {}, error() {} } };
const { updateDiscount } = require('../src/controllers/orders.controller');

const items = [{ quantity: 2, unit_price: 50000 }, { quantity: 1, unit_price: 20000 }]; // subtotal 120.000
function reset() {
  failIncome = false; logs.length = 0;
  db = {
    orders: [
      { id: U(1), business_id: BIZ, status: 'recibido', total_amount: 135000, discount_amount: 0, shipping_cost: 15000, payment_status: 'pendiente', order_items: clone(items) },
      { id: U(2), business_id: BIZ, status: 'en_proceso', total_amount: 120000, discount_amount: 0, shipping_cost: 0, payment_status: 'pagado', order_items: clone(items) },
      { id: U(3), business_id: BIZ, status: 'entregado', total_amount: 120000, discount_amount: 0, shipping_cost: 0, payment_status: 'pagado', order_items: clone(items) },
      { id: U(4), business_id: BIZ, status: 'cancelado', total_amount: 120000, discount_amount: 0, shipping_cost: 0, order_items: clone(items) },
      { id: U(5), business_id: 'biz-2', status: 'recibido', total_amount: 120000, discount_amount: 0, shipping_cost: 0, order_items: clone(items) },
    ],
    income: [{ id: 'inc-1', business_id: BIZ, order_id: U(2), amount: 120000, date: '2026-10-01' }],
    expenses: [],
  };
}
async function call(id, body) {
  let status = 200; let out;
  const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } };
  await updateDiscount({ params: { id }, body, headers: {}, businessId: BIZ, business: { business_type: 'tienda' }, user: { id: 'user-7' } }, res);
  return { status, body: out };
}
const order = (n) => db.orders.find((o) => o.id === U(n));

test('total = subtotal + envío − descuento, calculado por el servidor (ignora total_amount del body)', async () => {
  reset();
  const r = await call(U(1), { discount_amount: '20000', total_amount: 1 });
  assert.equal(r.status, 200);
  assert.equal(order(1).discount_amount, 20000);
  assert.equal(order(1).total_amount, 115000);
});

test('se puede quitar el descuento (0) y vuelve el total completo', async () => {
  reset();
  await call(U(1), { discount_amount: 20000 });
  await call(U(1), { discount_amount: 0 });
  assert.equal(order(1).total_amount, 135000);
});

test('el tope es subtotal + envío; mayor, negativo, decimal o texto → 400 sin cambios', async () => {
  reset();
  assert.equal((await call(U(1), { discount_amount: 135000 })).status, 200);
  assert.equal(order(1).total_amount, 0);
  reset();
  for (const bad of [135001, -1, 10.5, 'abc', '1e3']) {
    const r = await call(U(1), { discount_amount: bad });
    assert.equal(r.status, 400, String(bad));
  }
  assert.equal(order(1).total_amount, 135000);
});

test('pedido entregado o cancelado no se puede editar', async () => {
  reset();
  assert.equal((await call(U(3), { discount_amount: 1000 })).status, 400);
  assert.equal((await call(U(4), { discount_amount: 1000 })).status, 400);
  assert.equal(order(3).total_amount, 120000);
});

test('otro negocio o id inválido → 404', async () => {
  reset();
  assert.equal((await call(U(5), { discount_amount: 1000 })).status, 404);
  assert.equal((await call("1' or 1=1", { discount_amount: 1000 })).status, 404);
});

test('pedido pagado: el ingreso en caja pasa al total neto (misma fecha)', async () => {
  reset();
  await call(U(2), { discount_amount: 10000 });
  assert.equal(db.income[0].amount, 110000);
  assert.equal(db.income[0].date, '2026-10-01');
});

test('si la caja falla, el descuento no se guarda (todo o nada)', async () => {
  reset();
  failIncome = true;
  const r = await call(U(2), { discount_amount: 10000 });
  assert.equal(r.status, 500);
  assert.equal(order(2).total_amount, 120000);
  assert.equal(order(2).discount_amount, 0);
});

test('queda registro de quién y cuándo (sin datos del cliente)', async () => {
  reset();
  await call(U(1), { discount_amount: 5000 });
  assert.ok(order(1).updated_at);
  assert.ok(logs.some((l) => l.includes(`order=${U(1)}`) && l.includes('user=user-7') && l.includes('0→5000')));
});
