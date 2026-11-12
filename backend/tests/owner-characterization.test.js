// Caracterización del comportamiento ACTUAL del dueño al completar/cancelar citas y vender productos.
// Fija los efectos secundarios (loyalty, puntos, ingreso, egreso, WhatsApp) para que la extracción
// a servicios compartidos (panel de empleados) no los cambie. Ejecutar: node --test tests/owner-characterization.test.js
process.env.ENCRYPT_SECRET = process.env.ENCRYPT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');
const { call } = require('./helpers/http');

const fake = createFakeSupabase({});
const { sent } = installFakes(fake);
const rpcCalls = [];
const originalRpc = fake.rpc;
fake.rpc = async (name, params) => {
  if (name === 'adjust_stock') { rpcCalls.push(params); return { data: 7, error: null }; }
  return originalRpc(name, params);
};

const { encrypt } = require('../src/utils/encrypt');
const appointments = require('../src/controllers/appointments.controller');
const products = require('../src/controllers/products.controller');

const BIZ = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const SERVICE = '33333333-3333-4333-8333-333333333333';
const EMP = '44444444-4444-4444-8444-444444444444';
const APPT = '55555555-5555-4555-8555-555555555555';
const PROD = '66666666-6666-4666-8666-666666666666';

function seed(extra = {}) {
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  rpcCalls.length = 0;
  sent.length = 0;
  Object.assign(fake.db, {
    businesses: [{ id: BIZ, user_id: 'user-owner', name: 'Barbería Test', country: 'colombia', plan: 'pro', whatsapp_access_token: encrypt('tok') }],
    clients: [{ id: CLIENT, business_id: BIZ, name: 'Carlos Ruiz', phone: '573001112233', loyalty_points: 5 }],
    services: [{ id: SERVICE, business_id: BIZ, name: 'Corte clásico', price: 30000, duration_minutes: 30 }],
    employees: [{ id: EMP, business_id: BIZ, name: 'Juan', commission_percent: 10, is_active: true }],
    appointments: [{
      id: APPT, business_id: BIZ, client_id: CLIENT, service_id: SERVICE, employee_id: EMP,
      scheduled_at: '2026-11-12T15:00:00-05:00', status: 'confirmed', price: 30000, source: 'manual', is_reward: false,
    }],
    ...extra,
  });
}

const owner = (over) => ({ businessId: BIZ, role: 'owner', ...over });

test('completar (dueño): estado, visitas, puntos, transacción e ingreso', async () => {
  seed();
  const r = await call(appointments.update, owner({ params: { id: APPT }, body: { status: 'completed' } }));
  assert.equal(r.status, 200);
  assert.equal(fake.db.appointments[0].status, 'completed');
  assert.deepEqual(
    fake.db.client_loyalty.map(({ business_id, client_id, total_visits, loyalty_visits }) => ({ business_id, client_id, total_visits, loyalty_visits })),
    [{ business_id: BIZ, client_id: CLIENT, total_visits: 1, loyalty_visits: 1 }],
  );
  assert.equal(fake.db.clients[0].loyalty_points, 15, '10 puntos por defecto sin loyalty_config');
  assert.equal(fake.db.loyalty_transactions.length, 1);
  assert.equal(fake.db.loyalty_transactions[0].points, 10);
  assert.equal(fake.db.income.length, 1);
  const inc = fake.db.income[0];
  assert.equal(inc.amount, 30000);
  assert.equal(inc.category, 'servicios');
  assert.equal(inc.source, 'appointment');
  assert.equal(inc.appointment_id, APPT);
  assert.equal(inc.client_id, CLIENT);
  assert.equal(inc.description, 'Corte clásico - agendado manualmente');
  assert.equal(fake.db.expenses, undefined, 'sin egreso si no es recompensa');
  assert.equal(sent.length, 0);
});

test('completar cita de recompensa: egreso del costo y la visita no suma para la recompensa', async () => {
  seed();
  fake.db.appointments[0].is_reward = true;
  const r = await call(appointments.update, owner({ params: { id: APPT }, body: { status: 'completed' } }));
  assert.equal(r.status, 200);
  assert.equal(fake.db.client_loyalty[0].total_visits, 1);
  assert.equal(fake.db.client_loyalty[0].loyalty_visits, 0);
  assert.equal(fake.db.expenses.length, 1);
  assert.equal(fake.db.expenses[0].amount, 30000);
  assert.equal(fake.db.expenses[0].description, 'Servicio de recompensa para Carlos Ruiz');
});

