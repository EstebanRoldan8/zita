// Descuento 5 % por set (Top + Falda/Short/Licra) en la tienda pública. Ejecutar: node --test tests/set-promo.test.js
// Base en memoria (sin red ni Supabase).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { SET_PROMO, promoGroup, setDiscount, productTypes } = require('../src/utils/setPromo');

const top = (price = 59900, quantity = 1) => ({ group: 'top', price, quantity });
const bottom = (price, quantity = 1) => ({ group: 'bottom', price, quantity });

test('2 tops + 1 short = 1 pareja (el top más caro con el short)', () => {
  const r = setDiscount([top(59900, 1), top(49900, 1), bottom(84900)]);
  assert.equal(r.pairs, 1);
  assert.equal(r.amount, Math.round((59900 + 84900) * 0.05));
});

test('1 top + 1 licra + 1 falda = 1 pareja (con el bottom más caro: a favor del cliente)', () => {
  const r = setDiscount([top(59900), bottom(119900), bottom(94900)]);
  assert.equal(r.pairs, 1);
  assert.equal(r.amount, Math.round((59900 + 119900) * 0.05));
});

test('2 tops + 2 bottoms = 2 parejas, emparejadas por precio descendente', () => {
  const r = setDiscount([top(59900, 2), bottom(84900), bottom(119900)]);
  assert.equal(r.pairs, 2);
  assert.equal(r.amount, Math.round((59900 + 119900) * 0.05) + Math.round((59900 + 84900) * 0.05));
});

test('sin pareja no hay descuento; otras prendas no cuentan', () => {
  assert.deepEqual(setDiscount([top(59900, 3)]), { pairs: 0, amount: 0 });
  assert.deepEqual(setDiscount([{ group: null, price: 74900, quantity: 2 }, bottom(84900)]), { pairs: 0, amount: 0 });
});

// Productos de FLOW (nombre, categoría) y su grupo esperado
const FLOW = [
  ['Top Aria', 'Tops', 'top'], ['Top Nila', 'Tops', 'top'], ['Top Jana', 'Tops', 'top'],
  ['Falda Lira', 'Faldas', 'bottom'], ['Falda Vela', 'Faldas', 'bottom'],
  ['Licra Jana', 'Licras', 'bottom'], ['Licra Aria', 'Licras', 'bottom'], ['Short Nila', 'Shorts', 'bottom'], ['Short Jana', 'Shorts', 'bottom'],
  ['Licra Liva', 'Flow Archive', 'bottom'], ['Short Liva', 'Flow Archive', 'bottom'],
  ['Pantaloneta Nila', 'Hombre', null], ['Oversize Renacer', 'Unisex', null],
  ['Crop Top Pura Vida', 'Flow Archive', null], ['Crop top Cuadro', 'Flow Archive', null], ['Camiseta Cuadro', 'Flow Archive', null],
  ['Jolie Sol', 'Flow Archive', null], ['Jolie Sol', 'Camisetas', null],
];

test('clasificación de los productos de FLOW (camisetas, crop tops, oversize y pantaloneta no cuentan)', () => {
  for (const [name, category, group] of FLOW) assert.equal(promoGroup({ name, category }), group, `${name} (${category})`);
});

test('los sets (is_bundle) nunca entran', () => {
  assert.equal(promoGroup({ name: 'Set Aria', category: 'Tops', is_bundle: true }), null);
  assert.equal(promoGroup({ name: 'Set Jana Short', category: 'Sets', is_bundle: true }), null);
});

test('misma clasificación que la tienda (frontend/src/store/lib/collections.js productTypesOf)', async () => {
  const url = pathToFileURL(path.join(__dirname, '../../frontend/src/store/lib/collections.js')).href;
  const { productTypesOf } = await import(url);
  for (const [name, category] of FLOW) {
    assert.deepEqual(productTypes({ name, category }), productTypesOf({ name, category }), `${name} (${category})`);
  }
  assert.deepEqual(productTypes({ name: 'Set Aria', category: 'Sets', is_bundle: true }), []);
});

test('la vista previa de la bolsa (frontend setPromo.js) da el mismo grupo y monto que el servidor', async () => {
  const front = await import(pathToFileURL(path.join(__dirname, '../../frontend/src/store/lib/setPromo.js')).href);
  for (const [name, category] of FLOW) assert.equal(front.promoGroup({ name, category }), promoGroup({ name, category }), name);
  assert.equal(front.promoGroup({ name: 'Set Aria', category: 'Sets', is_bundle: true }), null);
  const cases = [[top(59900, 2), bottom(84900)], [top(59900), bottom(119900), bottom(94900)], [top(59900, 3), bottom(84900, 2), bottom(119900)], [top(59900)]];
  for (const c of cases) assert.deepEqual(front.setDiscount(c), setDiscount(c));
  assert.equal(front.SET_PROMO.label, SET_PROMO.label);
  assert.equal(front.SET_PROMO.percent, SET_PROMO.percent);
});

