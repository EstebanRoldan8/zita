// Plantillas apagadas sin que nadie se entere: flag normalizado, estado al arrancar, fallos de entrega como alerta
// y escalamientos registrados. Ejecutar: node --test tests/bot-plantillas-estado.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';
const BIZ = 'biz-1';
const PNID = 'pnid-1';
const CLIENT = '573001112233';
const OWNER = '573000000000';

let failInsert = false;
const fake = createFakeSupabase({}, { failOn: (table, op) => failInsert && table === 'system_alerts' && op === 'insert' });
const env = installFakes(fake);
const { templatesEnabled, logTemplatesStatus } = require('../src/services/whatsappNotify');
const { handleWebhook, extractFailedStatuses } = require('../src/controllers/webhook.controller');
const escalar = require('../src/services/chatbot/tools/escalar_a_humano');

function seed() {
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  env.logs.length = 0; env.sent.length = 0;
  Object.assign(fake.db, {
    businesses: [{ id: BIZ, name: 'Barbería Test', phone: OWNER, whatsapp_phone_number_id: PNID, whatsapp_access_token: null }],
    whatsapp_conversations: [{ id: 'c1', business_id: BIZ, client_phone: CLIENT, messages: [] }],
    system_alerts: [], wa_processed_messages: [],
  });
}
const noPii = () => {
  const all = JSON.stringify(env.logs) + JSON.stringify(fake.db.system_alerts || []);
  assert.equal(all.includes(CLIENT), false, 'sin teléfono del cliente completo');
  assert.equal(all.includes(OWNER), false, 'sin teléfono del dueño completo');
};

// ── C1: flag normalizado ─────────────────────────────────────────────────────────
test('WA_TEMPLATES_ENABLED: espacios y mayúsculas no lo apagan; acepta true/1/yes', () => {
  for (const v of ['true', ' true ', 'TRUE', 'True\n', '1', 'yes', 'YES', ' Yes ']) {
    process.env.WA_TEMPLATES_ENABLED = v;
    assert.equal(templatesEnabled(), true, JSON.stringify(v));
  }
  for (const v of ['false', '', '0', 'no', 'tru', 'enabled ya']) {
    process.env.WA_TEMPLATES_ENABLED = v;
    assert.equal(templatesEnabled(), false, JSON.stringify(v));
  }
  delete process.env.WA_TEMPLATES_ENABLED;
  assert.equal(templatesEnabled(), false);
});

// ── C2: estado al arrancar ───────────────────────────────────────────────────────
test('al arrancar: [WA_PLANTILLAS_ESTADO]; apagado en producción → warning claro y sin secretos', () => {
  const lines = [];
  const log = { info: (...a) => lines.push(['info', ...a]), warn: (...a) => lines.push(['warn', ...a]) };
  const prevEnv = process.env.NODE_ENV;
  process.env.WHATSAPP_ACCESS_TOKEN = 'EAAG-secreto';
  try {
    process.env.NODE_ENV = 'production';
    process.env.WA_TEMPLATES_ENABLED = 'false';
    assert.equal(logTemplatesStatus(log), false);
    assert.match(lines[0][1], /\[WA_PLANTILLAS_ESTADO\] enabled=false/);
    assert.equal(lines[1][0], 'warn');
    assert.match(lines[1][1], /NO llegarán/);
    lines.length = 0;
    process.env.WA_TEMPLATES_ENABLED = ' TRUE ';
    assert.equal(logTemplatesStatus(log), true);
    assert.match(lines[0][1], /enabled=true/);
    assert.equal(lines.some((l) => l[0] === 'warn'), false);
    lines.length = 0;
    process.env.NODE_ENV = 'development';
    process.env.WA_TEMPLATES_ENABLED = 'false';
    logTemplatesStatus(log);
    assert.equal(lines.some((l) => l[0] === 'warn'), false, 'fuera de producción solo el estado');
    assert.equal(JSON.stringify(lines).includes('EAAG-secreto'), false);
  } finally {
    process.env.NODE_ENV = prevEnv;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
  }
});

// ── C3: estados fallidos del webhook ─────────────────────────────────────────────
const statusBody = (pnid, codes = [131047]) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: { metadata: { phone_number_id: pnid }, statuses: [{ id: 'wamid.x', status: 'failed', recipient_id: OWNER, errors: codes.map((code) => ({ code, title: 'Re-engagement message' })) }] } }] }],
});
function resWithClock() {
  const r = { code: null, at: null };
  r.sendStatus = (c) => { r.code = c; r.at = fake.db.system_alerts.length; return r; };
  r.status = r.sendStatus;
  return r;
}

