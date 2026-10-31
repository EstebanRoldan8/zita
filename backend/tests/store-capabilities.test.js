// Capacidades nuevas del asistente de tienda (registro storeCapabilities): Caja, pedidos, productos, sets, clientes,
// equipo, configuración, reportes y fuera de alcance. Campos faltantes, ambigüedad, confirmación normal y reforzada,
// deshacer, error del controlador, aislamiento entre negocios y permisos del plan.
// Base en memoria, controladores simulados con las mismas reglas del panel y modelo simulado.
// Ejecutar: node --test tests/store-capabilities.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const { createStoreAssistant } = require('../src/services/assistantStore');
const { createStoreAgent, domainsOf, interpretFor, INTERPRET_PROMPT } = require('../src/services/storeAgent');

const BIZ = 'biz-flow';
const OTHER = 'biz-otra';
const clone = (o) => JSON.parse(JSON.stringify(o));
let db;
let seq = 0;
let failNext = null; // nombre del controlador que debe fallar una vez

function q(table) {
  const st = { op: 'select', f: [], payload: null, one: false, limit: null, order: null, head: false };
  const match = (r) => st.f.every(([k, op, v]) => (op === 'eq' ? r[k] === v : op === 'neq' ? r[k] !== v : op === 'in' ? v.includes(r[k])
    : op === 'gte' ? String(r[k]) >= String(v) : op === 'lte' ? String(r[k]) <= String(v) : true));
  const run = () => {
    if (st.op === 'insert') { const row = { id: `${table}-${++seq}`, created_at: new Date(fake.clock.getTime() + seq).toISOString(), ...clone(st.payload) }; db[table].push(row); return { data: clone(row), error: null }; }
    if (st.op === 'update') { db[table].filter(match).forEach((r) => Object.assign(r, clone(st.payload))); return { data: null, error: null }; }
    let rows = (db[table] || []).filter(match).map(clone);
    if (st.order) rows.sort((a, b) => (st.order.asc ? 1 : -1) * String(a[st.order.k] || '').localeCompare(String(b[st.order.k] || '')));
    if (st.limit) rows = rows.slice(0, st.limit);
    if (st.head) return { data: null, count: rows.length, error: null };
    return st.one ? { data: rows[0] || null, error: null } : { data: rows, error: null };
  };
  const b = {
    select(_c, o = {}) { st.head = !!o.head; return b; }, eq(k, v) { st.f.push([k, 'eq', v]); return b; }, neq(k, v) { st.f.push([k, 'neq', v]); return b; },
    in(k, v) { st.f.push([k, 'in', v]); return b; }, gte(k, v) { st.f.push([k, 'gte', v]); return b; }, lte(k, v) { st.f.push([k, 'lte', v]); return b; },
    order(k, o = {}) { st.order = { k, asc: o.ascending !== false }; return b; }, limit(n) { st.limit = n; return b; },
    insert(p) { st.op = 'insert'; st.payload = p; return b; }, update(p) { st.op = 'update'; st.payload = p; return b; },
    single() { st.one = true; return Promise.resolve(run()); }, maybeSingle() { st.one = true; return Promise.resolve(run()); },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  return b;
}
const fake = {
  clock: new Date('2026-10-28T20:00:00Z'),
  now: () => new Date(fake.clock),
  from: (t) => q(t),
  rpc: async (name, a) => {
    const v = a.p_variant_id ? db.product_variants.find((x) => x.id === a.p_variant_id && x.business_id === a.p_business_id) : db.products.find((x) => x.id === a.p_product_id && x.business_id === a.p_business_id);
    if (!v || v.stock + a.p_change < 0) return { data: null, error: { message: 'STOCK_INSUFICIENTE_O_NO_ENCONTRADO' } };
    v.stock += a.p_change;
    return { data: v.stock, error: null };
  },
};

// ── Controladores simulados (mismas validaciones relevantes que el panel; siempre por req.businessId) ──
const calls = [];
const guard = (name, fn) => async (req, res) => {
  calls.push({ name, businessId: req.businessId, body: clone(req.body || {}), params: clone(req.params || {}), query: clone(req.query || {}) });
  if (failNext === name) { failNext = null; return res.status(500).json({ success: false, error: 'Error interno del servidor.' }); }
  return fn(req, res);
};
const mine = (rows, req) => rows.filter((r) => r.business_id === req.businessId);
const inMonth = (rows, req) => {
  const qy = req.query || {};
  if (qy.month) return rows.filter((r) => r.date.startsWith(qy.month));
  if (qy.period === 'day') return rows.filter((r) => r.date === qy.date);
  return rows;
};
const INC = ['servicios', 'productos', 'otro'];
const EXP = ['nomina', 'materias_primas', 'servicios', 'arriendo', 'otro'];
const lite = (req) => req.business?.plan === 'lite';
const controllers = {
  cash: {
    getSummary: guard('cash.getSummary', async (req, res) => {
      const inc = inMonth(mine(db.income, req), req).reduce((s, r) => s + r.amount, 0);
      if (lite(req)) return res.json({ success: true, data: { ingresos: inc } });
      const exp = inMonth(mine(db.expenses, req), req);
      const cost = exp.filter((r) => r.category === 'costo_producto' || (r.category === 'productos' && r.order_id)).reduce((s, r) => s + r.amount, 0);
      const total = exp.reduce((s, r) => s + r.amount, 0);
      return res.json({ success: true, data: { income_total: inc, expense_total: total, costo_ventas: cost, egresos_operativos: total - cost, net: inc - total, ganancia_neta: inc - total, margen_porcentaje: inc ? Math.round(((inc - total) / inc) * 100) : 0 } });
    }),
    getIncome: guard('cash.getIncome', async (req, res) => res.json({ success: true, data: inMonth(mine(db.income, req), req) })),
    getExpenses: guard('cash.getExpenses', async (req, res) => res.json({ success: true, data: inMonth(mine(db.expenses, req), req) })),
    createIncome: guard('cash.createIncome', async (req, res) => {
      if (!INC.includes(req.body.category)) return res.status(400).json({ success: false, error: 'Categoría inválida.' });
      const row = { id: `inc-${++seq}`, business_id: req.businessId, source: 'manual', order_id: null, ...req.body };
      db.income.push(row); return res.status(201).json({ success: true, data: row });
    }),
    createExpense: guard('cash.createExpense', async (req, res) => {
      if (lite(req)) return res.status(403).json({ success: false, error: 'Esta función requiere el plan Estándar o superior' });
      if (!EXP.includes(req.body.category)) return res.status(400).json({ success: false, error: 'Categoría inválida.' });
      const row = { id: `exp-${++seq}`, business_id: req.businessId, order_id: null, ...req.body };
      db.expenses.push(row); return res.status(201).json({ success: true, data: row });
    }),
    updateExpense: guard('cash.updateExpense', async (req, res) => { const r = mine(db.expenses, req).find((x) => x.id === req.params.id); if (!r) return res.status(404).json({ success: false, error: 'Egreso no encontrado.' }); Object.assign(r, req.body); return res.json({ success: true, data: r }); }),
    updateIncome: guard('cash.updateIncome', async (req, res) => { const r = mine(db.income, req).find((x) => x.id === req.params.id); if (!r) return res.status(404).json({ success: false, error: 'Ingreso no encontrado.' }); Object.assign(r, req.body); return res.json({ success: true, data: r }); }),
    deleteExpense: guard('cash.deleteExpense', async (req, res) => { const n = db.expenses.length; db.expenses = db.expenses.filter((x) => !(x.id === req.params.id && x.business_id === req.businessId)); return n === db.expenses.length ? res.status(404).json({ success: false, error: 'Egreso no encontrado.' }) : res.json({ success: true }); }),
    deleteIncome: guard('cash.deleteIncome', async (req, res) => { const n = db.income.length; db.income = db.income.filter((x) => !(x.id === req.params.id && x.business_id === req.businessId)); return n === db.income.length ? res.status(404).json({ success: false, error: 'Ingreso no encontrado.' }) : res.json({ success: true }); }),
  },
  settings: {
    getGoal: guard('settings.getGoal', async (req, res) => res.json({ success: true, data: mine(db.monthly_goals, req)[0] || null })),
    updateGoal: guard('settings.updateGoal', async (req, res) => { const g = mine(db.monthly_goals, req)[0]; if (g) g.income_goal = req.body.income_goal; else db.monthly_goals.push({ business_id: req.businessId, month: req.body.month, income_goal: req.body.income_goal }); return res.json({ success: true }); }),
    updateProfile: guard('settings.updateProfile', async (req, res) => { const b = db.businesses.find((x) => x.id === req.businessId); Object.assign(b, req.body); return res.json({ success: true, data: b }); }),
    updateWhatsappNotify: guard('settings.updateWhatsappNotify', async (req, res) => { db.businesses.find((x) => x.id === req.businessId).whatsapp_notify = req.body.whatsapp_notify; return res.json({ success: true }); }),
  },
  businesses: { updateModules: guard('businesses.updateModules', async (req, res) => { db.businesses.find((x) => x.id === req.businessId).modules = req.body.modules; return res.json({ success: true }); }) },
  products: {
    create: guard('products.create', async (req, res) => { const p = { id: `p-${++seq}`, business_id: req.businessId, is_active: true, is_bundle: false, has_variants: false, cost_price: null, min_stock: 2, ...req.body, stock: req.body.stock || 0 }; db.products.push(p); return res.status(201).json({ success: true, data: p }); }),
    update: guard('products.update', async (req, res) => { const p = mine(db.products, req).find((x) => x.id === req.params.id); if (!p) return res.status(404).json({ success: false, error: 'Producto no encontrado.' }); Object.assign(p, req.body); return res.json({ success: true, data: p }); }),
    toggleProduct: guard('products.toggleProduct', async (req, res) => { const p = mine(db.products, req).find((x) => x.id === req.params.id); p.is_active = !p.is_active; return res.json({ success: true }); }),
    deleteProduct: guard('products.deleteProduct', async (req, res) => { db.products = db.products.filter((x) => !(x.id === req.params.id && x.business_id === req.businessId)); return res.json({ success: true }); }),
  },
  variants: {
    create: guard('variants.create', async (req, res) => { const v = { id: `v-${++seq}`, product_id: req.params.productId, business_id: req.businessId, attributes: req.body.attributes, stock: req.body.stock || 0, is_active: true }; db.product_variants.push(v); const p = db.products.find((x) => x.id === req.params.productId); p.has_variants = true; p.stock = db.product_variants.filter((x) => x.product_id === p.id).reduce((s, x) => s + x.stock, 0); return res.status(201).json({ success: true, data: v }); }),
    update: guard('variants.update', async (req, res) => { const v = mine(db.product_variants, req).find((x) => x.id === req.params.variantId); Object.assign(v, req.body); return res.json({ success: true, data: v }); }),
    remove: guard('variants.remove', async (req, res) => res.status(409).json({ success: false, error: 'No se puede eliminar: tiene 3 unidades en stock. Desactívala para que deje de venderse.' })),
  },
  orders: {
    create: guard('orders.create', async (req, res) => res.status(201).json({ success: true, data: { id: 'x' } })),
    updateStatus: guard('orders.updateStatus', async (req, res) => { const o = mine(db.orders, req).find((x) => x.id === req.params.id); o.status = req.body.status; return res.json({ success: true }); }),
    updatePayment: guard('orders.updatePayment', async (req, res) => { const o = mine(db.orders, req).find((x) => x.id === req.params.id); Object.assign(o, req.body); return res.json({ success: true, data: o }); }),
    updateShipping: guard('orders.updateShipping', async (req, res) => { const o = mine(db.orders, req).find((x) => x.id === req.params.id); Object.assign(o, req.body); return res.json({ success: true, data: o }); }),
    updateDiscount: guard('orders.updateDiscount', async (req, res) => { const o = mine(db.orders, req).find((x) => x.id === req.params.id); o.total_amount += o.discount_amount - req.body.discount_amount; o.discount_amount = req.body.discount_amount; return res.json({ success: true, data: o }); }),
    deleteOrder: guard('orders.deleteOrder', async (req, res) => { db.orders = db.orders.filter((x) => !(x.id === req.params.id && x.business_id === req.businessId)); return res.json({ success: true }); }),
  },
  clients: {
    create: guard('clients.create', async (req, res) => { if (!req.body.name || !req.body.phone) return res.status(400).json({ success: false, error: 'name y phone son obligatorios.' }); const c = { id: `c-${++seq}`, business_id: req.businessId, ...req.body }; db.clients.push(c); return res.status(201).json({ success: true, data: c }); }),
    update: guard('clients.update', async (req, res) => { const c = mine(db.clients, req).find((x) => x.id === req.params.id); Object.assign(c, req.body); return res.json({ success: true, data: c }); }),
    // Como el panel: archiva (soft-delete)
    destroy: guard('clients.destroy', async (req, res) => { const c = mine(db.clients, req).find((x) => x.id === req.params.id); if (!c) return res.status(404).json({ success: false, error: 'Cliente no encontrado.' }); c.archived = true; return res.json({ success: true }); }),
    recallClient: guard('clients.recallClient', async (req, res) => res.json({ success: true })),
  },
  employees: {
    create: guard('employees.create', async (req, res) => { const e = { id: `e-${++seq}`, business_id: req.businessId, is_active: true, ...req.body }; db.employees.push(e); return res.status(201).json({ success: true, data: e }); }),
    update: guard('employees.update', async (req, res) => { const e = mine(db.employees, req).find((x) => x.id === req.params.id); Object.assign(e, req.body); return res.json({ success: true, data: e }); }),
    deleteEmployee: guard('employees.deleteEmployee', async (req, res) => { db.employees = db.employees.filter((x) => x.id !== req.params.id); return res.json({ success: true }); }),
  },
  bundles: {
    create: guard('bundles.create', async (req, res) => { const s = { id: `set-${++seq}`, business_id: req.businessId, name: req.body.name, price: req.body.price, is_bundle: true, is_active: true, stock: 0 }; db.products.push(s); return res.status(201).json({ success: true, data: s }); }),
    update: guard('bundles.update', async (req, res) => { const s = mine(db.products, req).find((x) => x.id === req.params.id); Object.assign(s, { ...(req.body.price ? { price: req.body.price } : {}), ...(req.body.name ? { name: req.body.name } : {}) }); return res.json({ success: true, data: s }); }),
  },
};

const ORDER_ID = '1a2b3c4d-0000-4000-8000-000000000001';
function reset() {
  seq = 0; calls.length = 0; modelCalls.length = 0; replies.length = 0; failNext = null; fake.clock = new Date('2026-10-28T20:00:00Z');
  const P = (id, name, category, price, extra = {}) => ({ id, business_id: BIZ, name, category, price, cost_price: 40000, stock: 0, min_stock: 1, gender: 'mujer', is_active: true, is_bundle: false, has_variants: true, ...extra });
  const V = (id, product, color, talla, stock, extra = {}) => ({ id, product_id: product, business_id: BIZ, attributes: { color, talla }, stock, is_active: true, ...extra });
  db = {
    products: [
      P('la', 'Licra Aria', 'Licras', 119900, { cost_price: 83306, stock: 4 }), P('lj', 'Licra Jana', 'Licras', 119900, { cost_price: 83306 }),
      P('ta', 'Top Aria', 'Tops', 59900, { cost_price: 39859 }), P('sn', 'Short Nila', 'Shorts', 84900, { cost_price: 42476 }),
      { id: 'ajeno', business_id: OTHER, name: 'Licra Aria', category: 'Licras', price: 1, stock: 9, is_active: true, is_bundle: false },
    ],
    product_variants: [V('la-negro-m', 'la', 'Negro', 'M', 4), V('ta-negro-s', 'ta', 'Negro', 'S', 3)],
    income: [
      { id: 'inc-pedido', business_id: BIZ, amount: 119900, category: 'productos', source: 'order', order_id: ORDER_ID, description: 'Pedido: Ana', date: '2026-10-28' },
      { id: 'inc-ajeno', business_id: OTHER, amount: 50000, category: 'otro', source: 'manual', order_id: null, description: 'bolsas', date: '2026-10-28' },
    ],
    expenses: [
      { id: 'exp-pedido', business_id: BIZ, amount: 83306, category: 'productos', order_id: ORDER_ID, description: 'Costo de venta', date: '2026-10-28' },
      { id: 'exp-ajeno', business_id: OTHER, amount: 50000, category: 'materias_primas', order_id: null, description: 'bolsas', date: '2026-10-28' },
    ],
    orders: [{ id: ORDER_ID, business_id: BIZ, status: 'recibido', client_name: 'Ana', total_amount: 119900, discount_amount: 0, shipping_cost: 0, payment_status: 'pendiente', payment_method: null, created_at: '2026-10-20T15:00:00Z' }],
    order_items: [], clients: [{ id: 'cli-ana', business_id: BIZ, name: 'Ana Gómez', phone: '3001234567' }, { id: 'cli-ajena', business_id: OTHER, name: 'Ana Gómez', phone: '3009999999' }],
    employees: [], monthly_goals: [], assistant_actions: [], inventory_movements: [], product_bundle_components: [],
    businesses: [{ id: BIZ, name: 'FLOW', owner_name: 'Dueña', phone: '3170000000', address: 'Cali', modules: { clientes: true }, whatsapp_notify: false, store_settings: {} }],
  };
}

const modelCalls = [];
const replies = [];
const toolReply = (input) => ({ content: [{ type: 'tool_use', id: `tu-${++seq}`, name: 'interpretar', input }], usage: { input_tokens: 900, output_tokens: 60 } });
const callModel = async (params, caps) => { modelCalls.push({ params: clone(params), caps }); return replies.shift() || { content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 900, output_tokens: 5 } }; };
const store = createStoreAssistant({ db: fake, controllers, now: fake.now, catalogFor: async () => null });
const agent = createStoreAgent({ store, callModel });
const say = async (msg, { plan = 'estandar', businessId = BIZ } = {}) => {
  fake.clock = new Date(fake.clock.getTime() + 60000);
  return agent.handle({ businessId, business: { name: 'FLOW', business_type: 'Tienda', slug: 'flow', plan }, userMessage: msg, history: [], authorization: 'Bearer u', model: 'claude-haiku-4-5-20251001' });
};
const intent = (x) => replies.push(toolReply(x));
const acts = (...a) => intent({ tipo: 'acciones', acciones: a });
const applied = (kind) => db.assistant_actions.filter((a) => a.kind === kind && a.status === 'applied');

