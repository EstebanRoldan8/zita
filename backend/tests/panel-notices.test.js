// Avisos de WhatsApp que inicia el PANEL: pasan por notify() (ventana de 24 h + plantillas aprobadas),
// salen del número del negocio y no dejan PII en los logs. Ejecutar: node --test tests/panel-notices.test.js
process.env.ENCRYPT_SECRET = process.env.ENCRYPT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');
const { call } = require('./helpers/http');

const fake = createFakeSupabase({});
const { sent, logs } = installFakes(fake);
const { encrypt } = require('../src/utils/encrypt');
const clients = require('../src/controllers/clients.controller');
const { notifyReassignment } = require('../src/controllers/employees.controller');
const { notifyOwnerNow } = require('../src/controllers/store.controller');

const BIZ = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const PHONE = '573001112233';
const TOKEN = 'EAAG-token-negocio';
const HOURS = 3600000;

function seed({ lastInboundHoursAgo = null, pnid = 'pnid-negocio', token = TOKEN } = {}) {
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  sent.length = 0; logs.length = 0;
  Object.assign(fake.db, {
    businesses: [{ id: BIZ, name: 'Barbería Test', recall_message: null, whatsapp_phone_number_id: pnid, whatsapp_access_token: token ? encrypt(token) : null }],
    clients: [{ id: CLIENT, business_id: BIZ, name: 'Carlos', phone: '3001112233' }],
    whatsapp_conversations: lastInboundHoursAgo === null ? [] : [{
      id: 'conv', business_id: BIZ, client_phone: PHONE,
      messages: [{ role: 'user', content: 'hola', timestamp: new Date(Date.now() - lastInboundHoursAgo * HOURS).toISOString() }],
    }],
  });
}
const noPii = () => {
  const all = JSON.stringify(logs);
  assert.equal(all.includes(PHONE), false, 'sin teléfono completo');
  assert.equal(all.includes('3001112233'), false, 'sin teléfono local completo');
  assert.equal(all.includes(TOKEN), false, 'sin token');
  assert.equal(all.includes('Hace un tiempo no te vemos'), false, 'sin el texto del mensaje');
};

// ── Recordatorio manual a un cliente (Clientes → Recordar) ──────────────────────
test('recordatorio dentro de la ventana: texto libre desde el número del negocio', async () => {
  process.env.WA_TEMPLATES_ENABLED = 'true';
  seed({ lastInboundHoursAgo: 2 });
  const r = await call(clients.recallClient, { businessId: BIZ, params: { id: CLIENT } });
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
  assert.deepEqual([sent[0].type, sent[0].to, sent[0].token, sent[0].pnid], ['text', PHONE, TOKEN, 'pnid-negocio']);
  assert.match(sent[0].text, /Carlos/);
  noPii();
});

test('recordatorio fuera de la ventana con plantillas activas: te_extranamos (es_CO) con nombre y negocio', async () => {
  process.env.WA_TEMPLATES_ENABLED = 'true';
  seed({ lastInboundHoursAgo: 72 });
  const r = await call(clients.recallClient, { businessId: BIZ, params: { id: CLIENT } });
  assert.equal(r.status, 200);
  assert.deepEqual([sent[0].type, sent[0].name, sent[0].lang], ['template', 'te_extranamos', 'es_CO']);
  assert.deepEqual(sent[0].components.body, ['Carlos', 'Barbería Test']);
  assert.equal(sent[0].token, TOKEN);
  noPii();
});

test('recordatorio fuera de la ventana con plantillas apagadas: texto como antes + aviso', async () => {
  process.env.WA_TEMPLATES_ENABLED = 'false';
  seed({ lastInboundHoursAgo: 72 });
  const r = await call(clients.recallClient, { businessId: BIZ, params: { id: CLIENT } });
  assert.equal(r.status, 200);
  assert.equal(sent[0].type, 'text');
  assert.ok(logs.some((l) => String(l[1]).includes('WA_FUERA_DE_VENTANA_SIN_PLANTILLA')));
});

