// Historial de inventario, movimiento por cada camino de venta y activar variante sin perder stock propio.
// Base en memoria (sin red ni Supabase). Ejecutar: node --test tests/inventory-history.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFilters, applyFilters, describeSource, ownStockLossMessage, orderCode } = require('../src/utils/inventoryHistory');

const BIZ = 'biz-1';
const OTHER = 'biz-2';
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = (o) => JSON.parse(JSON.stringify(o));
let db;
let seq = 0;

// ── Base en memoria con lo que usan estos controladores ──
function q(table) {
  const st = { op: 'select', f: [], payload: null, one: false, range: null, order: null, count: false, head: false, or: null };
  const match = (r) => st.f.every(([k, op, v]) => (op === 'eq' ? r[k] === v : op === 'neq' ? r[k] !== v : op === 'in' ? v.includes(r[k])
    : op === 'gte' ? String(r[k]) >= String(v) : op === 'lte' ? String(r[k]) <= String(v) : true))
    && (!st.or || st.or(r));
  const run = () => {
    if (st.op === 'insert') { const row = { id: `${table}-${++seq}`, created_at: new Date().toISOString(), ...clone(st.payload) }; db[table].push(row); return { data: clone(row), error: null }; }
    if (st.op === 'update') { db[table].filter(match).forEach((r) => Object.assign(r, clone(st.payload))); return { data: db[table].filter(match).map(clone), error: null }; }
    let rows = db[table].filter(match).map(clone);
    const count = rows.length;
    if (st.order) rows.sort((a, b) => (st.order.asc ? 1 : -1) * String(a[st.order.k]).localeCompare(String(b[st.order.k])));
    if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
    if (st.head) return { data: null, count, error: null };
    if (st.one) return { data: rows[0] || null, error: rows[0] ? null : { message: 'no rows' } };
    return { data: rows, count: st.count ? count : undefined, error: null };
  };
  const b = {
    select(_c, opts = {}) { st.count = !!opts.count; st.head = !!opts.head; return b; },
    eq(k, v) { st.f.push([k, 'eq', v]); return b; }, neq(k, v) { st.f.push([k, 'neq', v]); return b; },
    in(k, v) { st.f.push([k, 'in', v]); return b; }, gte(k, v) { st.f.push([k, 'gte', v]); return b; }, lte(k, v) { st.f.push([k, 'lte', v]); return b; },
    or(expr) {
      // Solo las dos formas que usa el código: "reason.is.null,reason.neq.\"x\"" y "status.is.null,status.neq.cancelado"
      const [field] = expr.split('.');
      const bad = expr.match(/neq\."?([^"]+)"?$/)[1];
      st.or = (r) => r[field] === null || r[field] === undefined || r[field] !== bad;
      return b;
    },
    order(k, o = {}) { st.order = { k, asc: o.ascending !== false }; return b; }, range(a, z) { st.range = [a, z]; return b; }, limit() { return b; },
    insert(p) { st.op = 'insert'; st.payload = p; return b; }, update(p) { st.op = 'update'; st.payload = p; return b; },
    single() { st.one = true; return Promise.resolve(run()); }, maybeSingle() { st.one = true; const r = run(); return Promise.resolve({ ...r, error: null }); },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  return b;
}
const rpcCalls = [];
const fake = {
  from: (t) => q(t),
  rpc: async (name, a) => {
    rpcCalls.push(a);
    const target = a.p_variant_id ? db.product_variants.find((v) => v.id === a.p_variant_id && v.business_id === a.p_business_id) : db.products.find((p) => p.id === a.p_product_id && p.business_id === a.p_business_id);
    if (!target || target.stock + a.p_change < 0) return { data: null, error: { message: 'STOCK_INSUFICIENTE_O_NO_ENCONTRADO' } };
    target.stock += a.p_change;
    db.inventory_movements.push({ id: `mv-${++seq}`, business_id: a.p_business_id, product_id: a.p_product_id, variant_id: a.p_variant_id, type: a.p_type, quantity_change: a.p_change, stock_after: target.stock, reason: a.p_reason, reference_type: a.p_ref_type, reference_id: a.p_ref_id, created_at: new Date(Date.now() + seq).toISOString() });
    return { data: target.stock, error: null };
  },
};
const supaPath = require.resolve('../src/config/supabase');
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { supabaseAdmin: fake, createUserClient: () => fake } };
const loggerPath = require.resolve('../src/utils/logger');
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: { info() {}, warn() {}, error() {} } };
const products = require('../src/controllers/products.controller');
const variants = require('../src/controllers/productVariants.controller');