test('completar una cita ya completada no repite efectos', async () => {
  seed();
  fake.db.appointments[0].status = 'completed';
  const r = await call(appointments.update, owner({ params: { id: APPT }, body: { status: 'completed' } }));
  assert.equal(r.status, 200);
  assert.equal(fake.db.income, undefined);
  assert.equal(fake.db.client_loyalty, undefined);
});

test('cancelar cita de WhatsApp: avisa al cliente y limpia la conversación', async () => {
  seed();
  fake.db.appointments[0].source = 'whatsapp';
  const r = await call(appointments.update, owner({ params: { id: APPT }, body: { status: 'cancelled' } }));
  assert.equal(r.status, 200);
  assert.equal(fake.db.appointments[0].status, 'cancelled');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '573001112233');
  assert.match(sent[0].text, /Corte clásico/);
  assert.match(sent[0].text, /cancelada/);
  assert.deepEqual(fake.db.whatsapp_conversations.map((c) => c.messages), [[]]);
  assert.equal(fake.db.income, undefined);
});

test('cancelar cita manual: no envía WhatsApp', async () => {
  seed();
  const r = await call(appointments.update, owner({ params: { id: APPT }, body: { status: 'cancelled' } }));
  assert.equal(r.status, 200);
  assert.equal(fake.db.appointments[0].status, 'cancelled');
  assert.equal(sent.length, 0);
});

test('estado inválido → 400', async () => {
  seed();
  const r = await call(appointments.update, owner({ params: { id: APPT }, body: { status: 'hecha' } }));
  assert.equal(r.status, 400);
});

function seedProduct(over = {}) {
  seed({ products: [{ id: PROD, business_id: BIZ, name: 'Cera mate', price: 25000, cost_price: 10000, stock: 9, is_active: true, is_bundle: false, has_variants: false, ...over }] });
}

test('vender (dueño): stock por RPC, venta, ingreso y egreso de costo', async () => {
  seedProduct();
  const r = await call(products.sell, owner({ params: { id: PROD }, body: { quantity: 2, client_id: CLIENT } }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, data: { stock: 7, total_amount: 50000 } });
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].p_change, -2);
  assert.equal(rpcCalls[0].p_type, 'venta');
  assert.equal(rpcCalls[0].p_ref_type, 'product_sale');
  assert.equal(fake.db.product_sales.length, 1);
  const sale = fake.db.product_sales[0];
  assert.equal(sale.id, rpcCalls[0].p_ref_id, 'el movimiento queda enlazado a la venta');
  assert.equal(sale.quantity, 2);
  assert.equal(sale.total_amount, 50000);
  assert.equal(sale.client_id, CLIENT);
  assert.equal(sale.sold_via, 'presencial');
  assert.equal(fake.db.income.length, 1);
  assert.equal(fake.db.income[0].category, 'productos');
  assert.equal(fake.db.income[0].source, 'product_sale');
  assert.equal(fake.db.income[0].description, 'Venta: Cera mate ×2');
  assert.equal(fake.db.expenses.length, 1);
  assert.equal(fake.db.expenses[0].amount, 20000);
  assert.equal(fake.db.expenses[0].description, 'Costo de venta: Cera mate (2 unidades)');
});

test('vender producto sin costo: no registra egreso', async () => {
  seedProduct({ cost_price: null });
  const r = await call(products.sell, owner({ params: { id: PROD }, body: { quantity: 1 } }));
  assert.equal(r.status, 200);
  assert.equal(fake.db.expenses, undefined);
  assert.equal(fake.db.income[0].description, 'Venta: Cera mate');
});

test('vender un set o con cantidad inválida → 400', async () => {
  seedProduct({ is_bundle: true });
  assert.equal((await call(products.sell, owner({ params: { id: PROD }, body: { quantity: 1 } }))).status, 400);
  seedProduct();
  assert.equal((await call(products.sell, owner({ params: { id: PROD }, body: { quantity: 0 } }))).status, 400);
  assert.equal((await call(products.sell, owner({ params: { id: PROD }, body: { quantity: 1.5 } }))).status, 400);
  assert.equal(rpcCalls.length, 0);
});

test('vender producto de otro negocio → 404', async () => {
  seedProduct({ business_id: '99999999-9999-4999-8999-999999999999' });
  const r = await call(products.sell, owner({ params: { id: PROD }, body: { quantity: 1 } }));
  assert.equal(r.status, 404);
});