test('recordatorio: si WhatsApp rechaza el envío, el panel NO dice "enviado"', async () => {
  process.env.WA_TEMPLATES_ENABLED = 'false';
  seed({ lastInboundHoursAgo: 2 });
  const wa = require('../src/config/whatsapp');
  const original = wa.sendMessage;
  wa.sendMessage = async () => ({ success: false, error: 'boom', status: 400 });
  try {
    const r = await call(clients.recallClient, { businessId: BIZ, params: { id: CLIENT } });
    assert.equal(r.status, 502);
    assert.equal(r.body.success, false);
  } finally {
    wa.sendMessage = original;
  }
});

test('recordatorio sin WhatsApp conectado: 400 claro, sin intentar enviar', async () => {
  seed({ token: null });
  const r = await call(clients.recallClient, { businessId: BIZ, params: { id: CLIENT } });
  assert.equal(r.status, 400);
  assert.equal(sent.length, 0);
});

// ── Reasignación de citas al eliminar un empleado ───────────────────────────────
test('reasignación: sale del número del negocio con SU token (antes podía mezclar token global y número del negocio)', async () => {
  seed({ lastInboundHoursAgo: 2 });
  const cita = { id: 'cita-1', scheduled_at: '2030-11-12T15:00:00-05:00', services: { name: 'Corte' }, clients: { phone: PHONE } };
  await notifyReassignment({ business: fake.db.businesses[0], businessId: BIZ, cita, newEmployeeName: 'Pedro' });
  assert.equal(sent.length, 1);
  assert.deepEqual([sent[0].type, sent[0].token, sent[0].pnid], ['text', TOKEN, 'pnid-negocio']);
  assert.match(sent[0].text, /Pedro/);
  noPii();
});

test('reasignación sin token del negocio: no sale (ni con el token global)', async () => {
  seed({ token: null });
  const cita = { id: 'cita-1', scheduled_at: '2030-11-12T15:00:00-05:00', services: { name: 'Corte' }, clients: { phone: PHONE } };
  await notifyReassignment({ business: fake.db.businesses[0], businessId: BIZ, cita, newEmployeeName: 'Pedro' });
  assert.equal(sent.length, 0);
});

test('reasignación fuera de la ventana con plantillas apagadas: texto como hoy y queda marcado en el log', async () => {
  process.env.WA_TEMPLATES_ENABLED = 'false';
  seed({ lastInboundHoursAgo: 72 });
  const cita = { id: 'cita-1', scheduled_at: '2030-11-12T15:00:00-05:00', services: { name: 'Corte' }, clients: { phone: PHONE } };
  await notifyReassignment({ business: fake.db.businesses[0], businessId: BIZ, cita, newEmployeeName: 'Pedro' });
  assert.equal(sent[0].type, 'text');
  const line = logs.find((l) => String(l[1]).includes('WA_FUERA_DE_VENTANA_SIN_PLANTILLA'));
  assert.ok(line);
  assert.equal(line[2].kind, 'cita_reasignada');
  assert.equal(line[2].template, 'aviso_cita_reasignada');
  noPii();
});

// ── Aviso de pedido web al dueño (tienda) ───────────────────────────────────────
test('pedido web: aviso al dueño por notify() desde el número del negocio', async () => {
  seed();
  const contact = { owner_whatsapp: '573009998877', whatsapp_phone_number_id: 'pnid-negocio', whatsapp_access_token: encrypt(TOKEN), business_id: BIZ };
  const order = { id: 'aaaaaaaa-0000-4000-8000-000000000001', total_amount: 50000, discount_amount: 0 };
  await notifyOwnerNow(contact, order, [{ quantity: 1, description: 'Camiseta' }], { name: 'Ana', phone: '573001112233' }, 'Medellín');
  assert.equal(sent.length, 1);
  assert.deepEqual([sent[0].type, sent[0].to, sent[0].token, sent[0].pnid], ['text', '573009998877', TOKEN, 'pnid-negocio']);
  assert.match(sent[0].text, /Nuevo pedido web/);
  assert.equal(JSON.stringify(logs).includes(TOKEN), false);
});