test('estado failed 131047 → 200 de inmediato y alerta whatsapp_entrega_fallida con el negocio resuelto', async () => {
  seed();
  const r = resWithClock();
  await handleWebhook({ body: statusBody(PNID) }, r);
  assert.equal(r.code, 200);
  assert.equal(r.at, 0, 'el 200 sale antes de registrar la alerta');
  const a = fake.db.system_alerts.find((x) => x.tipo === 'whatsapp_entrega_fallida');
  assert.ok(a);
  assert.equal(a.business_id, BIZ);
  assert.deepEqual(a.metadata.codes, [131047]);
  assert.equal(a.metadata.fuera_de_ventana, true);
  assert.match(a.mensaje, /fuera de la ventana/);
  noPii();
});

test('otro error de entrega y número desconocido → alerta con business_id null', async () => {
  seed();
  await handleWebhook({ body: statusBody('pnid-desconocido', [131026]) }, resWithClock());
  const a = fake.db.system_alerts[0];
  assert.equal(a.business_id, null);
  assert.deepEqual(a.metadata.codes, [131026]);
  assert.equal(a.metadata.fuera_de_ventana, false);
});

test('si registrar la alerta falla, el webhook igual responde 200 y no lanza', async () => {
  seed();
  failInsert = true;
  try {
    const r = resWithClock();
    await handleWebhook({ body: statusBody(PNID) }, r);
    assert.equal(r.code, 200);
  } finally {
    failInsert = false;
  }
});

test('estados entregados/leídos no generan alerta', async () => {
  seed();
  const body = statusBody(PNID);
  body.entry[0].changes[0].value.statuses[0].status = 'delivered';
  assert.deepEqual(extractFailedStatuses(body), []);
  await handleWebhook({ body }, resWithClock());
  assert.equal(fake.db.system_alerts.length, 0);
});

// ── C4: escalamiento ─────────────────────────────────────────────────────────────
const ctx = { businessId: BIZ, clientPhone: CLIENT, business: { id: BIZ, whatsapp_phone_number_id: PNID, whatsapp_access_token: null }, clientInfo: { name: 'Juan Pérez' } };

test('escalamiento con plantillas apagadas y fuera de ventana: [ESCALAMIENTO_POSIBLE_NO_ENTREGADO] + alerta escalamiento_humano', async () => {
  seed();
  process.env.WA_TEMPLATES_ENABLED = 'false';
  const r = await escalar({ motivo: 'Quiere hablar con el dueño' }, ctx);
  assert.equal(r.success, true, 'al cliente se le responde igual');
  assert.equal(env.sent[0].type, 'text');
  assert.ok(env.logs.some((l) => String(l[1]).includes('ESCALAMIENTO_POSIBLE_NO_ENTREGADO')));
  const a = fake.db.system_alerts.find((x) => x.tipo === 'escalamiento_humano');
  assert.equal(a.business_id, BIZ);
  assert.equal(a.metadata.posible_no_entregado, true);
  assert.equal(a.metadata.motivo, 'Quiere hablar con el dueño');
  noPii();
});

test('escalamiento con plantillas activas: sale la plantilla, sin el warning, y la escalación queda guardada', async () => {
  seed();
  process.env.WA_TEMPLATES_ENABLED = 'true';
  try {
    await escalar({ motivo: 'Queja' }, ctx);
    assert.equal(env.sent[0].type, 'template');
    assert.equal(env.logs.some((l) => String(l[1]).includes('ESCALAMIENTO_POSIBLE_NO_ENTREGADO')), false);
    assert.equal(fake.db.system_alerts.find((x) => x.tipo === 'escalamiento_humano').metadata.posible_no_entregado, false);
  } finally {
    process.env.WA_TEMPLATES_ENABLED = 'false';
  }
});

test('escalamiento con el dueño dentro de la ventana: texto que sí llega, sin warning', async () => {
  seed();
  process.env.WA_TEMPLATES_ENABLED = 'false';
  fake.db.whatsapp_conversations.push({ id: 'c2', business_id: BIZ, client_phone: OWNER, messages: [{ role: 'user', content: 'hola', timestamp: new Date(Date.now() - 3600000).toISOString() }] });
  await escalar({ motivo: 'Queja' }, ctx);
  assert.equal(env.sent[0].type, 'text');
  assert.equal(env.logs.some((l) => String(l[1]).includes('ESCALAMIENTO_POSIBLE_NO_ENTREGADO')), false);
});
