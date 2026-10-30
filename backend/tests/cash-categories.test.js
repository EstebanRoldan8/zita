// Caja: el costo de un pedido de tienda ('productos' con order_id) cuenta como costo de ventas, igual que
// 'costo_producto'; editar un egreso automático con su misma categoría se acepta. Ejecutar: node --test tests/cash-categories.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { isCostOfSales, splitExpenses, isValidExpenseCategory } = require('../src/utils/cashCategories');

test('costo de ventas: costo_producto y productos con order_id; lo demás es operativo', () => {
  assert.equal(isCostOfSales({ category: 'costo_producto' }), true);
  assert.equal(isCostOfSales({ category: 'productos', order_id: 'o1' }), true);
  assert.equal(isCostOfSales({ category: 'productos', order_id: null }), false);
  assert.equal(isCostOfSales({ category: 'arriendo' }), false);
  assert.deepEqual(splitExpenses([
    { amount: 100, category: 'productos', order_id: 'o1' }, { amount: 50, category: 'costo_producto' },
    { amount: 30, category: 'arriendo' }, { amount: '20', category: 'otro' },
  ]), { costoVentas: 150, egresosOperativos: 50 });
});

test('editar: categorías del panel, o la automática que ya tenía', () => {
  assert.equal(isValidExpenseCategory('arriendo', { category: 'productos' }), true);
  assert.equal(isValidExpenseCategory('productos', { category: 'productos' }), true);
  assert.equal(isValidExpenseCategory('costo_producto', { category: 'costo_producto' }), true);
  assert.equal(isValidExpenseCategory('productos', { category: 'arriendo' }), false);
  assert.equal(isValidExpenseCategory('productos', null), false);
  assert.equal(isValidExpenseCategory('inventada', { category: 'inventada' }), false);
});

// ── Controlador con base en memoria ──
const rows = {
  income: [{ business_id: 'b1', amount: 300, date: '2026-10-05' }, { business_id: 'b2', amount: 999, date: '2026-10-05' }],
  expenses: [
    { id: 'e1', business_id: 'b1', amount: 120, category: 'productos', order_id: 'o1', date: '2026-10-05' },
    { id: 'e2', business_id: 'b1', amount: 40, category: 'arriendo', order_id: null, date: '2026-10-06' },
    { id: 'e3', business_id: 'b2', amount: 500, category: 'productos', order_id: 'o9', date: '2026-10-05' },
  ],
  monthly_goals: [],
};
function q(table) {
  const f = []; let op = 'select'; let payload = null;
  const run = () => {
    const match = (r) => f.every(([k, o, v]) => (o === 'eq' ? r[k] === v : o === 'gte' ? String(r[k]) >= v : o === 'lte' ? String(r[k]) <= v : true));
    if (op === 'update') { const hit = rows[table].filter(match); hit.forEach((r) => Object.assign(r, payload)); return { data: hit[0] || null, error: null }; }
    return { data: rows[table].filter(match), error: null };
  };
  const b = {
    select() { return b; }, eq(k, v) { f.push([k, 'eq', v]); return b; }, gte(k, v) { f.push([k, 'gte', v]); return b; }, lte(k, v) { f.push([k, 'lte', v]); return b; },
    update(p) { op = 'update'; payload = p; return b; },
    maybeSingle() { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: null }); },
    single() { return b.maybeSingle(); },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  return b;
}
const fake = { from: q };
const supaPath = require.resolve('../src/config/supabase');
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { supabaseAdmin: fake, createUserClient: () => fake } };
const loggerPath = require.resolve('../src/utils/logger');
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: { info() {}, warn() {}, error() {} } };
const cash = require('../src/controllers/cash.controller');
const call = async (fn, req) => {
  let status = 200; let out;
  const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; }, set() { return res; } };
  await fn({ headers: {}, query: {}, params: {}, body: {}, businessId: 'b1', business: { plan: 'estandar', country: 'CO' }, ...req }, res);
  return { status, body: out };
};

test('resumen de Caja: el costo del pedido va a costo de ventas; ganancia y margen no cambian; solo el negocio de la sesión', async () => {
  const r = await call(cash.getSummary, { query: { month: '2026-10' } });
  assert.equal(r.status, 200);
  const d = r.body.data;
  assert.equal(d.income_total, 300);
  assert.equal(d.costo_ventas, 120);
  assert.equal(d.egresos_operativos, 40);
  assert.equal(d.ganancia_neta, 140);
  assert.equal(d.margen_porcentaje, 47);
});

test('editar un egreso automático con su categoría "productos" ya no da "Categoría inválida"', async () => {
  const ok = await call(cash.updateExpense, { params: { id: 'e1' }, body: { amount: 130, category: 'productos', description: 'Costo pedido' } });
  assert.equal(ok.status, 200);
  assert.equal(rows.expenses[0].amount, 130);
  const bad = await call(cash.updateExpense, { params: { id: 'e2' }, body: { category: 'productos' } });
  assert.equal(bad.status, 400);
});
