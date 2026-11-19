// Escalaciones del bot en el panel del dueño (/api/escalations) por HTTP real.
// Aislamiento entre negocios, empleado con 403, ids inválidos. Ejecutar: node --test tests/escalations.test.js
process.env.ENCRYPT_SECRET = process.env.ENCRYPT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');
const { stubModule } = require('./helpers/http');

const fake = createFakeSupabase({});
const env = installFakes(fake);
stubModule('middlewares/auth', {
  verifyToken: (req, res, next) => {
    const id = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!id) return res.status(401).json({ success: false });
    req.user = { id };
    return next();
  },
});
const routes = require('../src/routes/escalations.routes');
const escalar = require('../src/services/chatbot/tools/escalar_a_humano');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const u = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const CLI_A = u('a'); const CLI_B = u('b');
const ESC_A = u('c'); const ESC_A_OLD = u('d'); const ESC_B = u('e');
const PHONE_A = '573001112233';
const PHONE_B = '573009998877';
const future = new Date(Date.now() + 2 * 3600000).toISOString();

function seed() {
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  env.logs.length = 0;
  Object.assign(fake.db, {
    businesses: [
      { id: A, user_id: 'owner-a', name: 'Barbería A', phone: '573000000001', plan: 'pro' },
      { id: B, user_id: 'owner-b', name: 'Barbería B', phone: '573000000002', plan: 'pro' },
    ],
    employees: [{ id: u('f'), business_id: A, name: 'Barbero', is_active: true, user_id: 'barber-a' }],
    clients: [
      { id: CLI_A, business_id: A, name: 'Carlos Ruiz', phone: PHONE_A },
      { id: CLI_B, business_id: B, name: 'Ana Ajena', phone: PHONE_B },
    ],
    whatsapp_conversations: [
      { id: 'cv-a', business_id: A, client_phone: PHONE_A, messages: [], bot_paused_until: future },
      { id: 'cv-b', business_id: B, client_phone: PHONE_B, messages: [], bot_paused_until: future },
    ],
    system_alerts: [
      { id: ESC_A, tipo: 'escalamiento_humano', business_id: A, mensaje: 'x', created_at: new Date(Date.now() - 600000).toISOString(),
        metadata: { client_id: CLI_A, cliente: '57300***2233', motivo: '<img src=x onerror=alert(1)> quiero hablar con el dueño' } },
      // Escalación anterior a este cambio: sin client_id
      { id: ESC_A_OLD, tipo: 'escalamiento_humano', business_id: A, mensaje: 'x', created_at: new Date(Date.now() - 86400000).toISOString(),
        metadata: { cliente: '57311***4455', motivo: 'Queja' } },
      { id: ESC_B, tipo: 'escalamiento_humano', business_id: B, mensaje: 'x', created_at: new Date().toISOString(),
        metadata: { client_id: CLI_B, cliente: '57300***8877', motivo: 'Del otro negocio' } },
      // Otro tipo de alerta del mismo negocio: no es una escalación
      { id: u('9'), tipo: 'whatsapp_entrega_fallida', business_id: A, mensaje: 'x', created_at: new Date().toISOString(), metadata: {} },
    ],
  });
}

let server; let base;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/escalations', routes);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/escalations`;
});
test.after(() => server.close());

