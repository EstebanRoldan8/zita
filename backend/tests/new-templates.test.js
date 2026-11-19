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
test('si un envío no trae el número exacto de variables, no se intenta la plantilla (Meta la rechazaría)', async () => {
  templatesOn(true);
  seed();
  const r = await notify({ to: PHONE, text: 'texto', template: { key: 'aviso_cita_cancelada', body: ['a', 'b', 'c'] }, token: TOKEN, phoneNumberId: 'pnid-negocio', lastInbound: null, kind: 'prueba' });
  assert.equal(r.via, 'text');
  assert.equal(posts[0].body.type, 'text');
  const line = logs.find((l) => String(l[1]).includes('WA_PLANTILLA_VARIABLES'));
  assert.deepEqual([line[2].esperadas, line[2].recibidas], [4, 3]);
  noSecrets();
});