// ── Contexto mínimo por tema ──
test('el modelo recibe solo las capacidades del tema del mensaje', () => {
  assert.deepEqual(domainsOf('gaste 50mil en bolsas'), ['caja']);
  assert.deepEqual(domainsOf('llegaron 3 top jana'), []);
  const caja = interpretFor(['caja'], store.caps());
  assert.ok(caja.acciones.includes('registrar_egreso') && !caja.acciones.includes('crear_cliente'));
  assert.ok(caja.consultas.includes('caja_resumen'));
  const base = interpretFor([], store.caps());
  assert.ok(!base.acciones.includes('registrar_egreso'), 'sin tema: solo las acciones de siempre');
  assert.ok(caja.block.length < 2200 && INTERPRET_PROMPT.length < 4000, 'bloques cortos');
});

// ── Caja ──
test('egreso: "gasté 50mil en bolsas" → categoría por palabra clara, neto antes → después, confirmar, deshacer', async () => {
  reset();
  acts({ accion: 'registrar_egreso', monto: 50000, descripcion: 'bolsas', metodo: 'efectivo' });
  const r = await say('gaste 50mil en bolsas en efectivo');
  assert.match(r.response, /Registrar egreso de \$50\.000 · Materias primas · «bolsas · pago: efectivo» · hoy\. Neto de octubre 2026: \$36\.594 → -\$13\.406/);
  assert.match(modelCalls[0].params.system[1].text, /CAJA/);
  const ok = await say('sí');
  assert.match(ok.response, /egreso de \$50\.000 registrado · neto de octubre 2026 \$36\.594 → -\$13\.406/);
  const row = db.expenses.find((x) => x.description === 'bolsas · pago: efectivo');
  assert.equal(row.business_id, BIZ);
  assert.equal(row.category, 'materias_primas');
  assert.equal(applied('registrar_egreso').length, 1);
  const u = await say('devuélvelo como estaba');
  assert.match(u.response, /borrar el egreso de \$50\.000/);
  await say('sí');
  assert.equal(db.expenses.some((x) => x.id === row.id), false);
});

