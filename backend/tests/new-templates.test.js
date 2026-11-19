// Plantillas aviso_cita_cancelada / aviso_cita_reasignada / aviso_pedido_web contra la API de WhatsApp
// mockeada a nivel HTTP (axios): ventana de 24 h, flag apagado, sin número, saneo de variables y número
// exacto de variables por plantilla. Ejecutar: node --test tests/new-templates.test.js
process.env.ENCRYPT_SECRET = process.env.ENCRYPT_SECRET || 'test-secret';
process.env.WHATSAPP_ACCESS_TOKEN = 'token-global-de-zita';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'pnid-global';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createFakeSupabase } = require('./helpers/fakeSupabase');

// axios falso: cada POST a Meta queda registrado
const posts = [];
const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..', 'src', 'config')] });
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true,
  exports: { post: async (url, body, opts) => { posts.push({ url, body, auth: opts.headers.Authorization }); return { status: 200, data: { messages: [{ id: 'wamid.x' }] } }; } },
};
const stub = (rel, exports) => {
  const p = require.resolve(path.join(__dirname, '..', 'src', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};
const logs = [];
const log = (lvl) => (...a) => logs.push([lvl, ...a]);
stub('utils/logger', { info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') });

const fake = createFakeSupabase({});
stub('config/supabase', { supabaseAdmin: fake, createUserClient: () => fake });

const { encrypt } = require('../src/utils/encrypt');
const { TEMPLATE_CONFIG } = require('../src/services/whatsappNotify');
const { notifyClientOfCancellation } = require('../src/services/cancellationNotice');

const BIZ = '11111111-1111-4111-8111-111111111111';
const APPT = '55555555-5555-4555-8555-555555555555';
const PHONE = '573001112233';
const TOKEN = 'token-del-negocio';
const H = 3600000;

function seed({ inboundHoursAgo = null, pnid = 'pnid-negocio', token = TOKEN, clientName = 'Carlos Ruiz', businessName = 'Barbería Test', service = 'Corte clásico' } = {}) {
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  posts.length = 0; logs.length = 0;
  Object.assign(fake.db, {
    businesses: [{ id: BIZ, name: businessName, country: 'colombia', whatsapp_phone_number_id: pnid, whatsapp_access_token: token ? encrypt(token) : null }],
    clients: [{ id: 'c1', business_id: BIZ, name: clientName, phone: PHONE }],
    services: [{ id: 's1', business_id: BIZ, name: service }],
    employees: [],
    appointments: [{ id: APPT, business_id: BIZ, client_id: 'c1', service_id: 's1', source: 'whatsapp', scheduled_at: '2030-11-12T15:00:00-05:00' }],
    whatsapp_conversations: inboundHoursAgo === null ? [] : [{
      id: 'conv', business_id: BIZ, client_phone: PHONE,
      messages: [{ role: 'user', content: 'hola', timestamp: new Date(Date.now() - inboundHoursAgo * H).toISOString() }],
    }],
  });
}
const templatesOn = (on) => { process.env.WA_TEMPLATES_ENABLED = on ? 'true' : 'false'; };
const params = (p) => p.body.template.components.find((c) => c.type === 'body').parameters.map((x) => x.text);
const noSecrets = () => {
  const all = JSON.stringify(logs);
  assert.equal(all.includes(PHONE), false, 'sin teléfono completo en logs');
  assert.equal(all.includes(TOKEN), false, 'sin token en logs');
};
// Meta: sin saltos de línea, tabs ni más de 4 espacios seguidos, y nunca vacías
const metaValid = (v) => typeof v === 'string' && v.length > 0 && !/[\n\r\t]/.test(v) && !/ {5,}/.test(v);

// ── aviso_cita_cancelada ────────────────────────────────────────────────────────
test('cancelada: config en el mapa (es_CO, 4 variables, nombre sobrescribible)', () => {
  assert.deepEqual(
    { env: TEMPLATE_CONFIG.aviso_cita_cancelada.env, name: TEMPLATE_CONFIG.aviso_cita_cancelada.name, lang: TEMPLATE_CONFIG.aviso_cita_cancelada.lang, vars: TEMPLATE_CONFIG.aviso_cita_cancelada.vars },
    { env: 'WA_TPL_CITA_CANCELADA', name: 'aviso_cita_cancelada', lang: 'es_CO', vars: 4 },
  );
});

test('cancelada dentro de la ventana: texto libre desde el número del negocio', async () => {
  templatesOn(true);
  seed({ inboundHoursAgo: 2 });
  assert.deepEqual(await notifyClientOfCancellation({ businessId: BIZ, appointmentId: APPT }), { sent: true });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.type, 'text');
  assert.match(posts[0].url, /\/pnid-negocio\/messages$/);
  assert.equal(posts[0].auth, `Bearer ${TOKEN}`);
  noSecrets();
});

test('cancelada fuera de la ventana: plantilla es_CO con EXACTAMENTE 4 variables en orden', async () => {
  templatesOn(true);
  seed({ inboundHoursAgo: 72 });
  await notifyClientOfCancellation({ businessId: BIZ, appointmentId: APPT });
  const t = posts[0].body.template;
  assert.equal(posts[0].body.type, 'template');
  assert.equal(t.name, 'aviso_cita_cancelada');
  assert.equal(t.language.code, 'es_CO');
  const p = params(posts[0]);
  assert.equal(p.length, 4);
  assert.equal(p[0], 'Carlos Ruiz');
  assert.equal(p[1], 'Corte clásico');
  assert.match(p[2], /12 de noviembre a las 03:00/);
  assert.equal(p[3], 'Barbería Test');
  assert.match(posts[0].url, /\/pnid-negocio\/messages$/);
  noSecrets();
});

test('cancelada: nombre sobrescrito por WA_TPL_CITA_CANCELADA', async () => {
  templatesOn(true);
  process.env.WA_TPL_CITA_CANCELADA = 'aviso_cita_cancelada_v3';
  try {
    seed({ inboundHoursAgo: null });
    await notifyClientOfCancellation({ businessId: BIZ, appointmentId: APPT });
    assert.equal(posts[0].body.template.name, 'aviso_cita_cancelada_v3');
  } finally {
    delete process.env.WA_TPL_CITA_CANCELADA;
  }
});

test('cancelada con plantillas apagadas: todo igual que hoy (texto libre)', async () => {
  templatesOn(false);
  seed({ inboundHoursAgo: 72 });
  await notifyClientOfCancellation({ businessId: BIZ, appointmentId: APPT });
  assert.equal(posts[0].body.type, 'text');
  assert.match(posts[0].body.text.body, /cancelada/);
});

test('cancelada sin número o sin token del negocio: no se envía (ni desde el número global) y queda en el log', async () => {
  templatesOn(true);
  seed({ inboundHoursAgo: 72, pnid: null });
  assert.deepEqual(await notifyClientOfCancellation({ businessId: BIZ, appointmentId: APPT }), { sent: false, reason: 'sin_numero' });
  assert.ok(logs.some((l) => String(l[1]).includes('WA_SIN_NUMERO')));
  seed({ inboundHoursAgo: 72, token: null });
  assert.deepEqual(await notifyClientOfCancellation({ businessId: BIZ, appointmentId: APPT }), { sent: false, reason: 'sin_token' });
  assert.ok(logs.some((l) => String(l[1]).includes('WA_SIN_TOKEN')));
  assert.equal(posts.length, 0);
});

test('cancelada: saltos de línea, tabs, espacios y vacíos se sanean; largo limitado', async () => {
  templatesOn(true);
  seed({ inboundHoursAgo: 72, clientName: 'Carlos\n\tRuiz      Pérez\r\n', businessName: '   ', service: 'x'.repeat(500) });
  await notifyClientOfCancellation({ businessId: BIZ, appointmentId: APPT });
  const p = params(posts[0]);
  assert.equal(p.length, 4);
  assert.ok(p.every(metaValid), JSON.stringify(p));
  assert.equal(p[0], 'Carlos Ruiz Pérez');
  assert.equal(p[3], '-', 'negocio vacío → texto neutro');
  assert.ok(p[1].length <= TEMPLATE_CONFIG.aviso_cita_cancelada.max[1]);
  assert.ok(p[1].endsWith('…'));
});

test('cancelada: cliente sin nombre → "-" (Meta rechaza variables vacías)', async () => {
  templatesOn(true);
  seed({ inboundHoursAgo: 72, clientName: null });
  await notifyClientOfCancellation({ businessId: BIZ, appointmentId: APPT });
  assert.equal(params(posts[0])[0], '-');
});

// ── Protección común: número de variables ───────────────────────────────────────
const { notify } = require('../src/services/whatsappNotify');
test('envío con otro número de variables: NO se envía nada fuera de la ventana (ni texto) y queda en el log', async () => {
  templatesOn(true);
  seed();
  const r = await notify({ to: PHONE, text: 'texto', template: { key: 'aviso_cita_cancelada', body: ['a', 'b', 'c'] }, token: TOKEN, phoneNumberId: 'pnid-negocio', lastInbound: null, kind: 'prueba' });
  assert.equal(r.via, 'none');
  assert.equal(r.result.success, false);
  assert.equal(posts.length, 0);
  const line = logs.find((l) => String(l[1]).includes('WA_PLANTILLA_VARIABLES'));
  assert.deepEqual([line[2].esperadas, line[2].recibidas], [4, 3]);
  noSecrets();
});

test('Meta rechaza la plantilla (p. ej. 132001 idioma): se loguea con etiqueta y NO se cae a texto libre', async () => {
  templatesOn(true);
  seed({ inboundHoursAgo: 72 });
  const axios = require.cache[axiosPath].exports;
  const realPost = axios.post;
  axios.post = async (url, body) => {
    posts.push({ url, body });
    const e = new Error('400'); e.response = { status: 400, data: { error: { code: 132001, message: 'template name does not exist in the translation' } } }; throw e;
  };
  try {
    const r = await notifyClientOfCancellation({ businessId: BIZ, appointmentId: APPT });
    assert.equal(r.sent, false);
    assert.equal(posts.length, 1, 'un solo intento, sin respaldo a texto');
    assert.equal(posts[0].body.type, 'template');
    const line = logs.find((l) => String(l[1]).includes('WA_PLANTILLA_RECHAZADA'));
    assert.deepEqual([line[2].template, line[2].metaCode, line[2].idioma], ['aviso_cita_cancelada', 132001, 'es_CO']);
    noSecrets();
  } finally {
    axios.post = realPost;
  }
});

// ── aviso_cita_reasignada ───────────────────────────────────────────────────────
const { notifyReassignment } = require('../src/controllers/employees.controller');
const cita = (over = {}) => ({ id: APPT, scheduled_at: '2030-11-12T15:00:00-05:00', services: { name: 'Corte clásico' }, clients: { name: 'Carlos Ruiz', phone: PHONE }, ...over });
const reasignar = (over = {}, name = 'Pedro Gómez') => notifyReassignment({ business: fake.db.businesses[0], businessId: BIZ, cita: cita(over), newEmployeeName: name });

test('reasignada: config en el mapa (es_CO, 5 variables, WA_TPL_CITA_REASIGNADA)', () => {
  const c = TEMPLATE_CONFIG.aviso_cita_reasignada;
  assert.deepEqual([c.env, c.name, c.lang, c.vars], ['WA_TPL_CITA_REASIGNADA', 'aviso_cita_reasignada', 'es_CO', 5]);
});

test('reasignada dentro de la ventana: texto libre desde el número del negocio', async () => {
  templatesOn(true);
  seed({ inboundHoursAgo: 2 });
  await reasignar();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.type, 'text');
  assert.match(posts[0].body.text.body, /Pedro Gómez/);
  assert.match(posts[0].url, /\/pnid-negocio\/messages$/);
  noSecrets();
});

test('reasignada fuera de la ventana: plantilla es_CO con EXACTAMENTE 5 variables en orden', async () => {
  templatesOn(true);
  seed({ inboundHoursAgo: 72 });
  await reasignar();
  const t = posts[0].body.template;
  assert.deepEqual([posts[0].body.type, t.name, t.language.code], ['template', 'aviso_cita_reasignada', 'es_CO']);
  const p = params(posts[0]);
  assert.equal(p.length, 5);
  assert.equal(p[0], 'Carlos Ruiz');
  assert.equal(p[1], 'Corte clásico');
  assert.match(p[2], /12 de noviembre a las 03:00/);
  assert.equal(p[3], 'Barbería Test');
  assert.equal(p[4], 'Pedro Gómez');
  assert.equal(posts[0].auth, `Bearer ${TOKEN}`);
  noSecrets();
});

test('reasignada: nombre sobrescrito por WA_TPL_CITA_REASIGNADA', async () => {
  templatesOn(true);
  process.env.WA_TPL_CITA_REASIGNADA = 'aviso_cita_reasignada_v2';
  try {
    seed();
    await reasignar();
    assert.equal(posts[0].body.template.name, 'aviso_cita_reasignada_v2');
  } finally {
    delete process.env.WA_TPL_CITA_REASIGNADA;
  }
});

test('reasignada con plantillas apagadas: texto libre como hoy', async () => {
  templatesOn(false);
  seed({ inboundHoursAgo: 72 });
  await reasignar();
  assert.equal(posts[0].body.type, 'text');
});

test('reasignada sin número o sin token: no se envía y queda en el log', async () => {
  templatesOn(true);
  seed({ pnid: null });
  await reasignar();
  assert.ok(logs.some((l) => String(l[1]).includes('WA_SIN_NUMERO')));
  seed({ token: null });
  await reasignar();
  assert.ok(logs.some((l) => String(l[1]).includes('WA_SIN_TOKEN')));
  assert.equal(posts.length, 0);
});

test('reasignada: saneo de saltos/tabs/espacios, vacíos → "-", largo limitado', async () => {
  templatesOn(true);
  seed({ businessName: 'Barbería\n\nTest' });
  await reasignar({ clients: { name: '', phone: PHONE }, services: { name: 'Corte\t\tclásico        premium' } }, 'P'.repeat(300));
  const p = params(posts[0]);
  assert.equal(p.length, 5);
  assert.ok(p.every(metaValid), JSON.stringify(p));
  assert.deepEqual([p[0], p[1], p[3]], ['-', 'Corte clásico premium', 'Barbería Test']);
  assert.ok(p[4].length <= 60 && p[4].endsWith('…'));
});

// ── aviso_pedido_web (cambio de estado de un pedido de la tienda) ───────────────
const { notifyOrderStatusChange } = require('../src/services/orderStatusNotice');
const { orderCode } = require('../src/utils/inventoryHistory');
const ORDER = 'aaaaaaaa-1111-4111-8111-111111111111';
const CODE = orderCode(ORDER);
function seedOrder(over = {}, seedOpts = {}) {
  seed(seedOpts);
  fake.db.orders = [{ id: ORDER, business_id: BIZ, client_name: 'Ana María', client_phone: PHONE, source: 'web', status: 'recibido', ...over }];
}
const cambio = (newStatus = 'enviado', previousStatus = 'en_proceso') => notifyOrderStatusChange({ businessId: BIZ, orderId: ORDER, previousStatus, newStatus });

test('pedido web: config en el mapa (es_CO, 4 variables, WA_TPL_PEDIDO_WEB)', () => {
  const c = TEMPLATE_CONFIG.aviso_pedido_web;
  assert.deepEqual([c.env, c.name, c.lang, c.vars], ['WA_TPL_PEDIDO_WEB', 'aviso_pedido_web', 'es_CO', 4]);
});

test('pedido web dentro de la ventana: texto libre desde el número del negocio', async () => {
  templatesOn(true);
  seedOrder({}, { inboundHoursAgo: 2 });
  assert.deepEqual(await cambio(), { sent: true, via: 'text' });
  assert.equal(posts[0].body.type, 'text');
  assert.equal(posts[0].body.text.body, `Hola Ana María, tu pedido #${CODE} en Barbería Test cambió de estado: enviado. Cualquier duda, responde este mensaje.`);
  assert.match(posts[0].url, /\/pnid-negocio\/messages$/);
  noSecrets();
});

test('pedido web fuera de la ventana: plantilla es_CO con EXACTAMENTE 4 variables en orden', async () => {
  templatesOn(true);
  seedOrder();
  assert.deepEqual(await cambio('en_proceso', 'recibido'), { sent: true, via: 'template' });
  const t = posts[0].body.template;
  assert.deepEqual([t.name, t.language.code], ['aviso_pedido_web', 'es_CO']);
  assert.deepEqual(params(posts[0]), ['Ana María', CODE, 'Barbería Test', 'en proceso']);
  assert.equal(posts[0].auth, `Bearer ${TOKEN}`);
  noSecrets();
});

test('pedido web: nombre sobrescrito por WA_TPL_PEDIDO_WEB', async () => {
  templatesOn(true);
  process.env.WA_TPL_PEDIDO_WEB = 'aviso_pedido_web_v2';
  try {
    seedOrder();
    await cambio('cancelado');
    assert.equal(posts[0].body.template.name, 'aviso_pedido_web_v2');
    assert.equal(params(posts[0])[3], 'cancelado');
  } finally {
    delete process.env.WA_TPL_PEDIDO_WEB;
  }
});

test('pedido web con plantillas apagadas: no se envía nada (igual que hoy, que no había aviso)', async () => {
  templatesOn(false);
  seedOrder({}, { inboundHoursAgo: 2 });
  assert.deepEqual(await cambio(), { sent: false, reason: 'plantillas_apagadas' });
  assert.equal(posts.length, 0);
});

test('pedido web sin número o sin token del negocio: no se envía y queda en el log', async () => {
  templatesOn(true);
  seedOrder({}, { pnid: null });
  assert.equal((await cambio()).sent, false);
  assert.ok(logs.some((l) => String(l[1]).includes('WA_SIN_NUMERO')));
  seedOrder({}, { token: null });
  assert.equal((await cambio()).sent, false);
  assert.ok(logs.some((l) => String(l[1]).includes('WA_SIN_TOKEN')));
  assert.equal(posts.length, 0);
});

test('pedido web: no avisa pedidos manuales, sin teléfono, de otro negocio, ni "recibido" o sin cambio', async () => {
  templatesOn(true);
  seedOrder({ source: 'manual' });
  assert.equal((await cambio()).reason, 'no_es_pedido_web');
  seedOrder({ client_phone: null });
  assert.equal((await cambio()).reason, 'sin_telefono');
  seedOrder({ business_id: '99999999-9999-4999-8999-999999999999' });
  assert.equal((await cambio()).reason, 'pedido_no_encontrado');
  seedOrder();
  assert.equal((await cambio('recibido', 'en_proceso')).reason, 'sin_cambio');
  assert.equal((await cambio('listo', 'listo')).reason, 'sin_cambio');
  assert.equal(posts.length, 0);
});

test('pedido web: saneo de nombre del cliente (viene del checkout) y negocio; vacíos → "-"', async () => {
  templatesOn(true);
  seedOrder({ client_name: 'Ana\n\tMaría      López' + ' x'.repeat(100) }, { businessName: '' });
  await cambio();
  const p = params(posts[0]);
  assert.equal(p.length, 4);
  assert.ok(p.every(metaValid), JSON.stringify(p));
  assert.ok(p[0].startsWith('Ana María López'));
  assert.ok(p[0].length <= 60);
  assert.equal(p[2], '-');
});

// ── Enganche en orders.updateStatus (panel y asistente de tienda) ───────────────
const { call } = require('./helpers/http');
const orders = require('../src/controllers/orders.controller');
const flush = () => new Promise((r) => setImmediate(() => setImmediate(r)));

test('updateStatus: cambia el estado, responde y DESPUÉS avisa al cliente; un fallo de WhatsApp no rompe el flujo', async () => {
  templatesOn(true);
  seedOrder({ status: 'en_proceso' });
  const ok = await call(orders.updateStatus, { businessId: BIZ, business: { id: BIZ, business_type: 'tienda' }, params: { id: ORDER }, body: { status: 'enviado' } });
  assert.equal(ok.status, 200);
  assert.equal(fake.db.orders[0].status, 'enviado');
  await flush();
  await flush();
  assert.equal(posts.length, 1);
  assert.deepEqual(params(posts[0]), ['Ana María', CODE, 'Barbería Test', 'enviado']);

  // WhatsApp rechaza el envío: el cambio de estado igual responde 200
  const axios = require.cache[axiosPath].exports;
  const realPost = axios.post;
  axios.post = async () => { throw Object.assign(new Error('400'), { response: { status: 400, data: { error: { code: 131000, message: 'error' } } } }); };
  try {
    fake.db.orders[0].status = 'enviado';
    const r = await call(orders.updateStatus, { businessId: BIZ, business: { id: BIZ, business_type: 'tienda' }, params: { id: ORDER }, body: { status: 'entregado' } });
    assert.equal(r.status, 200);
    assert.equal(fake.db.orders[0].status, 'entregado');
    await flush();
    await flush();
    assert.ok(logs.some((l) => String(l[1]).includes('PEDIDO_WEB_AVISO_FALLIDO')), 'el fallo queda en el log');
  } finally {
    axios.post = realPost;
  }
});

test('updateStatus al mismo estado: no avisa', async () => {
  templatesOn(true);
  seedOrder({ status: 'listo' });
  await call(orders.updateStatus, { businessId: BIZ, business: { id: BIZ }, params: { id: ORDER }, body: { status: 'listo' } });
  await flush();
  assert.equal(posts.length, 0);
});
