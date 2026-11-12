// Panel del empleado (/api/me) por HTTP real: aislamiento por negocio y por empleado, ventas sin costo,
// comisiones propias. Ejecutar: node --test tests/employee-panel.test.js
process.env.ENCRYPT_SECRET = process.env.ENCRYPT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');
const { stubModule } = require('./helpers/http');

const fake = createFakeSupabase({});
const { sent } = installFakes(fake);
fake.rpc = async (name) => (name === 'adjust_stock' ? { data: 3, error: null } : { data: null, error: null });
// verifyToken de prueba: "Bearer <userId>"
stubModule('middlewares/auth', {
  verifyToken: (req, res, next) => {
    const id = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!id) return res.status(401).json({ success: false });
    req.user = { id };
    return next();
  },
});

const meRoutes = require('../src/routes/me.routes');

const BIZ = '11111111-1111-4111-8111-111111111111';
const BIZ2 = '22222222-2222-4222-8222-222222222222';
const u = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const EMP = u(3); const EMP_OTHER = u(4); const EMP_BIZ2 = u(5);
const CLIENT = u(6); const CLIENT_BIZ2 = u(7); const SERVICE = u(8); const SERVICE_BIZ2 = u(9);
const A_MINE = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const A_OTHER_EMP = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
const A_BIZ2 = 'a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3';
const PROD = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const PROD_BIZ2 = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const future = new Date(Date.now() + 365 * 86400000).toISOString();

function seed() {
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  sent.length = 0;
  Object.assign(fake.db, {
    businesses: [
      { id: BIZ, user_id: 'owner-1', name: 'Barbería Uno', country: 'colombia', plan: 'pro', business_type: 'barberia', plan_expires_at: future, modules: null },
      { id: BIZ2, user_id: 'owner-2', name: 'Barbería Dos', country: 'colombia', plan: 'pro', business_type: 'barberia', plan_expires_at: future },
    ],
    employees: [
      { id: EMP, business_id: BIZ, name: 'Juan', is_active: true, user_id: 'barber-1', commission_percent: 0 },
      { id: EMP_OTHER, business_id: BIZ, name: 'Pedro', is_active: true, user_id: 'barber-2', commission_percent: 50 },
      { id: EMP_BIZ2, business_id: BIZ2, name: 'Luis', is_active: true, user_id: 'barber-3', commission_percent: 20 },
    ],
    clients: [
      { id: CLIENT, business_id: BIZ, name: 'Ana', phone: '3001112233', archived: false },
      { id: CLIENT_BIZ2, business_id: BIZ2, name: 'Ajena', phone: '3009998877', archived: false },
    ],
    services: [
      { id: SERVICE, business_id: BIZ, name: 'Corte', price: 20000, duration_minutes: 30, active: true },
      { id: SERVICE_BIZ2, business_id: BIZ2, name: 'Ajeno', price: 1, duration_minutes: 30, active: true },
    ],
    appointments: [
      { id: A_MINE, business_id: BIZ, employee_id: EMP, client_id: CLIENT, service_id: SERVICE, status: 'confirmed', price: 20000, source: 'manual', scheduled_at: `${today}T10:00:00-05:00` },
      { id: A_OTHER_EMP, business_id: BIZ, employee_id: EMP_OTHER, client_id: CLIENT, service_id: SERVICE, status: 'confirmed', price: 30000, source: 'manual', scheduled_at: `${today}T11:00:00-05:00` },
      { id: A_BIZ2, business_id: BIZ2, employee_id: EMP_BIZ2, client_id: CLIENT_BIZ2, service_id: SERVICE_BIZ2, status: 'confirmed', price: 1, source: 'manual', scheduled_at: `${today}T12:00:00-05:00` },
    ],
    products: [
      { id: PROD, business_id: BIZ, name: 'Cera', price: 25000, cost_price: 10000, stock: 4, is_active: true, is_bundle: false, has_variants: false },
      { id: PROD_BIZ2, business_id: BIZ2, name: 'Ajeno', price: 1, cost_price: 1, stock: 4, is_active: true, is_bundle: false, has_variants: false },
    ],
  });
}

let server; let base;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/me', meRoutes);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function api(method, path, user, body) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