async function api(method, path, user) {
  const r = await fetch(base + path, { method, headers: user ? { Authorization: `Bearer ${user}` } : {} });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const alert = (id) => fake.db.system_alerts.find((a) => a.id === id);
const conv = (id) => fake.db.whatsapp_conversations.find((c) => c.id === id);

test('GET: el dueño ve SOLO las escalaciones de su negocio, con cliente, teléfono, motivo, fecha y estado', async () => {
  seed();
  const r = await api('GET', '/', 'owner-a');
  assert.equal(r.status, 200);
  const { items, open_count: open } = r.body.data;
  assert.deepEqual(items.map((i) => i.id), [ESC_A, ESC_A_OLD], 'más recientes primero; ni las de B ni otros tipos');
  assert.equal(open, 2);
  const i = items[0];
  assert.equal(i.client_name, 'Carlos Ruiz');
  assert.equal(i.client_phone, PHONE_A);
  assert.equal(i.whatsapp_url, `https://wa.me/${PHONE_A}`);
  assert.equal(i.motivo, '<img src=x onerror=alert(1)> quiero hablar con el dueño', 'el motivo va como texto (lo escapa el frontend)');
  assert.equal(i.bot_paused, true);
  assert.equal(i.attended_at, null);
  assert.equal(i.can_resume_bot, true);
  assert.ok(i.created_at);
  assert.equal(JSON.stringify(r.body).includes(PHONE_B), false);
  assert.equal(JSON.stringify(r.body).includes('Del otro negocio'), false);
});

test('GET: escalación sin client_id (anterior): teléfono enmascarado, sin WhatsApp ni reactivar', async () => {
  seed();
  const old = (await api('GET', '/', 'owner-a')).body.data.items.find((x) => x.id === ESC_A_OLD);
  assert.deepEqual([old.client_name, old.client_phone, old.client_phone_masked, old.whatsapp_url, old.can_resume_bot, old.bot_paused],
    [null, null, '57311***4455', null, false, false]);
});

test('GET: un client_id que apunta a un cliente de OTRO negocio no se resuelve', async () => {
  seed();
  alert(ESC_A).metadata.client_id = CLI_B;
  const i = (await api('GET', '/', 'owner-a')).body.data.items[0];
  assert.equal(i.client_phone, null);
  assert.equal(i.client_name, null);
  assert.equal(JSON.stringify(i).includes(PHONE_B), false);
});

test('attend: marca atendida la propia (idempotente) y baja el contador; la de otro negocio → 404 sin tocarla', async () => {
  seed();
  const r = await api('POST', `/${ESC_A}/attend`, 'owner-a');
  assert.equal(r.status, 200);
  assert.ok(alert(ESC_A).metadata.attended_at);
  assert.equal(alert(ESC_A).metadata.motivo, '<img src=x onerror=alert(1)> quiero hablar con el dueño', 'conserva la metadata');
  assert.equal(alert(ESC_A).read_at, undefined, 'no toca read_at (es del superadmin)');
  const again = await api('POST', `/${ESC_A}/attend`, 'owner-a');
  assert.equal(again.body.data.attended_at, alert(ESC_A).metadata.attended_at);
  assert.equal((await api('GET', '/', 'owner-a')).body.data.open_count, 1);

  assert.equal((await api('POST', `/${ESC_B}/attend`, 'owner-a')).status, 404);
  assert.equal(alert(ESC_B).metadata.attended_at, undefined);
  assert.equal((await api('POST', `/${u('9')}/attend`, 'owner-a')).status, 404, 'otro tipo de alerta no es una escalación');
});

test('resume-bot: limpia la pausa del cliente propio; la de otro negocio → 404 y su pausa sigue', async () => {
  seed();
  const r = await api('POST', `/${ESC_A}/resume-bot`, 'owner-a');
  assert.equal(r.status, 200);
  assert.equal(conv('cv-a').bot_paused_until, null);
  assert.equal(conv('cv-b').bot_paused_until, future, 'no toca la conversación del otro negocio');
  assert.equal((await api('GET', '/', 'owner-a')).body.data.items[0].bot_paused, false);

  seed();
  assert.equal((await api('POST', `/${ESC_B}/resume-bot`, 'owner-a')).status, 404);
  assert.equal(conv('cv-b').bot_paused_until, future);
});

test('resume-bot de una escalación sin client_id: 409 claro, sin tocar nada', async () => {
  seed();
  const r = await api('POST', `/${ESC_A_OLD}/resume-bot`, 'owner-a');
  assert.equal(r.status, 409);
  assert.equal(conv('cv-a').bot_paused_until, future);
});

test('ids inválidos → 400 (no llegan a la base)', async () => {
  seed();
  for (const bad of ['123', 'not-a-uuid', `${ESC_A}x`, "1' or '1'='1"]) {
    assert.equal((await api('POST', `/${encodeURIComponent(bad)}/attend`, 'owner-a')).status, 400, bad);
    assert.equal((await api('POST', `/${encodeURIComponent(bad)}/resume-bot`, 'owner-a')).status, 400, bad);
  }
});

test('el empleado recibe 403 en las tres rutas; sin sesión 401', async () => {
  seed();
  assert.equal((await api('GET', '/', 'barber-a')).status, 403);
  assert.equal((await api('POST', `/${ESC_A}/attend`, 'barber-a')).status, 403);
  assert.equal((await api('POST', `/${ESC_A}/resume-bot`, 'barber-a')).status, 403);
  assert.equal(alert(ESC_A).metadata.attended_at, undefined);
  assert.equal(conv('cv-a').bot_paused_until, future);
  assert.equal((await api('GET', '/')).status, 401);
});

test('el bot guarda client_id en la escalación (para que el panel pueda resolver al cliente)', async () => {
  seed();
  fake.db.system_alerts = [];
  await escalar({ motivo: 'Quiere hablar' }, {
    businessId: A, clientPhone: PHONE_A, business: { id: A, whatsapp_phone_number_id: null, whatsapp_access_token: null },
    clientInfo: { id: CLI_A, name: 'Carlos Ruiz' },
  });
  const a = fake.db.system_alerts.find((x) => x.tipo === 'escalamiento_humano');
  assert.equal(a.metadata.client_id, CLI_A);
  assert.equal(JSON.stringify(a.metadata).includes(PHONE_A), false, 'el teléfono completo no se guarda en la alerta');
});
