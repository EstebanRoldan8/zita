// Agente de tienda (Haiku + servidor determinista): enrutador, resolución de entidades, preguntas numeradas,
// propuestas armadas por el servidor y salida inválida del modelo. Base en memoria y modelo simulado.
// Ejecutar: node --test tests/store-agent.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const { createStoreAssistant, matchProducts, matchVariants } = require('../src/services/assistantStore');
const { createStoreAgent, classify, validateIntent, modelCaps, pickIndex, matchOption, costOf } = require('../src/services/storeAgent');

const BIZ = 'biz-flow';
const OTHER = 'biz-otra';
const clone = (o) => JSON.parse(JSON.stringify(o));
let db;
let seq = 0;

function q(table) {
  const st = { op: 'select', f: [], payload: null, one: false, limit: null, order: null };
  const match = (r) => st.f.every(([k, op, v]) => (op === 'eq' ? r[k] === v : op === 'neq' ? r[k] !== v : op === 'in' ? v.includes(r[k])
    : op === 'gte' ? String(r[k]) >= String(v) : op === 'lte' ? String(r[k]) <= String(v) : true));
  const run = () => {
    if (st.op === 'insert') { const row = { id: `${table}-${++seq}`, created_at: new Date(fake.clock.getTime() + seq).toISOString(), ...clone(st.payload) }; db[table].push(row); return { data: clone(row), error: null }; }
    if (st.op === 'update') { db[table].filter(match).forEach((r) => Object.assign(r, clone(st.payload))); return { data: null, error: null }; }
    let rows = db[table].filter(match).map(clone);
    if (st.order) rows.sort((a, b) => (st.order.asc ? 1 : -1) * String(a[st.order.k] || '').localeCompare(String(b[st.order.k] || '')));
    if (st.limit) rows = rows.slice(0, st.limit);
    return st.one ? { data: rows[0] || null, error: null } : { data: rows, error: null };
  };
  const b = {
    select() { return b; }, eq(k, v) { st.f.push([k, 'eq', v]); return b; }, neq(k, v) { st.f.push([k, 'neq', v]); return b; },
    in(k, v) { st.f.push([k, 'in', v]); return b; }, gte(k, v) { st.f.push([k, 'gte', v]); return b; }, lte(k, v) { st.f.push([k, 'lte', v]); return b; },
    order(k, o = {}) { st.order = { k, asc: o.ascending !== false }; return b; }, limit(n) { st.limit = n; return b; },
    insert(p) { st.op = 'insert'; st.payload = p; return b; }, update(p) { st.op = 'update'; st.payload = p; return b; },
    single() { st.one = true; return Promise.resolve(run()); }, maybeSingle() { st.one = true; return Promise.resolve(run()); },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  return b;
}
const rpcCalls = [];
const fake = {
  clock: new Date('2026-10-28T20:00:00Z'),
  now: () => new Date(fake.clock),
  from: (t) => q(t),
  rpc: async (name, a) => {
    rpcCalls.push(a);
    const v = a.p_variant_id ? db.product_variants.find((x) => x.id === a.p_variant_id && x.business_id === a.p_business_id) : db.products.find((x) => x.id === a.p_product_id && x.business_id === a.p_business_id);
    if (!v || v.stock + a.p_change < 0) return { data: null, error: { message: 'STOCK_INSUFICIENTE_O_NO_ENCONTRADO' } };
    v.stock += a.p_change;
    db.inventory_movements.push({ id: `mv-${++seq}`, business_id: a.p_business_id, reference_id: a.p_ref_id, created_at: fake.now().toISOString() });
    return { data: v.stock, error: null };
  },
};
const controllers = {
  products: {
    update: async (req, res) => { const p = db.products.find((x) => x.id === req.params.id && x.business_id === req.businessId); if (!p) return res.status(404).json({}); Object.assign(p, req.body); return res.json({ success: true, data: p }); },
    toggleProduct: async (req, res) => { const p = db.products.find((x) => x.id === req.params.id); p.is_active = !p.is_active; return res.json({ success: true }); },
  },
  variants: {
    update: async (req, res) => { const v = db.product_variants.find((x) => x.id === req.params.variantId); v.is_active = req.body.is_active; return res.json({ success: true, data: v }); },
    create: async (req, res) => { const v = { id: `v-${++seq}`, product_id: req.params.productId, business_id: req.businessId, attributes: req.body.attributes, stock: req.body.stock, is_active: true }; db.product_variants.push(v); return res.status(201).json({ success: true, data: v }); },
  },
  orders: {
    create: async (req, res) => { const o = { id: `0000aaaa-0000-4000-8000-${String(++seq).padStart(12, '0')}`, business_id: req.businessId, status: 'recibido', payment_status: 'pendiente', total_amount: req.body.items.reduce((s, i) => s + i.quantity * i.unit_price, 0) - (req.body.discount_amount || 0), discount_amount: req.body.discount_amount, created_at: fake.now().toISOString() }; db.orders.push(o); return res.status(201).json({ success: true, data: o }); },
    updateStatus: async (req, res) => res.json({ success: true }),
  },
};

function reset() {
  seq = 0; rpcCalls.length = 0; modelCalls.length = 0; replies.length = 0; fake.clock = new Date('2026-10-28T20:00:00Z');
  const P = (id, name, category, price, extra = {}) => ({ id, business_id: BIZ, name, category, price, cost_price: 30000, stock: 0, min_stock: 1, gender: 'mujer', is_active: true, is_bundle: false, has_variants: true, ...extra });
  const V = (id, product, color, talla, stock, extra = {}) => ({ id, product_id: product, business_id: BIZ, attributes: { color, talla }, stock, is_active: true, ...extra });
  db = {
    products: [
      P('tj', 'Top Jana', 'Tops', 59900), P('tn', 'Top Nila', 'Tops', 59900),
      P('la', 'Licra Aria', 'Licras', 119900), P('lj', 'Licra Jana', 'Licras', 119900),
      P('sn', 'Short Nila', 'Shorts', 84900),
      P('ce', 'camiseta elite', 'Camisetas', 50000, { stock: 12, has_variants: false }),
      { id: 'ajeno', business_id: OTHER, name: 'Top Jana', category: 'Tops', price: 1, stock: 99, is_active: true, is_bundle: false },
    ],
    product_variants: [
      V('tj-verde-s', 'tj', 'Verde', 'S', 3), V('tj-verde-m', 'tj', 'Verde', 'M', 1), V('tj-azul-s', 'tj', 'Azul', 'S', 2),
      V('tn-gris-s', 'tn', 'Gris', 'S', 3),
      V('la-negro-m', 'la', 'Negro', 'M', 4), V('lj-azul-m', 'lj', 'Azul', 'M', 0),
      V('sn-vino-m', 'sn', 'Vino tinto', 'M', 2), V('sn-vino-s', 'sn', 'Vino tinto', 'S', 1),
      V('ce-negro-m', 'ce', 'negro', 'm', 7, { is_active: false }),
    ],
    inventory_movements: [], assistant_actions: [], orders: [], product_bundle_components: [],
    businesses: [{ id: BIZ, store_settings: {} }],
  };
}

// Modelo simulado: devuelve las respuestas encoladas y guarda lo que recibió
const modelCalls = [];
const replies = [];
const toolReply = (input) => ({ content: [{ type: 'tool_use', id: `tu-${++seq}`, name: 'interpretar', input }], usage: { input_tokens: 900, output_tokens: 60 } });
const callModel = async (params, caps) => { modelCalls.push({ params: clone(params), caps }); return replies.shift() || { content: [{ type: 'text', text: 'hola' }], usage: { input_tokens: 900, output_tokens: 5 } }; };

const store = createStoreAssistant({ db: fake, controllers, now: fake.now, catalogFor: async () => null });
const agent = createStoreAgent({ store, callModel });
const biz = { name: 'FLOW', business_type: 'Tienda', slug: 'flow' };
const say = async (msg) => { fake.clock = new Date(fake.clock.getTime() + 60000); return agent.handle({ businessId: BIZ, business: biz, userMessage: msg, history: [], authorization: 'Bearer u', model: 'claude-haiku-4-5-20251001' }); };

// ── Enrutador ──
test('enrutador: saludos, sí/no/deshacer y consultas frecuentes sin modelo', () => {
  const t = (m, s) => classify(m, s).type;
  assert.equal(t('hola'), 'greeting');
  assert.equal(t('Buenas tardes'), 'greeting');
  assert.equal(t('sí, dale'), 'yes');
  assert.equal(t('confirmo'), 'yes');
  assert.equal(t('no, cancela'), 'no');
  assert.equal(t('devuélvelo como estaba'), 'undo');
  assert.deepEqual(classify('¿cómo vamos hoy?'), { type: 'query', consulta: 'resumen_hoy' });
  assert.equal(classify('¿qué se agotó?').consulta, 'agotados');
  assert.equal(classify('¿qué pedidos faltan por pagar?').consulta, 'sin_pagar');
  assert.equal(classify('¿qué es lo que más se vende?').consulta, 'mas_vendidos');
  assert.deepEqual(classify('¿cuánto he vendido esta semana?'), { type: 'query', consulta: 'ventas', periodo: 'semana' });
  assert.equal(classify('¿cuántas licra aria negras hay?').consulta, 'stock');
  for (const m of ['llegaron 3 de esas', 'sube el precio de las licras a 129900', 'pon agotado el short nila vino tinto', 'hazme un pedido de 2 tops jana verdes con 10 mil de descuento', 'agrégale 2 variantes azul S y negro M']) assert.equal(t(m), 'model', m);
  assert.equal(t('¿qué me recomiendas para mañana?'), 'model');
});

test('enrutador: respuesta a una pregunta numerada ("2", "la segunda", "verde M")', () => {
  const pregunta = { plan: { opciones: [{ label: 'Verde talla S', color: 'Verde', talla: 'S' }, { label: 'Verde talla M', color: 'Verde', talla: 'M' }, { label: 'Azul talla S', color: 'Azul', talla: 'S' }] } };
  assert.deepEqual(classify('2', { pregunta }), { type: 'answer', index: 2 });
  assert.deepEqual(classify('la segunda', { pregunta }), { type: 'answer', index: 2 });
  assert.deepEqual(classify('opción 3', { pregunta }), { type: 'answer', index: 3 });
  assert.deepEqual(classify('verde M', { pregunta }), { type: 'answer', index: 2 });
  assert.equal(classify('verde', { pregunta }).type, 'model', 'ambiguo: no elige');
  assert.equal(pickIndex('el 12'), 12);
  assert.equal(matchOption('azul', pregunta.plan.opciones), 3);
});

// ── Entidades ──
test('entidades: tildes, mayúsculas, plurales, categoría y sinónimos de color/talla', () => {
  const ps = db ? db.products : null;
  reset();
  const names = (q) => matchProducts(db.products.filter((p) => p.business_id === BIZ), q).map((p) => p.name).sort();
  assert.deepEqual(names('TOPS JANA'), ['Top Jana']);
  assert.deepEqual(names('las licras'), ['Licra Aria', 'Licra Jana']);
  assert.deepEqual(names('camiseta élite'), ['camiseta elite']);
  assert.deepEqual(names('top'), ['Top Jana', 'Top Nila']);
  const vs = db.product_variants.filter((v) => v.product_id === 'tj');
  assert.deepEqual(matchVariants(vs, 'verdes', 'mediana').map((v) => v.id), ['tj-verde-m']);
  assert.deepEqual(matchVariants(db.product_variants.filter((v) => v.product_id === 'sn'), 'vino', 'small').map((v) => v.id), ['sn-vino-s']);
  assert.equal(ps === null || Array.isArray(ps), true);
});

// ── Salida estructurada ──
test('validación de la intención del modelo', () => {
  assert.equal(validateIntent({ tipo: 'acciones', acciones: [{ accion: 'sumar_stock', producto: 'top jana', cantidad: 3 }] }), null);
  assert.equal(validateIntent({ tipo: 'consulta', consulta: { tipo: 'ventas', periodo: 'semana' } }), null);
  assert.ok(validateIntent({ tipo: 'borrar_todo' }));
  assert.ok(validateIntent({ tipo: 'acciones', acciones: [] }));
  assert.ok(validateIntent({ tipo: 'acciones', acciones: [{ accion: 'sumar_stock', cantidad: 3 }] }), 'falta el producto');
  assert.ok(validateIntent({ tipo: 'acciones', acciones: [{ accion: 'sumar_stock', producto: 'x', cantidad: 2.5 }] }), 'número no entero');
  assert.ok(validateIntent({ tipo: 'acciones', acciones: [{ accion: 'pedido', items: [] }] }));
  assert.ok(validateIntent(null));
});

test('capacidades por modelo: Haiku fuerza la herramienta; Sonnet/Opus 5.5 usan auto + esfuerzo + respaldo', () => {
  assert.deepEqual(modelCaps('claude-haiku-4-5-20251001'), { forcedTool: true, effort: false, fallbacks: false, thinking: false });
  assert.deepEqual(modelCaps('claude-sonnet-5-5'), { forcedTool: false, effort: true, fallbacks: true, thinking: true });
  assert.deepEqual(modelCaps('claude-opus-5-5'), { forcedTool: false, effort: true, fallbacks: true, thinking: true });
  assert.equal(modelCaps('claude-haiku-5-5').forcedTool, true);
  assert.ok(Math.abs(costOf('claude-haiku-4-5-20251001', { input: 1e6, output: 0 }) - 1) < 1e-9);
});

// ── Flujos completos ──
test('consultas frecuentes con plantilla: cero llamadas al modelo', async () => {
  reset();
  const r1 = await say('¿cómo vamos hoy?');
  assert.equal(r1.usage.calls, 0);
  assert.match(r1.response, /Hoy: \$0 en 0 pedidos/);
  const r2 = await say('¿qué se agotó?');
  assert.equal(r2.usage.calls, 0);
  assert.match(r2.response, /Licra Jana — Azul talla M: 0/);
  const r3 = await say('¿cuántas licra aria negras hay?');
  assert.equal(r3.usage.calls, 0);
  assert.match(r3.response, /Licra Aria — Negro talla M: 4/);
  const r4 = await say('hola');
  assert.equal(r4.usage.calls, 0);
  assert.equal(modelCalls.length, 0);
});

test('ajuste con ambigüedad: el servidor pregunta con opciones; "2" y "sí" no llaman al modelo', async () => {
  reset();
  replies.push(toolReply({ tipo: 'acciones', acciones: [{ accion: 'sumar_stock', producto: 'top jana', cantidad: 3 }] }));
  const r1 = await say('llegaron 3 top jana');
  assert.equal(r1.usage.calls, 1);
  assert.match(r1.response, /Top Jana tiene 3 variantes[\s\S]*1\. Verde talla S \(stock 3\)[\s\S]*2\. Verde talla M \(stock 1\)[\s\S]*Responde con el número/);
  const r2 = await say('2');
  assert.equal(r2.usage.calls, 0);
  assert.match(r2.response, /1\. Sumar 3 a Top Jana, Verde talla M \(hoy 1 → quedaría 4\)\.[\s\S]*¿Confirmas\? \(sí \/ no\)/);
  const r3 = await say('sí');
  assert.equal(r3.usage.calls, 0);
  assert.match(r3.response, /✅ Hecho:\n1\. Top Jana, Verde talla M: 1 → 4 \(leído de la base\)/);
  assert.equal(db.product_variants.find((v) => v.id === 'tj-verde-m').stock, 4);
  assert.equal(modelCalls[0].params.tool_choice.type, 'tool', 'Haiku: herramienta forzada');
  assert.equal(modelCalls[0].params.max_tokens, 400, 'max_tokens bajo');
});

test('foco: "llegaron 3 de esas" recibe el foco de la consulta anterior', async () => {
  reset();
  await say('¿cuánto hay de short nila vino tinto talla m?');
  replies.push(toolReply({ tipo: 'acciones', acciones: [{ accion: 'sumar_stock', producto: 'Short Nila', color: 'Vino tinto', talla: 'M', cantidad: 3 }] }));
  const r = await say('llegaron 3 de esas');
  assert.match(modelCalls[0].params.messages.at(-1).content, /FOCO: Short Nila, Vino tinto, talla M/);
  assert.match(r.response, /Sumar 3 a Short Nila, Vino tinto talla M \(hoy 2 → quedaría 5\)/);
});

test('varias acciones y "todos": un solo "sí" ejecuta todas', async () => {
  reset();
  replies.push(toolReply({ tipo: 'acciones', acciones: [{ accion: 'cambiar_precio', producto: 'licras', precio: 129900, todos: true }] }));
  const r = await say('sube el precio de las licras a 129900');
  assert.match(r.response, /1\. Cambiar el precio de Licra Aria: \$119\.900 → \$129\.900[\s\S]*2\. Cambiar el precio de Licra Jana/);
  const ok = await say('dale');
  assert.match(ok.response, /1\. Licra Aria: \$119\.900 → \$129\.900[\s\S]*2\. Licra Jana/);
  assert.deepEqual(db.products.filter((p) => p.category === 'Licras').map((p) => p.price), [129900, 129900]);
});

test('"pon agotado": fija el stock en 0 calculando el cambio desde la base', async () => {
  reset();
  replies.push(toolReply({ tipo: 'acciones', acciones: [{ accion: 'fijar_stock', producto: 'short nila', color: 'vino tinto', stock_final: 0 }] }));
  const r = await say('pon agotado el short nila vino tinto');
  assert.match(r.response, /¿qué talla\?[\s\S]*1\. Vino tinto talla M \(stock 2\)[\s\S]*2\. Vino tinto talla S \(stock 1\)/);
  const r2 = await say('1');
  assert.match(r2.response, /Restar 2 a Short Nila, Vino tinto talla M \(hoy 2 → quedaría 0\)/);
});

test('pedido con descuento armado por el servidor (precios del sistema)', async () => {
  reset();
  replies.push(toolReply({ tipo: 'acciones', acciones: [{ accion: 'pedido', items: [{ producto: 'tops jana', color: 'verdes', cantidad: 2 }], descuento: 10000 }] }));
  const r = await say('hazme un pedido de 2 tops jana verdes con 10 mil de descuento');
  assert.match(r.response, /Top Jana: ¿qué talla\?[\s\S]*1\. Verde talla S/);
  const r2 = await say('1');
  assert.match(r2.response, /Registrar pedido: 2× Top Jana \(Verde talla S\) \$59\.900\. Subtotal \$119\.800, descuento \$10\.000, total \$109\.800/);
});

test('crear variante y variante inexistente: el servidor explica, nunca ajusta el total', async () => {
  reset();
  replies.push(toolReply({ tipo: 'acciones', acciones: [{ accion: 'crear_variante', producto: 'camiseta elite', color: 'azul', talla: 'S' }, { accion: 'crear_variante', producto: 'camiseta elite', color: 'negro', talla: 'M' }] }));
  const r = await say('agrégale 2 variantes azul S y negro M a camiseta elite');
  assert.match(r.response, /12 unidades guardadas sin variante/);
  assert.match(r.response, /DESACTIVADA/);
  assert.doesNotMatch(r.response, /Para confirmar/);
  replies.push(toolReply({ tipo: 'acciones', acciones: [{ accion: 'sumar_stock', producto: 'top jana', color: 'rojo', talla: 'S', cantidad: 2 }] }));
  const r2 = await say('súmale 2 al top jana rojo S');
  assert.match(r2.response, /no tiene la variante Rojo talla S.*crearla/);
  assert.equal(rpcCalls.length, 0);
});

test('salida inválida: un reintento barato; si vuelve a fallar, mensaje honesto', async () => {
  reset();
  replies.push(toolReply({ tipo: 'acciones', acciones: [{ accion: 'sumar_stock', cantidad: 3 }] }), toolReply({ tipo: 'acciones', acciones: [{ accion: 'sumar_stock', producto: 'top nila', cantidad: 3 }] }));
  const r = await say('llegaron 3 top nila');
  assert.equal(r.usage.calls, 2);
  assert.match(r.response, /Sumar 3 a Top Nila, Gris talla S \(hoy 3 → quedaría 6\)/, 'una sola variante: no pregunta');
  assert.equal(modelCalls[1].params.messages.at(-1).content[0].type, 'tool_result', 'el reintento devuelve el error al modelo');
  reset();
  replies.push({ content: [{ type: 'text', text: 'listo' }], usage: {} }, toolReply({ tipo: 'xxx' }));
  const bad = await say('blablá raro');
  assert.equal(bad.usage.calls, 2);
  assert.match(bad.response, /No te entendí bien/);
});

test('el modelo no puede afirmar cambios: un "no_puedo" que dice "listo, quedó" se reemplaza', async () => {
  reset();
  replies.push(toolReply({ tipo: 'no_puedo', respuesta: '✅ Listo, ya borré la falda y quedó fuera.' }));
  const r = await say('borra la falda vela');
  assert.doesNotMatch(r.response, /Listo/);
  assert.match(r.response, /panel/);
});

test('aislamiento: todo se lee y escribe con el negocio de la sesión', async () => {
  reset();
  replies.push(toolReply({ tipo: 'acciones', acciones: [{ accion: 'sumar_stock', producto: 'top jana', color: 'verde', talla: 'S', cantidad: 1, business_id: OTHER }] }));
  await say(`llegaron 1 top jana verde S (negocio ${OTHER})`);
  await say('sí');
  assert.equal(rpcCalls[0].p_business_id, BIZ);
  assert.equal(db.products.find((p) => p.id === 'ajeno').stock, 99);
});

test('deshacer y "no" con plantilla, sin modelo', async () => {
  reset();
  replies.push(toolReply({ tipo: 'acciones', acciones: [{ accion: 'sumar_stock', producto: 'top nila', cantidad: 2 }] }));
  await say('llegaron 2 top nila');
  await say('sí');
  const u = await say('devuélvelo como estaba');
  assert.equal(u.usage.calls, 0);
  assert.match(u.response, /Deshacer: restar 2 a Top Nila, Gris talla S \(hoy 5 → quedaría 3\)/);
  const n = await say('no');
  assert.match(n.response, /Cancelado/);
  assert.equal(db.product_variants.find((v) => v.id === 'tn-gris-s').stock, 5);
});