function reset() {
  seq = 0; rpcCalls.length = 0;
  db = {
    products: [
      { id: U(1), business_id: BIZ, name: 'Top Jana', price: 59900, stock: 3, is_active: true, has_variants: true, is_bundle: false },
      { id: U(2), business_id: BIZ, name: 'camiseta elite', price: 50000, stock: 12, is_active: true, has_variants: false, is_bundle: false },
      { id: U(3), business_id: BIZ, name: 'Gel', price: 20000, stock: 10, is_active: true, has_variants: false, is_bundle: false, cost_price: null },
      { id: U(9), business_id: OTHER, name: 'Ajeno', price: 1, stock: 5, is_active: true, has_variants: false, is_bundle: false },
    ],
    product_variants: [
      { id: U(11), product_id: U(1), business_id: BIZ, attributes: { color: 'Verde', talla: 'S' }, stock: 3, is_active: true },
      { id: U(12), product_id: U(1), business_id: BIZ, attributes: { color: 'Azul', talla: 'S' }, stock: 0, is_active: false },
      { id: U(21), product_id: U(2), business_id: BIZ, attributes: { color: 'negro', talla: 'm' }, stock: 7, is_active: false },
    ],
    inventory_movements: [], product_sales: [], income: [], expenses: [],
    orders: [{ id: U(100), business_id: BIZ, source: 'web', client_name: 'Ana' }, { id: U(101), business_id: BIZ, source: 'manual', client_name: null }],
  };
}
const call = async (fn, { params = {}, body = {}, query = {}, businessId = BIZ } = {}) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await fn({ params, body, query, businessId, business: { country: 'CO' }, headers: {}, user: { id: 'user-1' } }, res);
  return res;
};

// ── Reglas puras ──
test('filtros: solo valores válidos llegan a la consulta; paginación acotada', () => {
  const f = parseFilters({ tipo: 'venta', product_id: U(1), variant_id: 'x;drop', desde: '2026-10-01', hasta: '01/10/2026', page: '3', limit: '500' });
  assert.equal(f.tipo, 'venta');
  assert.equal(f.product_id, U(1));
  assert.equal(f.variant_id, null);
  assert.equal(f.desde, '2026-10-01');
  assert.equal(f.hasta, null);
  assert.deepEqual([f.page, f.limit, f.from, f.to], [3, 100, 200, 299]);
  assert.equal(parseFilters({ tipo: 'borrar' }).tipo, null);
  assert.deepEqual([parseFilters({}).page, parseFilters({}).limit], [1, 25]);
});

test('origen legible: venta web/manual, devolución, asistente, deshacer y venta rápida', () => {
  const O = { [U(100)]: { source: 'web', client_name: 'Ana' }, [U(101)]: { source: 'manual', client_name: null } };
  assert.deepEqual(describeSource({ type: 'venta', reference_type: 'order', reference_id: U(100) }, O), { origen: 'Venta (tienda web)', pedido: orderCode(U(100)), cliente: 'Ana' });
  assert.equal(describeSource({ type: 'venta', reference_type: 'order', reference_id: U(101) }, O).origen, 'Venta (pedido manual)');
  assert.equal(describeSource({ type: 'devolucion', reference_type: 'order_cancel', reference_id: U(100) }, O).origen, 'Devolución por cancelación');
  assert.equal(describeSource({ type: 'ajuste', reference_type: 'assistant_action', reason: 'Asistente: llegada' }).origen, 'Asistente');
  assert.equal(describeSource({ type: 'ajuste', reference_type: 'assistant_action', reason: 'deshacer asistente' }).origen, 'Asistente (deshacer)');
  assert.equal(describeSource({ type: 'venta', reference_type: 'product_sale', reference_id: 'x' }).origen, 'Venta rápida');
  assert.match(orderCode(U(100)), /^P-[0-9A-F]{8}$/);
});

test('activar variante: solo se bloquea si el producto guarda stock propio y no hay otras variantes activas', () => {
  assert.match(ownStockLossMessage({ productStock: 12, otherActiveVariants: 0, variantLabel: 'negro / m' }), /12 unidades guardadas sin variante.*se perderían/);
  assert.equal(ownStockLossMessage({ productStock: 12, otherActiveVariants: 1 }), null, 'producto que ya usa variantes: no cambia');
  assert.equal(ownStockLossMessage({ productStock: 0, otherActiveVariants: 0 }), null);
});

// ── Controladores ──
test('activar una variante que borraría el stock propio → 409 y no cambia nada', async () => {
  reset();
  const r = await call(variants.update, { params: { productId: U(2), variantId: U(21) }, body: { is_active: true } });
  assert.equal(r.code, 409);
  assert.equal(r.body.code, 'OWN_STOCK_WOULD_BE_LOST');
  assert.equal(db.product_variants.find((v) => v.id === U(21)).is_active, false);
  assert.equal(db.products.find((p) => p.id === U(2)).stock, 12, 'las 12 unidades siguen');
});

test('activar una variante en un producto que ya usa variantes: permitido', async () => {
  reset();
  const r = await call(variants.update, { params: { productId: U(1), variantId: U(12) }, body: { is_active: true } });
  assert.equal(r.code, 200);
  assert.equal(db.product_variants.find((v) => v.id === U(12)).is_active, true);
});