test('ingreso: "entraron 200 en efectivo" → pregunta si son miles y la categoría; solo después propone', async () => {
  reset();
  acts({ accion: 'registrar_ingreso', monto: 200, metodo: 'efectivo' });
  const r = await say('entraron 200 en efectivo');
  assert.match(r.response, /¿El ingreso fue de \$200\.000 o de \$200\?[\s\S]*1\. \$200\.000/);
  const r2 = await say('1');
  assert.match(r2.response, /¿En qué categoría de Caja va este ingreso\?[\s\S]*1\. Productos \(ventas\)/);
  const r3 = await say('1');
  assert.match(r3.response, /Registrar ingreso de \$200\.000 · Productos · «pago: efectivo» · hoy/);
  await say('dale');
  assert.equal(db.income.filter((x) => x.business_id === BIZ && x.amount === 200000).length, 1);
});

test('campos faltantes y plan Lite: sin monto explica; Lite no registra egresos', async () => {
  reset();
  acts({ accion: 'registrar_egreso', descripcion: 'arriendo' });
  assert.match((await say('pagué el arriendo')).response, /Dime el monto del egreso/);
  acts({ accion: 'registrar_egreso', monto: 50000, descripcion: 'bolsas' });
  assert.match((await say('gaste 50mil en bolsas', { plan: 'lite' })).response, /plan Lite no incluye egresos/);
  assert.equal(calls.filter((c) => c.name === 'cash.createExpense').length, 0);
});

