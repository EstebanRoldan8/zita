// Editar, desactivar y eliminar variantes. Ejecutar: node --test tests/variants.test.js
// Reglas puras + el controlador contra una base en memoria (sin red ni Supabase real).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  sanitizeAttributes, findDuplicate, duplicateMessage, parseMinStock, deleteDecision, attributesKey,
} = require('../src/utils/variantRules');

// ── Reglas puras ─────────────────────────────────────────────────────────────
test('atributos: se limpian y se exige al menos uno', () => {
  assert.deepEqual(sanitizeAttributes({ color: '  Negro ', talla: ' M ' }).attributes, { color: 'Negro', talla: 'M' });
  assert.deepEqual(sanitizeAttributes({ talla: 5 }).attributes, { talla: '5' });
  assert.ok(sanitizeAttributes({}).error);
  assert.ok(sanitizeAttributes({ color: '  ' }).error);
  assert.ok(sanitizeAttributes(null).error);
  assert.ok(sanitizeAttributes(['x']).error);
  assert.ok(sanitizeAttributes({ color: { a: 1 } }).error);
  assert.ok(sanitizeAttributes({ color: 'x'.repeat(41) }).error);
  assert.ok(sanitizeAttributes({ Color: 'a', color: 'b' }).error);
  assert.equal(sanitizeAttributes({ color: 'A\u0000B' }).attributes.color, 'A B');
});

test('duplicado: mismo color y talla sin importar mayúsculas, tildes ni orden', () => {
  const sibs = [{ id: 'v1', attributes: { color: 'Azul Cielo', talla: 'M' }, is_active: true }, { id: 'v2', attributes: { color: 'Verde', talla: 'M' }, is_active: false }];
  assert.equal(findDuplicate({ talla: 'm', color: 'azul  CIELO' }, sibs).id, 'v1');
  assert.equal(findDuplicate({ color: 'Azul Cíelo', talla: 'M' }, sibs).id, 'v1');
  assert.equal(findDuplicate({ color: 'Azul Cielo', talla: 'L' }, sibs), null);
  assert.equal(findDuplicate({ color: 'azul cielo', talla: 'M' }, sibs, 'v1'), null, 'ella misma no cuenta');
  assert.match(duplicateMessage(sibs[1]), /inactiva/);
  assert.equal(attributesKey({ b: 'X', a: 'Y' }), 'a=y|b=x');
});

test('stock mínimo: entero >= 0', () => {
  assert.deepEqual(parseMinStock(undefined), { skip: true });
  assert.deepEqual(parseMinStock('3'), { value: 3 });
  for (const bad of [-1, 1.5, 'x', null, {}]) assert.ok(parseMinStock(bad).error, String(bad));
});

test('eliminar: solo si nunca se usó (sin stock, pedidos ni movimientos)', () => {
  assert.equal(deleteDecision({ stock: 0, orderItems: 0, movements: 0 }).canDelete, true);
  assert.equal(deleteDecision({ stock: 3 }).canDelete, false);
  assert.equal(deleteDecision({ stock: 0, orderItems: 2 }).canDelete, false);
  assert.equal(deleteDecision({ stock: 0, movements: 1 }).canDelete, false);
  assert.match(deleteDecision({ stock: 1, orderItems: 1, movements: 1 }).message, /Desactívala/);
});

// ── Controlador con base en memoria ──────────────────────────────────────────
const BIZ = 'biz-1';
const OTHER = 'biz-2';
let db;
const clone = (o) => JSON.parse(JSON.stringify(o));