test('GET /api/me: empleado ve su rol, negocio y módulos; dueño ve rol owner', async () => {
  seed();
  const e = await api('GET', '/api/me', 'barber-1');
  assert.equal(e.status, 200);
  assert.equal(e.body.data.role, 'employee');
  assert.deepEqual(e.body.data.employee, { id: EMP, name: 'Juan' });
  assert.equal(e.body.data.business.id, BIZ);
  assert.deepEqual(e.body.data.allowed_modules, ['agenda', 'clientes', 'productos', 'comisiones']);
  const o = await api('GET', '/api/me', 'owner-1');
  assert.equal(o.body.data.role, 'owner');
  assert.equal(o.body.data.allowed_modules, null);
  assert.equal((await api('GET', '/api/me', 'nadie')).status, 404);
});

test('módulos: plan Lite sin clientes ni productos; módulo apagado por el dueño → 403', async () => {
  seed();
  fake.db.businesses[0].plan = 'lite';
  assert.deepEqual((await api('GET', '/api/me', 'barber-1')).body.data.allowed_modules, ['agenda', 'comisiones']);
  assert.equal((await api('GET', '/api/me/clients', 'barber-1')).status, 403);
  assert.equal((await api('GET', '/api/me/products', 'barber-1')).status, 403);
  fake.db.businesses[0].plan = 'pro';
  fake.db.businesses[0].modules = { productos: false };
  assert.equal((await api('GET', '/api/me/products', 'barber-1')).status, 403);
  assert.equal((await api('GET', '/api/me/clients', 'barber-1')).status, 200);
});

test('el dueño no usa los endpoints del empleado (403)', async () => {
  seed();
  assert.equal((await api('GET', '/api/me/appointments', 'owner-1')).status, 403);
  assert.equal((await api('GET', '/api/me/commissions', 'owner-1')).status, 403);
});

test('plan vencido: el empleado también queda bloqueado', async () => {
  seed();
  fake.db.businesses[0].plan_expires_at = '2020-01-01T00:00:00Z';
  const r = await api('GET', '/api/me/appointments', 'barber-1');
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'SUBSCRIPTION_EXPIRED');
});

test('citas: solo ve las suyas (ni de otro barbero ni de otro negocio)', async () => {
  seed();
  const r = await api('GET', `/api/me/appointments?date=${today}`, 'barber-1');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.map((a) => a.id), [A_MINE]);
  assert.equal((await api('GET', '/api/me/appointments?date=2026-13-45x', 'barber-1')).status, 400);
  assert.equal((await api('GET', '/api/me/appointments?from=2026-01-01&to=2026-03-01', 'barber-1')).status, 400);
});

test('marcar como hecha: propia → completed con ingreso; de otro barbero o de otro negocio → 404 sin cambios', async () => {
  seed();
  const mine = await api('POST', `/api/me/appointments/${A_MINE}/complete`, 'barber-1');
  assert.equal(mine.status, 200);
  assert.equal(fake.db.appointments[0].status, 'completed');
  assert.equal(fake.db.income.length, 1);
  assert.equal(fake.db.income[0].amount, 20000);
  for (const id of [A_OTHER_EMP, A_BIZ2]) {
    assert.equal((await api('POST', `/api/me/appointments/${id}/complete`, 'barber-1')).status, 404);
    assert.equal((await api('POST', `/api/me/appointments/${id}/cancel`, 'barber-1')).status, 404);
  }
  assert.equal(fake.db.appointments[1].status, 'confirmed');
  assert.equal(fake.db.appointments[2].status, 'confirmed');
  assert.equal(fake.db.income.length, 1);
});

test('cancelar propia; no se puede completar una cancelada ni repetir', async () => {
  seed();
  assert.equal((await api('POST', `/api/me/appointments/${A_MINE}/cancel`, 'barber-1')).status, 200);
  assert.equal(fake.db.appointments[0].status, 'cancelled');
  assert.equal((await api('POST', `/api/me/appointments/${A_MINE}/complete`, 'barber-1')).status, 409);
  assert.equal((await api('POST', `/api/me/appointments/${A_MINE}/cancel`, 'barber-1')).status, 409);
  assert.equal(fake.db.income, undefined);
});

test('crear cita: queda asignada a él aunque mande otro employee_id o business_id', async () => {
  seed();
  const r = await api('POST', '/api/me/appointments', 'barber-1', {
    service_id: SERVICE, client_id: CLIENT, scheduled_at: '2026-12-01T09:00', employee_id: EMP_OTHER, business_id: BIZ2, price: 1,
  });
  assert.equal(r.status, 201);
  const created = fake.db.appointments.at(-1);
  assert.equal(created.employee_id, EMP);
  assert.equal(created.business_id, BIZ);
  assert.equal(created.price, 20000, 'el precio sale del servicio, no del body');
  assert.equal(created.scheduled_at, '2026-12-01T09:00:00-05:00');
});