test('editar un egreso es reforzado: "sí" no basta, "confirmo" sí; deshacer lo deja como estaba', async () => {
  reset();
  db.expenses.push({ id: 'exp-bolsas', business_id: BIZ, amount: 50000, category: 'materias_primas', order_id: null, description: 'bolsas', date: '2026-10-27' });
  acts({ accion: 'editar_movimiento', tipo_mov: 'egreso', buscar: 'bolsas', nuevo_monto: 60000 });
  const r = await say('corrige el gasto de bolsas, fueron 60 mil');
  assert.match(r.response, /🔐 Editar el egreso de \$50\.000 «bolsas» del ayer: monto \$50\.000 → \$60\.000\. Neto de octubre 2026: -\$13\.406 → -\$23\.406/);
  assert.match(r.response, /escribe «confirmo»/);
  const yes = await say('sí');
  assert.match(yes.response, /🔐 Es una acción delicada/);
  assert.equal(db.expenses.find((x) => x.id === 'exp-bolsas').amount, 50000);
  await say('confirmo');
  assert.equal(db.expenses.find((x) => x.id === 'exp-bolsas').amount, 60000);
  await say('devuélvelo como estaba');
  await say('sí');
  assert.equal(db.expenses.find((x) => x.id === 'exp-bolsas').amount, 50000);
});