test('venta rápida del panel: movimiento "venta" enlazado al registro de la venta y a la variante', async () => {
  reset();
  const r = await call(products.sell, { params: { id: U(1) }, body: { quantity: 2, variant_id: U(11) } });
  assert.equal(r.code < 300, true, JSON.stringify(r.body));
  const sale = db.product_sales[0];
  const mv = db.inventory_movements[0];
  assert.deepEqual([mv.type, mv.quantity_change, mv.variant_id, mv.reference_type], ['venta', -2, U(11), 'product_sale']);
  assert.equal(mv.reference_id, sale.id, 'el movimiento apunta a su venta');
  const otro = await call(products.sell, { params: { id: U(9) }, body: { quantity: 1 } });
  assert.equal(otro.code, 404, 'producto de otro negocio');
});

test('asistente de barbería: vender_producto y registrar_venta dejan movimiento enlazado (antes vender_producto no dejaba)', async () => {
  reset();
  const assistant = require('../src/services/assistant.service');
  const a = await assistant.executeTool('vender_producto', { product_name: 'gel', quantity: 2 }, BIZ);
  assert.equal(a.success, true, JSON.stringify(a));
  const b = await assistant.executeTool('registrar_venta', { product_id: U(3), quantity: 1 }, BIZ);
  assert.equal(b.success, true, JSON.stringify(b));
  assert.equal(db.inventory_movements.length, 2);
  for (const [i, mv] of db.inventory_movements.entries()) {
    assert.equal(mv.type, 'venta');
    assert.equal(mv.reference_type, 'product_sale');
    assert.equal(mv.reference_id, db.product_sales[i].id);
  }
  assert.equal(db.products.find((p) => p.id === U(3)).stock, 7);
});

test('historial: del negocio del token, con nombres, pedido, filtros por tipo/producto/variante/fecha y paginación', async () => {
  reset();
  const mv = (n, extra) => db.inventory_movements.push({ id: `m${n}`, business_id: BIZ, product_id: U(1), variant_id: U(11), type: 'venta', quantity_change: -1, stock_after: 2, reason: null, reference_type: 'order', reference_id: U(100), created_at: `2026-10-${String(10 + n).padStart(2, '0')}T15:00:00Z`, ...extra });
  for (let i = 1; i <= 6; i++) mv(i);
  mv(7, { type: 'devolucion', quantity_change: 1, reference_type: 'order_cancel' });
  mv(8, { type: 'ajuste', quantity_change: 3, reference_type: 'assistant_action', reason: 'Asistente: llegada' });
  mv(9, { type: 'ajuste', quantity_change: -3, reference_type: 'assistant_action', reason: 'deshacer asistente' });
  mv(10, { product_id: U(2), variant_id: null, type: 'ajuste', quantity_change: 2, reference_type: 'product_update', reference_id: null });
  db.inventory_movements.push({ id: 'ajeno', business_id: OTHER, product_id: U(9), type: 'venta', quantity_change: -1, created_at: '2026-10-15T00:00:00Z' });

  const all = await call(products.getHistory, { query: {} });
  assert.equal(all.body.total, 10, 'nunca otro negocio');
  assert.equal(all.body.data[0].id, 'm10', 'más reciente primero');
  const v = (await call(products.getHistory, { query: { tipo: 'venta', limit: '5', page: '2' } })).body;
  assert.deepEqual([v.total, v.data.length, v.page], [6, 1, 2]);
  assert.equal(v.data[0].product_name, 'Top Jana');
  assert.deepEqual(v.data[0].variant.attributes, { color: 'Verde', talla: 'S' });
  assert.equal(v.data[0].origen, 'Venta (tienda web)');
  assert.equal(v.data[0].pedido, orderCode(U(100)));
  assert.equal((await call(products.getHistory, { query: { tipo: 'devolucion' } })).body.data[0].origen, 'Devolución por cancelación');
  assert.deepEqual((await call(products.getHistory, { query: { tipo: 'deshacer' } })).body.data.map((m) => m.id), ['m9']);
  assert.deepEqual((await call(products.getHistory, { query: { tipo: 'ajuste' } })).body.data.map((m) => m.id).sort(), ['m10', 'm8'], 'ajustes sin los deshacer');
  assert.equal((await call(products.getHistory, { query: { product_id: U(2) } })).body.total, 1);
  assert.equal((await call(products.getHistory, { query: { variant_id: U(11), tipo: 'venta' } })).body.total, 6);
  assert.equal((await call(products.getHistory, { query: { desde: '2026-10-15', hasta: '2026-10-16' } })).body.total, 2);
});

test('applyFilters arma la consulta con los filtros validados', () => {
  const calls = [];
  const fakeQ = new Proxy({}, { get: (_t, k) => (...a) => { calls.push([k, ...a]); return fakeQ; } });
  applyFilters(fakeQ, parseFilters({ tipo: 'deshacer', product_id: U(1), desde: '2026-10-01' }));
  assert.deepEqual(calls.map((c) => c[0]), ['in', 'eq', 'eq', 'gte']);
});