// ── createOrder en memoria ──
const BIZ = 'biz-flow';
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = (o) => JSON.parse(JSON.stringify(o));
let db;
function q(table) {
  const st = { op: 'select', f: [], payload: null };
  const match = (r) => st.f.every(([k, op, v]) => (op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : true));
  const run = (one) => {
    if (st.op === 'insert') {
      const rows = (Array.isArray(st.payload) ? st.payload : [st.payload]).map((p) => ({ id: p.id || U(900 + db[table].length), ...clone(p) }));
      db[table].push(...rows);
      return { data: one ? clone(rows[0]) : rows.map(clone), error: null };
    }
    if (st.op === 'delete') { db[table] = db[table].filter((r) => !match(r)); return { data: null, error: null }; }
    if (st.op === 'update') { db[table].filter(match).forEach((r) => Object.assign(r, clone(st.payload))); return { data: null, error: null }; }
    const rows = db[table].filter(match).map(clone);
    return { data: one ? rows[0] || null : rows, error: null };
  };
  const b = {
    select() { return b; }, eq(k, v) { st.f.push([k, 'eq', v]); return b; }, in(k, v) { st.f.push([k, 'in', v]); return b; },
    order() { return b; }, limit() { return b; },
    insert(p) { st.op = 'insert'; st.payload = p; return b; }, delete() { st.op = 'delete'; return b; }, update(p) { st.op = 'update'; st.payload = p; return b; },
    single() { return Promise.resolve(run(true)); }, maybeSingle() { return Promise.resolve(run(true)); },
    then(res, rej) { return Promise.resolve(run(false)).then(res, rej); },
  };
  return b;
}
const fake = {
  from: (t) => q(t),
  rpc: async (name, a) => {
    const p = db.products.find((x) => x.id === a.p_product_id);
    p.stock += a.p_change;
    return { data: p.stock, error: null };
  },
};
const supaPath = require.resolve('../src/config/supabase');
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { supabaseAdmin: fake, createUserClient: () => fake } };
const loggerPath = require.resolve('../src/utils/logger');
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: { info() {}, warn() {}, error() {} } };
const { createOrder } = require('../src/controllers/store.controller');

function reset() {
  const p = (n, name, category, price, extra = {}) => ({ id: U(n), business_id: BIZ, name, category, price, stock: 20, has_variants: false, is_bundle: false, is_active: true, ...extra });
  db = {
    products: [
      p(1, 'Top Aria', 'Tops', 59900), p(2, 'Short Nila', 'Shorts', 84900), p(3, 'Licra Aria', 'Licras', 119900),
      p(4, 'Falda Lira', 'Faldas', 94900), p(5, 'Camiseta Cuadro', 'Flow Archive', 74900),
      p(6, 'Set Nila Short', 'Sets', 134900, { is_bundle: true, stock: 0 }),
    ],
    product_bundle_components: [
      { business_id: BIZ, bundle_product_id: U(6), component_product_id: U(1), quantity: 1 },
      { business_id: BIZ, bundle_product_id: U(6), component_product_id: U(2), quantity: 1 },
    ],
    product_variants: [], orders: [], order_items: [],
  };
}
const SETTINGS = { shipping_flat_cost: 15000, free_shipping_from: 250000, whatsapp_number: '573174382899' };
async function order(items, extraBody = {}) {
  let status = 200; let out;
  const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } };
  await createOrder({
    storeBusinessId: BIZ, storeBusiness: { name: 'FLOW', settings: SETTINGS }, storeOwnerContact: null,
    body: {
      items, customer: { name: 'Ana', phone: '573001234567' }, shipping: { address: 'Calle 1', city: 'Medellín' },
      payment_method: 'transferencia', idempotency_key: `k-${Math.random()}`, consents: { terms: true, data_auth: true }, ...extraBody,
    },
  }, res);
  return { status, body: out, row: db.orders[db.orders.length - 1] };
}
const it = (n, quantity = 1) => ({ product_id: U(n), quantity });

test('createOrder: guarda el descuento y total = subtotal − descuento + envío', async () => {
  reset();
  const r = await order([it(1), it(2)]); // 59.900 + 84.900 = 144.800 → 5 % = 7.240
  assert.equal(r.status, 201);
  assert.equal(r.row.discount_amount, 7240);
  assert.equal(r.row.shipping_cost, 15000);
  assert.equal(r.row.total_amount, 144800 - 7240 + 15000);
  assert.equal(r.body.data.order.discount, 7240);
  assert.equal(r.body.data.order.discount_label, SET_PROMO.label);
  assert.equal(r.body.data.order.subtotal, 144800);
});

test('createOrder: el descuento o total que mande el cliente se ignora', async () => {
  reset();
  const r = await order([{ ...it(1), price: 1, discount: 99999 }, it(2)], { discount_amount: 99999, total_amount: 1, set_discount: 99999 });
  assert.equal(r.row.discount_amount, 7240);
  assert.equal(r.row.total_amount, 144800 - 7240 + 15000);
});

test('createOrder: sets y camisetas no dan descuento', async () => {
  reset();
  const r = await order([it(6), it(5), it(2)]); // set + camiseta + short: no hay top suelto
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.row.discount_amount, 0);
});

test('createOrder: el envío gratis se evalúa DESPUÉS del descuento', async () => {
  reset();
  // 59.900 + 59.900 + 84.900 + 94.900 = 299.600 bruto; 2 parejas: (59.900+94.900) y (59.900+84.900) → 7.740 + 7.240
  const free = await order([it(1, 2), it(2), it(4)]);
  assert.equal(free.row.discount_amount, 14980);
  assert.equal(free.row.shipping_cost, 0, '284.620 ≥ 250.000: gratis');
  reset();
  // Top + Licra + Camiseta = 254.700 bruto (≥ 250.000), pero con el descuento de 8.990 queda en 245.710
  const crossed = await order([it(1), it(3), it(5)]);
  assert.equal(crossed.row.discount_amount, 8990);
  assert.equal(crossed.row.shipping_cost, 15000, 'con descuento queda por debajo de 250.000: paga envío');
  assert.equal(crossed.row.total_amount, 254700 - 8990 + 15000);
});

test('createOrder: el mensaje de WhatsApp incluye la línea del descuento', async () => {
  reset();
  const r = await order([it(1), it(2)]);
  const text = decodeURIComponent(r.body.data.whatsapp_url);
  assert.match(text, /Descuento por set \(5 %\): -\$\s?7\.240/);
  assert.match(text, /Total: \$\s?152\.560/);
});