test('un movimiento de pedido no se edita ni se borra desde el asistente: se dirige al pedido', async () => {
  reset();
  acts({ accion: 'anular_movimiento', tipo_mov: 'egreso', monto: 83306 });
  assert.match((await say('borra el egreso de 83306')).response, /viene del pedido P-1A2B3C4D: se cambia desde el pedido/);
  assert.ok(db.expenses.some((x) => x.id === 'exp-pedido'));
});

test('aislamiento: el movimiento de otro negocio no aparece ni se toca', async () => {
  reset();
  acts({ accion: 'anular_movimiento', tipo_mov: 'egreso', buscar: 'bolsas' });
  assert.match((await say('borra el gasto de bolsas')).response, /No encontré ese movimiento/);
  assert.ok(db.expenses.some((x) => x.id === 'exp-ajeno'));
  assert.ok(calls.every((c) => c.businessId === BIZ));
});

test('"¿cuánto hay en caja hoy?" sin modelo: mismo resumen del panel y aclara que no es un saldo', async () => {
  reset();
  const r = await say('cuanto hay en caja hoy');
  assert.equal(modelCalls.length, 0);
  assert.match(r.response, /Caja hoy: ingresos \$119\.900 · egresos \$83\.306 \(costo de ventas \$83\.306, operativos \$0\) → neto \$36\.594/);
  assert.match(r.response, /no un saldo ni un arqueo/);
  assert.equal(calls[0].name, 'cash.getSummary');
});