function builder(table) {
  const st = { op: 'select', filters: [], payload: null, one: false, order: null };
  const run = () => {
    const rows = db[table];
    const match = (r) => st.filters.every(([k, f, v]) => (f === 'eq' ? r[k] === v : f === 'neq' ? r[k] !== v : v.includes(r[k])));
    if (st.op === 'select') {
      let out = rows.filter(match).map(clone);
      if (st.order) out.sort((a, b) => String(a[st.order]).localeCompare(String(b[st.order])));
      if (st.one) return { data: out[0] || null, error: out[0] ? null : null };
      // select(cols, { count: 'exact', head: true }) como en Supabase: solo el conteo
      if (st.head) return { data: null, count: out.length, error: null };
      return { data: out, count: st.count ? out.length : undefined, error: null };
    }
    if (st.op === 'update') { rows.filter(match).forEach((r) => Object.assign(r, st.payload)); return { data: null, error: null }; }
    if (st.op === 'delete') { const gone = rows.filter(match); db[table] = rows.filter((r) => !match(r)); return { data: gone.map(clone), error: null }; }
    if (st.op === 'insert') { const row = { id: `new-${db[table].length + 1}`, is_active: true, stock: 0, ...st.payload }; rows.push(row); return { data: clone(row), error: null }; }
    return { data: null, error: null };
  };
  const b = {
    select(_cols, opts = {}) { st.count = !!opts.count; st.head = !!opts.head; return b; },
    eq(k, v) { st.filters.push([k, 'eq', v]); return b; },
    neq(k, v) { st.filters.push([k, 'neq', v]); return b; },
    in(k, v) { st.filters.push([k, 'in', v]); return b; },
    order(k) { st.order = k; return b; },
    update(p) { st.op = 'update'; st.payload = p; return b; },
    delete() { st.op = 'delete'; return b; },
    insert(p) { st.op = 'insert'; st.payload = p; return b; },
    single() { st.one = true; const r = run(); return Promise.resolve(r.data ? r : { data: null, error: { message: 'no rows' } }); },
    maybeSingle() { st.one = true; return Promise.resolve(run()); },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  return b;
}

const fake = {
  from: (t) => builder(t),
  rpc: async (name, args) => {
    if (fake.rpcError) return { data: null, error: { message: fake.rpcError } };
    const v = db.product_variants.find((x) => x.id === args.p_variant_id && x.business_id === args.p_business_id);
    if (!v || v.stock + args.p_change < 0) return { data: null, error: { message: 'STOCK_INSUFICIENTE_O_NO_ENCONTRADO' } };
    v.stock += args.p_change;
    db.inventory_movements.push({ business_id: args.p_business_id, variant_id: v.id, type: args.p_type, quantity_change: args.p_change });
    const p = db.products.find((x) => x.id === args.p_product_id);
    p.stock = db.product_variants.filter((x) => x.product_id === p.id && x.is_active).reduce((s, x) => s + x.stock, 0);
    return { data: v.stock, error: null };
  },
};
const supabasePath = require.resolve('../src/config/supabase');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { supabaseAdmin: fake, createUserClient: () => fake } };
const loggerPath = require.resolve('../src/utils/logger');
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: { error() {}, warn() {}, info() {} } };
const ctl = require(path.join('..', 'src', 'controllers', 'productVariants.controller.js'));

function reset() {
  fake.rpcError = null;
  db = {
    products: [
      { id: 'p1', business_id: BIZ, name: 'Top', category: 'Tops', stock: 8, has_variants: true, is_bundle: false },
      { id: 'p2', business_id: OTHER, name: 'Ajeno', category: 'Tops', stock: 1, has_variants: true, is_bundle: false },
      { id: 's1', business_id: BIZ, name: 'Set Top+Licra', is_bundle: true },
    ],
    product_variants: [
      { id: 'va', product_id: 'p1', business_id: BIZ, attributes: { color: 'Negro', talla: 'M' }, stock: 5, is_active: true, sku: 'A' },
      { id: 'vb', product_id: 'p1', business_id: BIZ, attributes: { color: 'Azul', talla: 'S' }, stock: 3, is_active: true, sku: 'B' },
      { id: 'vc', product_id: 'p1', business_id: BIZ, attributes: { color: 'Verde', talla: 'S' }, stock: 0, is_active: true, sku: 'C' },
      { id: 'vd', product_id: 'p1', business_id: BIZ, attributes: { color: 'Rojo', talla: 'S' }, stock: 0, is_active: false, sku: 'D' },
      { id: 'vx', product_id: 'p2', business_id: OTHER, attributes: { color: 'Negro', talla: 'M' }, stock: 0, is_active: true, sku: 'X' },
    ],
    order_items: [],
    inventory_movements: [],
    product_bundle_components: [{ business_id: BIZ, bundle_product_id: 's1', component_product_id: 'p1' }],
  };
}
const call = async (fn, { params = {}, body = {}, query = {}, businessId = BIZ } = {}) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await fn({ params, body, query, businessId, headers: {} }, res);
  return res;
};
const P = (variantId) => ({ productId: 'p1', variantId });