test('crear cita con cliente o servicio de otro negocio → 400', async () => {
  seed();
  assert.equal((await api('POST', '/api/me/appointments', 'barber-1', { service_id: SERVICE, client_id: CLIENT_BIZ2, scheduled_at: '2026-12-01T09:00' })).status, 400);
  assert.equal((await api('POST', '/api/me/appointments', 'barber-1', { service_id: SERVICE_BIZ2, scheduled_at: '2026-12-01T09:00' })).status, 400);
  assert.equal((await api('POST', '/api/me/appointments', 'barber-1', { service_id: SERVICE, scheduled_at: 'mañana' })).status, 400);
  assert.equal(fake.db.appointments.length, 3);
});

test('clientes: lista sin archivados y crea en su negocio', async () => {
  seed();
  fake.db.clients.push({ id: u('c'), business_id: BIZ, name: 'Archivado', phone: '3000000000', archived: true });
  const l = await api('GET', '/api/me/clients', 'barber-1');
  assert.deepEqual(l.body.data.map((c) => c.name), ['Ana']);
  const c = await api('POST', '/api/me/clients', 'barber-1', { name: 'carlos ruiz', phone: '+57 300 555 6677', business_id: BIZ2 });
  assert.equal(c.status, 201);
  assert.equal(fake.db.clients.at(-1).business_id, BIZ);
  assert.equal(fake.db.clients.at(-1).name, 'Carlos Ruiz');
  assert.equal(fake.db.clients.at(-1).phone, '3005556677');
  assert.equal((await api('POST', '/api/me/clients', 'barber-1', { name: '', phone: '1' })).status, 400);
});

test('productos: listado sin costo; venta sin costo en la respuesta y con sold_by_employee_id', async () => {
  seed();
  const l = await api('GET', '/api/me/products', 'barber-1');
  assert.equal(l.status, 200);
  assert.deepEqual(l.body.data.map((p) => p.id), [PROD]);
  assert.equal(JSON.stringify(l.body).includes('cost'), false);
  const s = await api('POST', `/api/me/products/${PROD}/sell`, 'barber-1', { quantity: 1, sold_via: 'whatsapp' });
  assert.equal(s.status, 200);
  assert.deepEqual(s.body, { success: true, data: { stock: 3, total_amount: 25000 } });
  const sale = fake.db.product_sales[0];
  assert.equal(sale.sold_by_employee_id, EMP);
  assert.equal(sale.sold_via, 'presencial');
  assert.equal(fake.db.expenses.length, 1, 'el egreso del costo se registra igual (para el dueño)');
  assert.equal((await api('POST', `/api/me/products/${PROD_BIZ2}/sell`, 'barber-1', { quantity: 1 })).status, 404);
  assert.equal((await api('POST', `/api/me/products/${PROD}/sell`, 'barber-1', { quantity: 1, appointment_id: A_OTHER_EMP })).status, 400);
});

test('comisiones: solo las propias y 0 % se respeta', async () => {
  seed();
  fake.db.appointments.forEach((a) => { a.status = 'completed'; });
  const r0 = await api('GET', '/api/me/commissions', 'barber-1');
  assert.equal(r0.status, 200);
  assert.equal(r0.body.data.commission_percent, 0);
  assert.equal(r0.body.data.period.appointments, 1);
  assert.equal(r0.body.data.period.income, 20000);
  assert.equal(r0.body.data.period.commission, 0);
  const r2 = await api('GET', '/api/me/commissions', 'barber-2');
  assert.equal(r2.body.data.period.appointments, 1, 'no suma citas de otros');
  assert.equal(r2.body.data.period.commission, 15000);
  assert.equal(r2.body.data.today.commission, 15000);
  assert.equal(JSON.stringify(r2.body).includes('Juan'), false);
  assert.equal((await api('GET', '/api/me/commissions?month=2026-13', 'barber-1')).status, 400);
});

test('empleado desactivado o revocado queda fuera en la siguiente petición', async () => {
  seed();
  assert.equal((await api('GET', '/api/me/appointments', 'barber-1')).status, 200);
  fake.db.employees[0].is_active = false;
  assert.equal((await api('GET', '/api/me/appointments', 'barber-1')).status, 404);
  fake.db.employees[0].is_active = true;
  fake.db.employees[0].user_id = null;
  assert.equal((await api('GET', '/api/me', 'barber-1')).status, 404);
});