test('"¿cuánto gasté este mes en bolsas?" lista y suma solo esos egresos', async () => {
  reset();
  db.expenses.push({ id: 'e1', business_id: BIZ, amount: 50000, category: 'materias_primas', order_id: null, description: 'bolsas', date: '2026-10-10' }, { id: 'e2', business_id: BIZ, amount: 20000, category: 'materias_primas', order_id: null, description: 'bolsas negras', date: '2026-10-12' });
  intent({ tipo: 'consulta', consulta: { tipo: 'caja_movimientos', tipo_mov: 'egreso', texto: 'bolsas', periodo: 'mes' } });
  const r = await say('cuanto gaste este mes en bolsas');
  assert.match(r.response, /Gastaste \$70\.000 en «bolsas» en octubre 2026 \(2 movimientos\)/);
});

test('error del controlador: se informa FALLÓ, no queda "aplicado"', async () => {
  reset();
  acts({ accion: 'registrar_egreso', monto: 50000, descripcion: 'bolsas' });
  await say('gaste 50mil en bolsas');
  failNext = 'cash.createExpense';
  const r = await say('sí');
  assert.match(r.response, /FALLÓ: Error interno del servidor/);
  assert.equal(applied('registrar_egreso').length, 0);
});

test('meta mensual: propone antes → después y "cómo voy" sin modelo', async () => {
  reset();
  acts({ accion: 'meta_mensual', monto: 5000000 });
  assert.match((await say('pon la meta del mes en 5 millones')).response, /Meta de ingresos de octubre 2026: sin meta → \$5\.000\.000/);
  await say('sí');
  const r = await say('como voy con la meta');
  assert.match(r.response, /Meta de octubre 2026: \$5\.000\.000 · llevas \$119\.900 \(2%\)/);
});