test('pertenencia al negocio: producto o variante de otro negocio → 404 y nada cambia', async () => {
  reset();
  assert.equal((await call(ctl.update, { params: { productId: 'p2', variantId: 'vx' }, body: { sku: 'HACK' } })).code, 404);
  assert.equal((await call(ctl.remove, { params: { productId: 'p2', variantId: 'vx' } })).code, 404);
  assert.equal((await call(ctl.getAll, { params: { productId: 'p2' } })).code, 404);
  // variante de otro producto con el id de un producto propio
  assert.equal((await call(ctl.remove, { params: { productId: 'p1', variantId: 'vx' } })).code, 404);
  // el business_id del body se ignora: el del token manda
  assert.equal((await call(ctl.update, { params: { productId: 'p2', variantId: 'vx' }, body: { business_id: OTHER, sku: 'H' } })).code, 404);
  assert.ok(db.product_variants.find((v) => v.id === 'vx'));
  assert.equal(db.product_variants.find((v) => v.id === 'vx').sku, 'X');
});

test('editar: color, talla, SKU y stock mínimo', async () => {
  reset();
  const r = await call(ctl.update, { params: P('vb'), body: { attributes: { color: 'Azul Rey', talla: 'L' }, sku: 'NUEVO', min_stock: 4 } });
  assert.equal(r.code, 200);
  const v = db.product_variants.find((x) => x.id === 'vb');
  assert.deepEqual(v.attributes, { color: 'Azul Rey', talla: 'L' });
  assert.equal(v.sku, 'NUEVO');
  assert.equal(v.min_stock, 4);
});

test('editar: duplicado (sin mayúsculas ni tildes) → 409; con una inactiva también', async () => {
  reset();
  const dup = await call(ctl.update, { params: P('vb'), body: { attributes: { color: 'NEGRO', talla: 'm' } } });
  assert.equal(dup.code, 409);
  assert.equal(dup.body.code, 'VARIANT_DUPLICATE');
  const dupInactive = await call(ctl.update, { params: P('vb'), body: { attributes: { color: 'rójo', talla: 's' } } });
  assert.equal(dupInactive.code, 409);
  assert.match(dupInactive.body.error, /inactiva/);
  assert.deepEqual(db.product_variants.find((x) => x.id === 'vb').attributes, { color: 'Azul', talla: 'S' });
});

test('crear: el mismo color y talla ya existente → 409', async () => {
  reset();
  const r = await call(ctl.create, { params: { productId: 'p1' }, body: { attributes: { color: 'negro', talla: 'M' }, stock: 0 } });
  assert.equal(r.code, 409);
  assert.equal(db.product_variants.filter((v) => v.product_id === 'p1').length, 4);
  const ok = await call(ctl.create, { params: { productId: 'p1' }, body: { attributes: { color: 'Negro', talla: 'L' }, stock: 0 } });
  assert.equal(ok.code, 201);
});

test('editar: SKU repetido, stock mínimo inválido y cuerpo vacío → 400', async () => {
  reset();
  assert.equal((await call(ctl.update, { params: P('va'), body: { sku: 'B' } })).code, 400);
  assert.equal((await call(ctl.update, { params: P('va'), body: { min_stock: -2 } })).code, 400);
  assert.equal((await call(ctl.update, { params: P('va'), body: {} })).code, 400);
  assert.equal((await call(ctl.update, { params: P('va'), body: { is_active: 'si' } })).code, 400);
});

