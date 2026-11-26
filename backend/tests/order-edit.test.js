// Edición completa de pedidos (services/orderEdit.js + POST /api/orders/:id/edit + acción editar_pedido del asistente).
// Base en memoria; la función edit_order / reopen_order de la migración 068 se simula con la MISMA semántica:
// una transacción (copia de la base al empezar y restauración si algo falla), adjust_stock que nunca deja
// negativo, líneas por id, Caja en su fila y historial. Ejecutar: node --test tests/order-edit.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BIZ = U(900);
const OTHER = U(901);
const NOW = new Date('2026-11-25T15:00:00Z');
const clone = (o) => JSON.parse(JSON.stringify(o));
const TIENDA = { id: BIZ, country: 'colombia', plan: 'pro', business_type: 'tienda', name: 'Tienda Test' };

const P_TOP = U(1); const V_TOP_S = U(11); const V_TOP_M = U(12);
const P_LICRA = U(2); const P_SET = U(3); const P_OTHER = U(4);
const OID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`; // códigos P- distintos
const O_OLD = OID(100); const O_NEW = OID(101); const O_CANCEL = OID(102); const O_SET = OID(103); const O_OTHER = OID(104);

let seed;
let fake;
let failAt = null; // paso de edit_order que debe fallar (simula un error a mitad de la transacción)

function freshSeed() {
  const snapshot = {
    version: 1, bundle_product_id: P_SET, bundle_name: 'Set Playa', bundle_variant_id: null, attributes: { talla: 'S' },
    components: [
      { product_id: P_TOP, variant_id: V_TOP_S, quantity: 1, name: 'Top Jana', label: 'S', cost_price: 20000 },
      { product_id: P_LICRA, variant_id: null, quantity: 1, name: 'Licra Aria', label: '', cost_price: 30000 },
    ],
  };
  return {
    businesses: [{ id: BIZ, store_settings: { shipping_flat_cost: 15000, shipping_local_cost: 8000, shipping_local_city: 'Cali' } }, { id: OTHER, store_settings: {} }],
    products: [
      { id: P_TOP, business_id: BIZ, name: 'Top Jana', price: 60000, cost_price: 20000, stock: 5, has_variants: true, is_bundle: false, is_active: true, category: 'Tops' },
      { id: P_LICRA, business_id: BIZ, name: 'Licra Aria', price: 80000, cost_price: 30000, stock: 3, has_variants: false, is_bundle: false, is_active: true, category: 'Licras' },
      { id: P_SET, business_id: BIZ, name: 'Set Playa', price: 130000, cost_price: null, stock: 0, has_variants: false, is_bundle: true, is_active: true, category: 'Sets' },
      { id: P_OTHER, business_id: OTHER, name: 'Producto Ajeno', price: 1000, cost_price: 1, stock: 50, has_variants: false, is_bundle: false, is_active: true, category: 'Tops' },
    ],
    product_variants: [
      { id: V_TOP_S, product_id: P_TOP, business_id: BIZ, attributes: { talla: 'S' }, stock: 5, is_active: true },
      { id: V_TOP_M, product_id: P_TOP, business_id: BIZ, attributes: { talla: 'M' }, stock: 0, is_active: true },
    ],
    product_bundle_components: [
      { business_id: BIZ, bundle_product_id: P_SET, component_product_id: P_TOP, quantity: 1 },
      { business_id: BIZ, bundle_product_id: P_SET, component_product_id: P_LICRA, quantity: 1 },
    ],
    orders: [
      // Pedido "viejo": hace más de un mes, entregado y pagado
      { id: O_OLD, business_id: BIZ, status: 'entregado', payment_status: 'pagado', payment_method: 'nequi', paid_at: '2026-10-10T17:00:00Z', created_at: '2026-10-10T17:00:00Z', total_amount: 60000, discount_amount: 0, shipping_cost: 0, client_name: 'Ana', client_phone: '3001234567', client_id: null, shipping_city: 'Cali', source: 'manual' },
      { id: O_NEW, business_id: BIZ, status: 'recibido', payment_status: 'pendiente', paid_at: null, created_at: '2026-11-24T17:00:00Z', total_amount: 80000, discount_amount: 0, shipping_cost: 0, client_name: 'Luz', client_phone: null, client_id: null, source: 'manual' },
      { id: O_CANCEL, business_id: BIZ, status: 'cancelado', payment_status: 'pagado', paid_at: '2026-11-01T17:00:00Z', created_at: '2026-11-01T17:00:00Z', total_amount: 80000, discount_amount: 0, shipping_cost: 0, client_name: 'Eva', client_id: null, source: 'manual' },
      { id: O_SET, business_id: BIZ, status: 'recibido', payment_status: 'pendiente', paid_at: null, created_at: '2026-11-24T17:00:00Z', total_amount: 130000, discount_amount: 0, shipping_cost: 0, client_name: 'Sol', client_id: null, source: 'manual' },
      { id: O_OTHER, business_id: OTHER, status: 'recibido', payment_status: 'pendiente', created_at: '2026-11-24T17:00:00Z', total_amount: 1000, discount_amount: 0, shipping_cost: 0, client_name: 'Ajeno', source: 'manual' },
    ],
    order_items: [
      { id: U(200), order_id: O_OLD, business_id: BIZ, product_id: P_TOP, variant_id: V_TOP_S, description: 'Top Jana (S)', quantity: 1, unit_price: 60000, total_price: 60000, bundle_snapshot: null },
      { id: U(201), order_id: O_NEW, business_id: BIZ, product_id: P_LICRA, variant_id: null, description: 'Licra Aria', quantity: 1, unit_price: 80000, total_price: 80000, bundle_snapshot: null },
      { id: U(202), order_id: O_CANCEL, business_id: BIZ, product_id: P_LICRA, variant_id: null, description: 'Licra Aria', quantity: 1, unit_price: 80000, total_price: 80000, bundle_snapshot: null },
      { id: U(203), order_id: O_SET, business_id: BIZ, product_id: P_SET, variant_id: null, description: 'Set Playa (S)', quantity: 1, unit_price: 130000, total_price: 130000, bundle_snapshot: snapshot },
      { id: U(204), order_id: O_OTHER, business_id: OTHER, product_id: P_OTHER, variant_id: null, description: 'Producto Ajeno', quantity: 1, unit_price: 1000, total_price: 1000, bundle_snapshot: null },
    ],
    income: [{ id: U(300), business_id: BIZ, order_id: O_OLD, amount: 60000, category: 'productos', source: 'order', date: '2026-10-10' }],
    expenses: [{ id: U(400), business_id: BIZ, order_id: O_OLD, amount: 20000, category: 'productos', date: '2026-10-10' }],
    inventory_movements: [],
    order_edits: [],
  };
}

// ── Simulación de edit_order / reopen_order (migración 068) ───────────────────
function fail(msg) { throw new Error(msg); }
function adjustStock(a, m) {
  const row = m.variant_id
    ? seed.product_variants.find((v) => v.id === m.variant_id && v.product_id === m.product_id && v.business_id === a.p_business_id)
    : seed.products.find((p) => p.id === m.product_id && p.business_id === a.p_business_id);
  if (!row || row.stock + m.change < 0) fail(`STOCK_INSUFICIENTE: ${m.label || 'un artículo'}`);
  row.stock += m.change;
  seed.inventory_movements.push({ business_id: a.p_business_id, product_id: m.product_id, variant_id: m.variant_id || null, type: m.type, quantity_change: m.change, stock_after: row.stock, reference_type: a.p_ref_type, reference_id: a.p_order_id });
}
function editOrderSim(a) {
  if (!['order_edit', 'order_reopen'].includes(a.p_ref_type)) fail('REFERENCIA_INVALIDA');
  const o = seed.orders.find((x) => x.id === a.p_order_id && x.business_id === a.p_business_id);
  if (!o) fail('PEDIDO_NO_ENCONTRADO');
  const items = () => seed.order_items.filter((i) => i.order_id === o.id && i.business_id === a.p_business_id);
  const e = a.p_expected;
  if (e) {
    const its = items();
    const same = (o.status ?? '') === (e.status ?? '') && (o.payment_status || 'pendiente') === (e.payment_status || 'pendiente')
      && Number(o.total_amount) === Number(e.total_amount) && its.length === e.items_count
      && its.reduce((s, i) => s + i.quantity, 0) === e.items_qty && its.reduce((s, i) => s + Number(i.total_price), 0) === Number(e.items_sum);
    if (!same) fail('PEDIDO_MODIFICADO');
  }
  for (const m of a.p_stock || []) {
    if (!['venta', 'devolucion'].includes(m.type)) fail('MOVIMIENTO_INVALIDO');
    adjustStock(a, m);
  }
  if (failAt === 'stock') fail('falla simulada después del stock');
  if (a.p_items) {
    const ids = a.p_items.filter((i) => i.id).map((i) => i.id);
    if (ids.some((id) => !items().find((i) => i.id === id))) fail('LINEA_INVALIDA');
    seed.order_items = seed.order_items.filter((i) => i.order_id !== o.id || ids.includes(i.id));
    for (const i of a.p_items) {
      if (i.id) {
        Object.assign(seed.order_items.find((x) => x.id === i.id), { quantity: i.quantity, unit_price: i.unit_price, total_price: i.quantity * i.unit_price, variant_id: i.variant_id || null, description: i.description });
      } else {
        seed.order_items.push({ id: crypto.randomUUID(), order_id: o.id, business_id: a.p_business_id, product_id: i.product_id, variant_id: i.variant_id || null, description: i.description, quantity: i.quantity, unit_price: i.unit_price, total_price: i.quantity * i.unit_price, bundle_snapshot: i.bundle_snapshot || null });
      }
    }
  }
  if (failAt === 'items') fail('falla simulada después de las líneas');
  Object.assign(o, a.p_order || {}, { updated_at: NOW.toISOString() });
  for (const [table, key] of [['income', 'income'], ['expenses', 'expense']]) {
    const c = a.p_cash?.[key] || {};
    const row = seed[table].find((r) => r.order_id === o.id && r.business_id === a.p_business_id);
    if (c.op === 'set') {
      if (row) row.amount = c.amount;
      else seed[table].push({ id: crypto.randomUUID(), business_id: a.p_business_id, order_id: o.id, amount: c.amount, category: 'productos', description: c.description, date: c.date });
    } else if (c.op === 'delete') seed[table] = seed[table].filter((r) => r !== row);
  }
  if (failAt === 'cash') fail('falla simulada en la Caja');
  const group = crypto.randomUUID();
  for (const ed of a.p_edits || []) {
    seed.order_edits.push({ id: crypto.randomUUID(), business_id: a.p_business_id, order_id: o.id, edit_group: group, user_id: a.p_user, source: a.p_source, field: ed.field, before_value: ed.before ?? null, after_value: ed.after ?? null, created_at: NOW.toISOString() });
  }
  return { edit_group: group };
}
async function rpc(name, a) {
  if (name !== 'edit_order' && name !== 'reopen_order') return { data: null, error: null };
  const backup = clone(seed);
  try {
    if (name === 'reopen_order') {
      const o = seed.orders.find((x) => x.id === a.p_order_id && x.business_id === a.p_business_id);
      if (!o) fail('PEDIDO_NO_ENCONTRADO');
      if (o.status !== 'cancelado') fail('PEDIDO_NO_CANCELADO');
      return { data: editOrderSim({ ...a, p_order: { status: a.p_new_status }, p_items: null, p_ref_type: 'order_reopen' }), error: null };
    }
    return { data: editOrderSim(a), error: null };
  } catch (err) {
    for (const k of Object.keys(backup)) seed[k] = backup[k]; // ROLLBACK
    return { data: null, error: { message: err.message } };
  }
}

// orders.select('*, order_items(*)') → con sus líneas (el helper solo anida por *_id)
function withItems(builder, table) {
  const attach = (r) => {
    if (table !== 'orders' || !r?.data) return r;
    const add = (o) => ({ ...o, order_items: seed.order_items.filter((i) => i.order_id === o.id).map(clone) });
    return { ...r, data: Array.isArray(r.data) ? r.data.map(add) : add(r.data) };
  };
  const proxy = new Proxy(builder, {
    get(t, k) {
      if (k === 'maybeSingle' || k === 'single') return () => t[k]().then(attach);
      if (k === 'then') return (res, rej) => Promise.resolve(t.then((x) => x)).then(attach).then(res, rej);
      const v = t[k];
      return typeof v === 'function' ? (...args) => { const out = v.apply(t, args); return out === t ? proxy : out; } : v;
    },
  });
  return proxy;
}
const db = {
  from: (table) => withItems(fake.from(table), table),
  rpc: (...args) => { fake.calls.push({ rpc: args[0] }); return rpc(...args); },
};

function reset() {
  seed = freshSeed();
  fake = createFakeSupabase(seed);
  failAt = null;
}
reset();
installFakes(db);

const orderEdit = require('../src/services/orderEdit');
const { editOrder, editPreview, getEdits } = require('../src/controllers/orders.controller');
const { call } = require('./helpers/http');

const ctx = { businessId: BIZ, business: TIENDA, userId: U(999), source: 'panel' };
const apply = (id, changes, conf = {}) => orderEdit.applyEdit(ctx, id, changes, { confirm: true, confirm_strong: true, ...conf }, { db, now: NOW });
const preview = (id, changes) => orderEdit.previewEdit(ctx, id, changes, { db, now: NOW });
const order = (id) => seed.orders.find((o) => o.id === id);
const itemsOf = (id) => seed.order_items.filter((i) => i.order_id === id);
const variant = (id) => seed.product_variants.find((v) => v.id === id);
const product = (id) => seed.products.find((p) => p.id === id);
const incomeOf = (id) => seed.income.filter((r) => r.order_id === id);
const expenseOf = (id) => seed.expenses.filter((r) => r.order_id === id);
const keepOld = { id: U(200), quantity: 1 };
async function rejects(promise, status, re) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof orderEdit.EditError, err.message);
    assert.equal(err.status, status, err.message);
    if (re) assert.match(err.message, re);
    return true;
  });
}
// Nada se escribió fuera de la función transaccional (ni stock, ni líneas, ni Caja)
const directWrites = () => fake.calls.filter((c) => c.op && c.op !== 'select');

test('agregar un ítem a un pedido no pagado: baja el stock, recalcula el total y no toca Caja', async () => {
  reset();
  await apply(O_NEW, { items: [{ id: U(201), quantity: 1 }, { product_id: P_TOP, variant_id: V_TOP_S, quantity: 2 }] });
  assert.equal(variant(V_TOP_S).stock, 3);
  assert.equal(order(O_NEW).total_amount, 80000 + 120000);
  const added = itemsOf(O_NEW).find((i) => i.product_id === P_TOP);
  assert.equal(added.unit_price, 60000, 'precio tomado del catálogo en el servidor');
  assert.equal(added.description, 'Top Jana (S)');
  assert.equal(incomeOf(O_NEW).length, 0);
  const mov = seed.inventory_movements.find((m) => m.variant_id === V_TOP_S);
  assert.deepEqual([mov.type, mov.quantity_change, mov.reference_type, mov.reference_id], ['venta', -2, 'order_edit', O_NEW]);
  assert.equal(directWrites().length, 0);
});

test('quitar un ítem devuelve su stock enlazado al pedido', async () => {
  reset();
  await apply(O_NEW, { items: [{ product_id: P_TOP, variant_id: V_TOP_S, quantity: 1 }] });
  assert.equal(product(P_LICRA).stock, 4);
  assert.equal(variant(V_TOP_S).stock, 4);
  assert.equal(itemsOf(O_NEW).length, 1);
  assert.equal(order(O_NEW).total_amount, 60000);
  assert.ok(seed.inventory_movements.some((m) => m.product_id === P_LICRA && m.type === 'devolucion' && m.quantity_change === 1 && m.reference_id === O_NEW));
});

test('cambiar la cantidad mueve solo la diferencia; cambiar la variante devuelve una y saca la otra', async () => {
  reset();
  await apply(O_NEW, { items: [{ id: U(201), quantity: 3 }] });
  assert.equal(product(P_LICRA).stock, 1);
  assert.equal(order(O_NEW).total_amount, 240000);
  assert.equal(itemsOf(O_NEW)[0].id, U(201), 'la línea conserva su id');

  reset();
  seed.product_variants.find((v) => v.id === V_TOP_M).stock = 2;
  await apply(O_OLD, { items: [{ id: U(200), quantity: 1, variant_id: V_TOP_M }] });
  assert.equal(variant(V_TOP_S).stock, 6);
  assert.equal(variant(V_TOP_M).stock, 1);
  assert.equal(itemsOf(O_OLD)[0].description, 'Top Jana (M)');
});

test('sin stock suficiente: avisa (409), no deja negativo y no cambia nada', async () => {
  reset();
  const before = clone(seed);
  await rejects(apply(O_NEW, { items: [{ id: U(201), quantity: 1 }, { product_id: P_TOP, variant_id: V_TOP_M, quantity: 1 }] }), 409, /Stock insuficiente: Top Jana \(M\) \(hay 0, faltan 1\)/);
  const pv = await preview(O_NEW, { items: [{ id: U(201), quantity: 9 }] });
  assert.deepEqual(pv.short, ['Licra Aria (hay 3, faltan 5)']);
  assert.deepEqual(seed, before);
});

test('si el stock se acaba entre la vista previa y el guardado, la transacción lo detecta y revierte todo', async () => {
  reset();
  const plan = await orderEdit.buildEditPlan(ctx, O_NEW, { items: [{ id: U(201), quantity: 3 }] }, { db, now: NOW });
  assert.equal(plan.preview.short.length, 0);
  // Otra venta se lleva el stock: edit_order (adjust_stock) aborta con STOCK_INSUFICIENTE
  product(P_LICRA).stock = 1;
  const before = clone(seed);
  const r = await db.rpc('edit_order', { p_business_id: BIZ, p_order_id: O_NEW, p_expected: plan.expected, p_order: plan.orderPatch, p_items: plan.items, p_stock: plan.stock, p_cash: plan.cash, p_edits: plan.edits, p_ref_type: 'order_edit' });
  assert.match(r.error.message, /STOCK_INSUFICIENTE: Licra Aria/);
  assert.deepEqual(seed, before);
});

test('pedido pagado: el ingreso y el costo se ajustan por la diferencia en su MISMA fila y fecha, sin duplicar', async () => {
  reset();
  await apply(O_OLD, { items: [keepOld, { product_id: P_LICRA, quantity: 1 }] });
  assert.equal(incomeOf(O_OLD).length, 1);
  assert.equal(expenseOf(O_OLD).length, 1);
  assert.deepEqual([incomeOf(O_OLD)[0].id, incomeOf(O_OLD)[0].amount, incomeOf(O_OLD)[0].date], [U(300), 140000, '2026-10-10']);
  assert.deepEqual([expenseOf(O_OLD)[0].id, expenseOf(O_OLD)[0].amount, expenseOf(O_OLD)[0].date], [U(400), 50000, '2026-10-10']);
  // Segunda edición (quitar lo agregado): vuelve al valor original, sigue una sola fila
  await apply(O_OLD, { items: [keepOld] });
  assert.deepEqual([incomeOf(O_OLD).length, incomeOf(O_OLD)[0].amount, expenseOf(O_OLD)[0].amount], [1, 60000, 20000]);
  assert.equal(product(P_LICRA).stock, 3);
});

test('el costo se mueve por la diferencia: un egreso con otro valor histórico se respeta', async () => {
  reset();
  seed.expenses[0].amount = 18000; // costo registrado con el cost_price de octubre
  await apply(O_OLD, { items: [keepOld, { product_id: P_LICRA, quantity: 1 }] });
  assert.equal(expenseOf(O_OLD)[0].amount, 48000);
});

test('no pagado → pagado al editar: crea ingreso y costo con la fecha de hoy; pagado → pendiente los quita', async () => {
  reset();
  await apply(O_NEW, { payment_status: 'pagado', payment_method: 'efectivo' });
  assert.equal(order(O_NEW).payment_status, 'pagado');
  assert.ok(order(O_NEW).paid_at);
  assert.deepEqual([incomeOf(O_NEW).length, incomeOf(O_NEW)[0].amount, incomeOf(O_NEW)[0].date], [1, 80000, '2026-11-25']);
  assert.deepEqual([expenseOf(O_NEW).length, expenseOf(O_NEW)[0].amount], [1, 30000]);
  await apply(O_NEW, { payment_status: 'pendiente' });
  assert.deepEqual([incomeOf(O_NEW).length, expenseOf(O_NEW).length, order(O_NEW).paid_at], [0, 0, null]);
});

test('descuento manual: el valor escrito manda; el descuento por set es solo una sugerencia', async () => {
  reset();
  const pv = await preview(O_OLD, { items: [keepOld, { product_id: P_LICRA, quantity: 1 }] });
  assert.equal(pv.set_discount.amount, Math.round((60000 + 80000) * 0.05), 'sugerencia con setDiscount (top + licra)');
  assert.equal(pv.after.discount, 0, 'la sugerencia no se aplica sola');
  await apply(O_OLD, { items: [keepOld, { product_id: P_LICRA, quantity: 1 }], discount_amount: 10000 });
  assert.equal(order(O_OLD).discount_amount, 10000);
  assert.equal(order(O_OLD).total_amount, 130000);
  assert.equal(incomeOf(O_OLD)[0].amount, 130000);
  await rejects(apply(O_OLD, { discount_amount: 999999 }), 400, /no puede ser mayor/);
  await rejects(apply(O_OLD, { discount_amount: 'diez' }), 400, /entero/);
});

test('envío: costo a mano y sugerencia por zona con la tarifa del negocio', async () => {
  reset();
  const pv = await preview(O_OLD, { shipping_city: 'Medellín' });
  assert.deepEqual([pv.shipping_suggestion.zone, pv.shipping_suggestion.cost], ['nacional', 15000]);
  assert.deepEqual([(await preview(O_OLD, {})).shipping_suggestion.zone], ['cali']);
  await apply(O_OLD, { shipping_cost: 8000, shipping_zone: 'cali' });
  assert.equal(order(O_OLD).total_amount, 68000);
  assert.equal(incomeOf(O_OLD)[0].amount, 68000);
});

test('sets como ítems: agregar uno descuenta cada componente; quitar uno devuelve según su snapshot', async () => {
  reset();
  const { loadBundles, deriveBundle } = require('../src/utils/bundles');
  const b = await loadBundles(db, BIZ, [P_SET]);
  const d = deriveBundle(product(P_SET), b.componentsByBundle[P_SET], b.variantsByProduct);
  const setS = d.variants.find((v) => v.attributes.talla === 'S');
  await apply(O_NEW, { items: [{ id: U(201), quantity: 1 }, { product_id: P_SET, variant_id: setS.id, quantity: 1 }] });
  const line = itemsOf(O_NEW).find((i) => i.product_id === P_SET);
  assert.equal(line.unit_price, 130000);
  assert.equal(line.variant_id, null, 'la línea del set no guarda su variante derivada');
  assert.equal(line.bundle_snapshot.components.length, 2);
  assert.deepEqual([variant(V_TOP_S).stock, product(P_LICRA).stock], [4, 2]);

  reset();
  await apply(O_SET, { items: [{ product_id: P_LICRA, quantity: 1 }] });
  // El set vuelve (Top S + Licra) y sale una Licra suelta: la Licra queda igual
  assert.deepEqual([variant(V_TOP_S).stock, product(P_LICRA).stock], [6, 3]);
  reset();
  await rejects(apply(O_SET, { items: [{ id: U(203), quantity: 1, variant_id: V_TOP_M }] }), 400, /quítalo y agrégalo/);
});

test('cancelado: no se editan ítems ni dinero; sí notas y cliente; reabrir vuelve a tomar stock y Caja', async () => {
  reset();
  await rejects(apply(O_CANCEL, { items: [{ id: U(202), quantity: 2 }] }), 400, /reábrelo/);
  await rejects(apply(O_CANCEL, { discount_amount: 1000 }), 400, /reábrelo/);
  await rejects(apply(O_CANCEL, { status: 'recibido' }), 400, /reábrelo/);
  await apply(O_CANCEL, { notes: 'Cliente pidió factura', client_phone: '3110000000' });
  assert.deepEqual([order(O_CANCEL).notes, order(O_CANCEL).client_phone, order(O_CANCEL).status], ['Cliente pidió factura', '3110000000', 'cancelado']);
  assert.equal(product(P_LICRA).stock, 3);

  await rejects(orderEdit.reopenOrder(ctx, O_CANCEL, { status: 'recibido' }, { db, now: NOW }), 400, /confirmar/);
  await orderEdit.reopenOrder(ctx, O_CANCEL, { status: 'recibido', confirm: true, confirm_strong: true }, { db, now: NOW });
  assert.equal(order(O_CANCEL).status, 'recibido');
  assert.equal(product(P_LICRA).stock, 2);
  assert.ok(seed.inventory_movements.some((m) => m.reference_type === 'order_reopen' && m.quantity_change === -1));
  // Estaba pagado: su ingreso vuelve en su fecha de pago original
  assert.deepEqual([incomeOf(O_CANCEL).length, incomeOf(O_CANCEL)[0].amount, incomeOf(O_CANCEL)[0].date], [1, 80000, '2026-11-01']);
  await rejects(orderEdit.reopenOrder(ctx, O_NEW, { status: 'recibido', confirm: true }, { db, now: NOW }), 400, /Solo se puede reabrir/);
});

test('reabrir sin stock suficiente: avisa y no reabre', async () => {
  reset();
  product(P_LICRA).stock = 0;
  await rejects(orderEdit.reopenOrder(ctx, O_CANCEL, { status: 'recibido', confirm: true, confirm_strong: true }, { db, now: NOW }), 409, /stock insuficiente/);
  assert.equal(order(O_CANCEL).status, 'cancelado');
});

test('cancelar desde la edición devuelve todo el stock y saca el pedido de Caja', async () => {
  reset();
  await apply(O_OLD, { status: 'cancelado' });
  assert.equal(variant(V_TOP_S).stock, 6);
  assert.deepEqual([incomeOf(O_OLD).length, expenseOf(O_OLD).length], [0, 0]);
  reset();
  await rejects(apply(O_OLD, { status: 'cancelado', discount_amount: 5 }), 400, /no cambies a la vez/);
});

test('pedido viejo: número y id intactos, pasa por todos los estados válidos y la fecha se edita', async () => {
  reset();
  const code = orderEdit.orderCode(O_OLD);
  for (const status of ['enviado', 'listo', 'en_proceso', 'recibido', 'entregado']) {
    await apply(O_OLD, { status });
    assert.equal(order(O_OLD).status, status);
  }
  await apply(O_OLD, { created_at: '2026-10-05' });
  assert.equal(order(O_OLD).created_at, '2026-10-05T17:00:00.000Z', 'conserva la hora local, cambia el día');
  assert.equal(orderEdit.orderCode(order(O_OLD).id), code);
  await rejects(apply(O_OLD, { created_at: '2030-01-01' }), 400, /futura/);
  await rejects(apply(O_OLD, { status: 'perdido' }), 400, /Estado inválido/);
});

test('confirmación: sin confirmar no guarda; pagado o de más de 30 días exige la reforzada', async () => {
  reset();
  const changes = { items: [keepOld, { product_id: P_LICRA, quantity: 1 }] };
  await rejects(orderEdit.applyEdit(ctx, O_OLD, changes, {}, { db, now: NOW }), 400, /confirmar/);
  await assert.rejects(orderEdit.applyEdit(ctx, O_OLD, changes, { confirm: true }, { db, now: NOW }), (e) => e.extra.code === 'CONFIRMAR_REFORZADO');
  const pv = await preview(O_OLD, changes);
  assert.deepEqual([pv.is_old, pv.is_paid, pv.strong_confirm], [true, true, true]);
  assert.equal((await preview(O_NEW, { notes: 'x' })).strong_confirm, false);
  await orderEdit.applyEdit(ctx, O_NEW, { notes: 'x' }, { confirm: true }, { db, now: NOW });
  assert.equal(order(O_NEW).notes, 'x');
});

test('si el pedido cambió desde la vista previa, no guarda (409)', async () => {
  reset();
  const pv = await preview(O_NEW, { notes: 'hola' });
  order(O_NEW).total_amount = 1;
  await rejects(apply(O_NEW, { notes: 'hola' }, { expected: pv.expected }), 409, /cambió/);
  assert.equal(order(O_NEW).notes, undefined);
});

test('aislamiento: otro negocio no se ve, sus productos no se pueden agregar y business_id del body se rechaza', async () => {
  reset();
  const before = clone(seed);
  await rejects(apply(O_OTHER, { notes: 'x' }), 404);
  await rejects(apply(O_NEW, { items: [{ id: U(201), quantity: 1 }, { product_id: P_OTHER, quantity: 1 }] }), 400, /no existe en tu tienda/);
  await rejects(apply(O_NEW, { items: [{ id: U(204), quantity: 5 }] }), 400, /no pertenece/);
  await rejects(apply(O_NEW, { business_id: OTHER, notes: 'x' }), 400, /no editable/);
  await rejects(apply(O_NEW, { total_amount: 1 }), 400, /no editable/);
  await rejects(orderEdit.listEdits({ businessId: OTHER }, O_NEW, { db }), 404);
  assert.deepEqual(seed, before);
});

test('validación y sanitización de campos', async () => {
  reset();
  await apply(O_NEW, { client_name: '  Ana\u0007  María ', customer_email: ' ANA@MAIL.COM ', notes: 'línea 1\nlínea 2' });
  assert.deepEqual([order(O_NEW).client_name, order(O_NEW).customer_email, order(O_NEW).notes], ['Ana María', 'ana@mail.com', 'línea 1\nlínea 2']);
  await rejects(apply(O_NEW, { customer_email: 'no-es-correo' }), 400, /correo/);
  await rejects(apply(O_NEW, { items: [] }), 400, /al menos un artículo/);
  await rejects(apply(O_NEW, { items: [{ id: U(201), quantity: 0 }] }), 400, /cantidad/);
  await rejects(apply(O_NEW, { items: [{ id: U(201), quantity: 1, unit_price: -5 }] }), 400, /precio/);
  await rejects(apply(O_NEW, { items: [{ product_id: P_TOP, quantity: 1 }] }), 400, /elige talla y color/);
  await rejects(apply(O_NEW, { payment_method: 'bitcoin' }), 400, /Método de pago/);
  // Precio unitario a mano (validado) y línea libre sin producto (no mueve stock)
  await apply(O_NEW, { items: [{ id: U(201), quantity: 1, unit_price: 70000 }, { description: 'Arreglo', quantity: 1, unit_price: 5000 }] });
  assert.equal(order(O_NEW).total_amount, 75000);
  assert.equal(product(P_LICRA).stock, 3);
});

test('historial: cada guardado deja quién, cuándo, campo y antes → después', async () => {
  reset();
  await apply(O_OLD, { items: [keepOld, { product_id: P_LICRA, quantity: 1 }], discount_amount: 10000 });
  const rows = seed.order_edits.filter((e) => e.order_id === O_OLD);
  const fields = rows.map((e) => e.field).sort();
  assert.deepEqual(fields, ['caja', 'discount_amount', 'items', 'total_amount']);
  const disc = rows.find((e) => e.field === 'discount_amount');
  assert.deepEqual([disc.before_value, disc.after_value, disc.user_id, disc.source], [0, 10000, U(999), 'panel']);
  assert.equal(new Set(rows.map((e) => e.edit_group)).size, 1, 'un guardado = un grupo');
  const caja = rows.find((e) => e.field === 'caja');
  assert.deepEqual([caja.before_value, caja.after_value], [{ ingreso: 60000, costo: 20000 }, { ingreso: 130000, costo: 50000 }]);
  const list = await orderEdit.listEdits(ctx, O_OLD, { db });
  assert.equal(list.edits.length, 4);
  assert.equal(list.edits.find((e) => e.field === 'discount_amount').label, 'Descuento');
  // Sin cambios reales no se registra nada
  await apply(O_OLD, { discount_amount: 10000 });
  assert.equal(seed.order_edits.length, 4);
});

for (const step of ['stock', 'items', 'cash']) {
  test(`fallo a mitad (después de ${step}): se revierte TODO (stock, líneas, pedido y Caja)`, async () => {
    reset();
    const before = clone(seed);
    failAt = step;
    await rejects(apply(O_OLD, { items: [keepOld, { product_id: P_LICRA, quantity: 2 }], discount_amount: 5000 }), 500, /No se cambió nada/);
    assert.deepEqual(seed, before);
    assert.equal(directWrites().length, 0, 'el servicio no escribe nada fuera de la transacción');
  });
}

test('sin la migración 068 avisa claramente y no escribe', async () => {
  reset();
  const noRpc = { from: db.from, rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.edit_order' } }) };
  await rejects(orderEdit.applyEdit(ctx, O_NEW, { notes: 'x' }, { confirm: true }, { db: noRpc, now: NOW }), 503, /migración 068/);
  assert.equal(order(O_NEW).notes, undefined);
});

test('controlador: business del JWT, respuestas y vista previa sin escribir', async () => {
  reset();
  const base = { businessId: BIZ, business: TIENDA, method: 'POST' };
  const before = clone(seed);
  const pv = await call(editPreview, { ...base, params: { id: O_OLD }, body: { changes: { discount_amount: 5000 } } });
  assert.equal(pv.status, 200);
  assert.equal(pv.body.data.after.total, 55000);
  assert.deepEqual(seed, before, 'la vista previa no escribe');
  const other = await call(editOrder, { ...base, businessId: OTHER, params: { id: O_OLD }, body: { changes: { notes: 'x' }, confirm: true } });
  assert.equal(other.status, 404);
  const weak = await call(editOrder, { ...base, params: { id: O_OLD }, body: { changes: { discount_amount: 5000 }, confirm: true } });
  assert.deepEqual([weak.status, weak.body.code], [400, 'CONFIRMAR_REFORZADO']);
  const okr = await call(editOrder, { ...base, params: { id: O_OLD }, body: { changes: { discount_amount: 5000 }, confirm: true, confirm_strong: true } });
  assert.equal(okr.status, 200);
  assert.equal(okr.body.data.total_amount, 55000);
  const hist = await call(getEdits, { ...base, method: 'GET', params: { id: O_OLD } });
  assert.equal(hist.body.data.edits.length, 3);
});

test('empleado: las rutas de edición quedan fuera de su allowlist (403)', async () => {
  const { enforceEmployeeAllowlist } = require('../src/middlewares/roles');
  for (const [method, url] of [['POST', `/api/orders/${O_OLD}/edit`], ['POST', `/api/orders/${O_OLD}/edit/preview`], ['POST', `/api/orders/${O_OLD}/reopen`], ['GET', `/api/orders/${O_OLD}/edits`]]) {
    let code = 200;
    const res = { status(c) { code = c; return res; }, json() { return res; } };
    assert.equal(enforceEmployeeAllowlist({ role: 'employee', method, originalUrl: url }, res), false);
    assert.equal(code, 403);
  }
});

// ── Asistente: editar_pedido usa el mismo servicio, con confirmación reforzada en pedidos pagados o viejos ──
test('asistente: editar_pedido agrega un producto y pone descuento a un pedido viejo con 🔐; sin lógica propia', async () => {
  reset();
  const { createCapabilities } = require('../src/services/storeCapabilities');
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const text = (v, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const vLabel = (v) => Object.values(v.attributes || {}).join(' / ');
  const lib = {
    db, now: () => NOW, ctl: {}, call: async () => ({ code: 500 }), text, norm, dayISO: (d) => d.toISOString().slice(0, 10),
    orderCode: orderEdit.orderCode, cop: (n) => `$${Number(n).toLocaleString('es-CO')}`,
    savePending: async (c, kind, summary, plan) => ({ requiere_confirmacion: true, kind, summary, plan }),
    resolveProduct: async (biz, q) => {
      const hits = seed.products.filter((p) => p.business_id === biz && norm(p.name).includes(norm(q)));
      return hits.length === 1 ? { product: clone(hits[0]) } : { success: false, error: `No encontré "${q}".` };
    },
    resolveVariant: async (biz, p, color, talla) => {
      const vs = seed.product_variants.filter((v) => v.business_id === biz && v.product_id === p.id);
      if (!vs.length) return {};
      const hit = vs.find((v) => norm(v.attributes.talla) === norm(talla));
      return hit ? { variant: clone(hit) } : { needs: 'variante' };
    },
    matchVariants: (vs, c, t) => vs.filter((v) => !t || norm(v.attributes.talla) === norm(t)),
    variantLabel: vLabel, loadProducts: async () => [], loadVariants: async () => [], loadOrders: async () => [], matchProducts: () => [], periodRange: () => ({}),
  };
  const caps = createCapabilities(lib);
  const actx = { businessId: BIZ, business: TIENDA, user: { id: U(998) } };
  const code = orderEdit.orderCode(O_OLD);
  const before = clone(seed);
  const r = await caps.prepare('editar_pedido', { codigo: code, agregar: [{ producto: 'licra aria', cantidad: 1 }], descuento: 10000 }, actx);
  assert.equal(r.requiere_confirmacion, true, JSON.stringify(r));
  assert.match(r.summary, /^🔐 /);
  assert.match(r.summary, /\+1× Licra Aria/);
  assert.match(r.summary, /Total \$60\.000 → \$130\.000/);
  assert.match(r.summary, /Caja \(en su fecha original\): ingreso \$60\.000 → \$130\.000/);
  assert.equal(r.plan.risk, 'R');
  assert.deepEqual(seed, before, 'preparar no escribe');

  const ex = await caps.execute('editar_pedido', { plan: r.plan }, actx);
  assert.equal(ex.ok, true, ex.error);
  assert.deepEqual([order(O_OLD).total_amount, order(O_OLD).discount_amount, incomeOf(O_OLD)[0].amount, product(P_LICRA).stock], [130000, 10000, 130000, 2]);
  assert.ok(seed.order_edits.every((e) => e.source === 'asistente' && e.user_id === U(998)));

  // Quitar y datos del cliente; pedido nuevo no pagado: confirmación normal
  const r2 = await caps.prepare('editar_pedido', { codigo: orderEdit.orderCode(O_NEW), quitar: [{ producto: 'licra' }], agregar: [{ producto: 'top jana', talla: 'S', cantidad: 1 }], cliente: 'Luz Marina' }, actx);
  assert.doesNotMatch(r2.summary, /^🔐/);
  assert.match(r2.summary, /−1× Licra Aria; \+1× Top Jana \(S\); cliente Luz → Luz Marina/);
  // El pedido cambió entre la propuesta y el "sí": no se aplica a ciegas
  order(O_NEW).total_amount = 1;
  const ex2 = await caps.execute('editar_pedido', { plan: r2.plan }, actx);
  assert.equal(ex2.ok, false);
  assert.match(ex2.error, /cambió/);

  // descuento_pedido sobre un pedido entregado pasa por la misma edición
  const r3 = await caps.prepare('descuento_pedido', { codigo: code, descuento: 0 }, actx);
  assert.equal(r3.kind, 'editar_pedido');
  // Sin stock: no propone
  const r4 = await caps.prepare('editar_pedido', { codigo: code, agregar: [{ producto: 'licra aria', cantidad: 50 }] }, actx);
  assert.equal(r4.success, false);
  assert.match(r4.error, /Cada cantidad|No alcanza/);
});