// ── Pedidos ──
test('pedido: pago, descuento y eliminar (reforzado)', async () => {
  reset();
  acts({ accion: 'pago_pedido', codigo: 'p-1a2b3c4d', pago: 'pagado', metodo: 'nequi' });
  assert.match((await say('el p-1a2b3c4d ya pago por nequi')).response, /Pago del pedido P-1A2B3C4D \(Ana, \$119\.900\): pendiente → pagado \(nequi\) \(entra a Caja\)/);
  await say('sí');
  assert.equal(db.orders[0].payment_status, 'pagado');
  acts({ accion: 'descuento_pedido', codigo: 'P-1A2B3C4D', descuento: 10000 });
  assert.match((await say('ponle 10 mil de descuento al P-1A2B3C4D')).response, /Descuento del pedido P-1A2B3C4D .*: \$0 → \$10\.000 \(total \$119\.900 → \$109\.900\)/);
  await say('sí');
  assert.equal(db.orders[0].total_amount, 109900);
  acts({ accion: 'eliminar_pedido', codigo: 'P-1A2B3C4D' });
  assert.match((await say('elimina el pedido P-1A2B3C4D')).response, /🔐 Eliminar del todo el pedido P-1A2B3C4D/);
  await say('sí');
  assert.equal(db.orders.length, 1, 'un «sí» no borra');
  await say('confirmo');
  assert.equal(db.orders.length, 0);
});

// ── Productos ──
test('crear producto con variante y stock inicial (stock por el controlador del panel); deshacer lo elimina', async () => {
  reset();
  acts({ accion: 'crear_producto', nombre: 'short prueba', precio: 80000, variantes: [{ color: 'negro', talla: 's', cantidad: 3 }] });
  const r = await say('crea un producto short prueba negro talla S 3 unidades a 80000');
  assert.match(r.response, /Crear el producto «short prueba» a \$80\.000 con 1 variante: Negro talla S × 3/);
  const ok = await say('sí');
  assert.match(ok.response, /producto «short prueba» creado a \$80\.000 · stock 3 en 1 variante/);
  assert.deepEqual(calls.filter((c) => c.name === 'variants.create').map((c) => c.body), [{ attributes: { color: 'Negro', talla: 'S' }, stock: 3 }]);
  await say('devuélvelo como estaba');
  await say('sí');
  assert.equal(db.products.some((p) => p.name === 'short prueba'), false);
});

test('editar costo muestra el margen; costo masivo ("las licras") es reforzado', async () => {
  reset();
  acts({ accion: 'editar_producto', producto: 'licra aria', campo: 'costo', valor: 70000 });
  assert.match((await say('cambia el costo de la licra aria a 70000')).response, /Cambiar costo de Licra Aria: \$83\.306 → \$70\.000 \(margen 31% → 42%\)/);
  await say('sí');
  assert.equal(db.products.find((p) => p.id === 'la').cost_price, 70000);
  assert.equal(db.products.find((p) => p.id === 'ajeno').price, 1, 'el otro negocio no cambia');
  acts({ accion: 'editar_producto', producto: 'licras', campo: 'costo', valor: 75000, todos: true });
  const r = await say('cambia el costo de las licras a 75000');
  assert.match(r.response, /🔐 Cambiar costo de Licra Aria[\s\S]*🔐 Cambiar costo de Licra Jana[\s\S]*confirmo/);
});

test('dos productos con el mismo nombre: la opción elegida es ESE producto (no vuelve a preguntar en bucle)', async () => {
  reset();
  db.products.push({ ...db.products.find((p) => p.id === 'lj'), id: 'lj2', cost_price: 50000 });
  acts({ accion: 'editar_producto', producto: 'licra jana', campo: 'costo', valor: 70000 });
  const r = await say('cambia el costo de la licra jana a 70000');
  assert.match(r.response, /Hay 2 productos que coinciden[\s\S]*1\. Licra Jana[\s\S]*2\. Licra Jana/);
  const r2 = await say('2');
  assert.match(r2.response, /Cambiar costo de Licra Jana: \$50\.000 → \$70\.000/);
  await say('sí');
  assert.equal(db.products.find((p) => p.id === 'lj2').cost_price, 70000);
  assert.equal(db.products.find((p) => p.id === 'lj').cost_price, 83306);
});

test('eliminar variante con historial: el panel lo rechaza y se ofrece desactivar', async () => {
  reset();
  acts({ accion: 'eliminar_variante', producto: 'licra aria', color: 'negro', talla: 'm' });
  assert.match((await say('borra la variante negro M de licra aria')).response, /🔐 Eliminar DEL TODO la variante Licra Aria, Negro talla M/);
  const r = await say('confirmo');
  assert.match(r.response, /FALLÓ: No se puede eliminar: tiene 3 unidades.*desactiva Licra Aria, Negro talla M/);
});