test('desactivar y activar: recalcula el stock del producto y avisa de los sets', async () => {
  reset();
  const off = await call(ctl.update, { params: P('vb'), body: { is_active: false } });
  assert.equal(off.code, 200);
  assert.equal(db.product_variants.find((x) => x.id === 'vb').is_active, false);
  assert.equal(db.products.find((p) => p.id === 'p1').stock, 5, 'suma solo las activas');
  assert.deepEqual(off.body.affected_sets.map((s) => s.name), ['Set Top+Licra']);
  assert.match(off.body.warning, /Set Top\+Licra/);
  const on = await call(ctl.update, { params: P('vb'), body: { is_active: true } });
  assert.equal(on.code, 200);
  assert.equal(db.products.find((p) => p.id === 'p1').stock, 8);
  assert.equal(on.body.affected_sets, undefined);
});

test('stock: solo por adjust_stock (deja movimiento) y se revisa su { error }', async () => {
  reset();
  const r = await call(ctl.update, { params: P('va'), body: { stock: 9 } });
  assert.equal(r.code, 200);
  assert.equal(r.body.data.stock, 9);
  assert.deepEqual(db.inventory_movements.map((m) => [m.variant_id, m.type, m.quantity_change]), [['va', 'ajuste', 4]]);
  fake.rpcError = 'boom';
  const bad = await call(ctl.update, { params: P('va'), body: { stock: 1 } });
  assert.equal(bad.code, 500);
  assert.equal(db.product_variants.find((x) => x.id === 'va').stock, 9, 'no cambió');
  fake.rpcError = null;
  assert.equal((await call(ctl.update, { params: P('va'), body: { stock: -3 } })).code, 400);
  assert.equal((await call(ctl.update, { params: P('va'), body: { stock: 2.5 } })).code, 400);
});

test('eliminar: una variante nunca usada se borra de verdad', async () => {
  reset();
  const r = await call(ctl.remove, { params: P('vc') });
  assert.equal(r.code, 200);
  assert.equal(db.product_variants.find((x) => x.id === 'vc'), undefined);
  assert.equal(r.body.affected_sets.length, 1);
});

test('eliminar: con stock → 409 y ofrece desactivar', async () => {
  reset();
  const r = await call(ctl.remove, { params: P('va') });
  assert.equal(r.code, 409);
  assert.equal(r.body.code, 'VARIANT_HAS_HISTORY');
  assert.equal(r.body.can_deactivate, true);
  assert.ok(db.product_variants.find((x) => x.id === 'va'));
});

test('eliminar: referenciada por un pedido → 409 aunque no tenga stock', async () => {
  reset();
  db.order_items.push({ business_id: BIZ, variant_id: 'vc', order_id: 'o1' });
  const r = await call(ctl.remove, { params: P('vc') });
  assert.equal(r.code, 409);
  assert.match(r.body.error, /pedido/);
  assert.ok(db.product_variants.find((x) => x.id === 'vc'));
});

test('eliminar: con movimientos de inventario → 409; solo el de creación no cuenta', async () => {
  reset();
  db.inventory_movements.push({ business_id: BIZ, variant_id: 'vc', type: 'venta', quantity_change: -1 });
  assert.equal((await call(ctl.remove, { params: P('vc') })).code, 409);
  reset();
  db.inventory_movements.push({ business_id: BIZ, variant_id: 'vc', type: 'inicial', quantity_change: 0 });
  assert.equal((await call(ctl.remove, { params: P('vc') })).code, 200);
});

test('listado con inactivas: incluye uso y si se puede eliminar', async () => {
  reset();
  db.order_items.push({ business_id: BIZ, variant_id: 'vd', order_id: 'o1' });
  const act = await call(ctl.getAll, { params: { productId: 'p1' } });
  assert.equal(act.body.data.length, 3, 'por defecto solo activas (tienda y ventas)');
  const all = await call(ctl.getAll, { params: { productId: 'p1' }, query: { include_inactive: '1' } });
  assert.equal(all.body.data.length, 4);
  const by = Object.fromEntries(all.body.data.map((v) => [v.id, v.usage]));
  assert.equal(by.vc.can_delete, true);
  assert.equal(by.va.can_delete, false);
  assert.equal(by.vd.can_delete, false);
  assert.equal(by.vd.orders, 1);
});