// ── Sets ──
test('crear set con piezas resueltas por el servidor', async () => {
  reset();
  acts({ accion: 'crear_set', nombre: 'set playa', precio: 130000, piezas: [{ producto: 'top aria', cantidad: 1 }, { producto: 'short nila', cantidad: 1 }] });
  assert.match((await say('arma el set playa con top aria y short nila a 130 mil')).response, /Crear el set «set playa» a \$130\.000 con 1× Top Aria \+ 1× Short Nila \(sueltos suman \$144\.800\)/);
  await say('sí');
  assert.deepEqual(calls.find((c) => c.name === 'bundles.create').body.components, [{ product_id: 'ta', quantity: 1 }, { product_id: 'sn', quantity: 1 }]);
});

// ── Clientes ──
test('clientes: crear exige teléfono; recordatorio por WhatsApp reforzado con antispam por cliente', async () => {
  reset();
  acts({ accion: 'crear_cliente', nombre: 'Luisa' });
  assert.match((await say('agrega a luisa como cliente')).response, /necesito su teléfono/);
  acts({ accion: 'recordar_cliente', cliente: 'ana gomez' });
  const r = await say('mandale el recordatorio a ana gomez');
  assert.match(r.response, /🔐 Enviar por WhatsApp a Ana Gómez \(3001234567\)/);
  await say('confirmo');
  assert.equal(calls.filter((c) => c.name === 'clients.recallClient').length, 1);
  assert.equal(calls.find((c) => c.name === 'clients.recallClient').params.id, 'cli-ana');
  acts({ accion: 'recordar_cliente', cliente: 'ana gomez' });
  assert.match((await say('mandale otra vez el recordatorio a ana gomez')).response, /ya le escribí en los últimos 7 días/);
});

test('eliminar cliente = archivarlo como el panel (reforzado); un archivado ya no se encuentra', async () => {
  reset();
  acts({ accion: 'eliminar_cliente', cliente: 'ana gomez' });
  assert.match((await say('borra la clienta ana gomez')).response, /🔐 Eliminar al cliente Ana Gómez \(3001234567\) de la lista de Clientes \(queda archivado/);
  const r = await say('confirmo');
  assert.match(r.response, /eliminado de la lista \(archivado\)/);
  assert.equal(db.clients.find((c) => c.id === 'cli-ana').archived, true);
  assert.equal(db.clients.find((c) => c.id === 'cli-ajena').archived, undefined, 'la del otro negocio no se toca');
  acts({ accion: 'editar_cliente', cliente: 'ana gomez', campo: 'email', valor: 'a@b.co' });
  assert.match((await say('cambiale el correo a ana gomez')).response, /No encontré un cliente/);
});

test('permisos del plan: sin la función "clientes" (Lite) no se crea el cliente', async () => {
  reset();
  acts({ accion: 'crear_cliente', nombre: 'Luisa', telefono: '3005555555' });
  assert.match((await say('agrega a luisa 3005555555 como cliente', { plan: 'lite' })).response, /no está en tu plan \(lite\)/);
  assert.equal(calls.filter((c) => c.name === 'clients.create').length, 0);
});

// ── Configuración ──
test('ocultar un módulo es reforzado y reversible', async () => {
  reset();
  acts({ accion: 'modulo', modulo: 'clientes', activo: false });
  assert.match((await say('oculta el modulo de clientes')).response, /🔐 Ocultar el módulo clientes en el menú del panel \(visible → oculto\)/);
  await say('confirmo');
  assert.equal(db.businesses[0].modules.clientes, false);
  await say('devuélvelo como estaba');
  await say('sí');
  assert.equal(db.businesses[0].modules.clientes, true);
});

// ── Reportes ──
test('reportes: valor del inventario con datos del negocio', async () => {
  reset();
  intent({ tipo: 'consulta', consulta: { tipo: 'valor_inventario' } });
  const r = await say('cuanto vale mi inventario');
  assert.match(r.response, /Inventario activo: 4 unidades · a costo \$333\.224 · a precio de venta \$479\.600/);
});

// ── Fuera de alcance ──
test('fuera de alcance: el servidor dice dónde se hace; sin consulta lo dice con honestidad', async () => {
  reset();
  intent({ tipo: 'no_puedo', tema: 'tienda_config' });
  assert.match((await say('cambia la tarifa de envio a 15 mil')).response, /se ajustan con ayuda del desarrollador/);
  intent({ tipo: 'no_puedo', tema: 'fotos' });
  assert.match((await say('sube fotos del top aria')).response, /Fotos por color/);
  intent({ tipo: 'no_puedo', tema: 'sin_consulta', donde: 'analiticas' });
  assert.match((await say('cual es mi tasa de conversion')).response, /prefiero no inventar[\s\S]*Analíticas/);
});
