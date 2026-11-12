// Rol empleado: resolución en businessContext y allowlist (denegar por defecto).
// La matriz de 403 recorre TODAS las rutas de TODOS los routers: una ruta nueva entra sola al test.
// Ejecutar: node --test tests/employee-roles.test.js
process.env.ENCRYPT_SECRET = process.env.ENCRYPT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');
const { call } = require('./helpers/http');

const fake = createFakeSupabase({});
installFakes(fake);
const { businessContext } = require('../src/middlewares/businessContext');
const { isEmployeeAllowed, EMPLOYEE_ALLOWLIST, requireOwner, requireEmployee } = require('../src/middlewares/roles');

const BIZ = '11111111-1111-4111-8111-111111111111';
const BIZ2 = '22222222-2222-4222-8222-222222222222';
const EMP = '44444444-4444-4444-8444-444444444444';
const ANY = '77777777-7777-4777-8777-777777777777';

function seed(employees) {
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  Object.assign(fake.db, {
    businesses: [
      { id: BIZ, user_id: 'user-owner', name: 'Barbería Uno', country: 'colombia', plan: 'pro', business_type: 'barberia' },
      { id: BIZ2, user_id: 'user-owner-2', name: 'Barbería Dos', country: 'colombia', plan: 'estandar', business_type: 'barberia' },
    ],
    employees: employees || [{ id: EMP, business_id: BIZ, name: 'Juan', is_active: true, user_id: 'user-barber' }],
  });
}

const asEmployee = (method, originalUrl) => ({ user: { id: 'user-barber' }, method, originalUrl });

// ── Resolución del rol ──────────────────────────────────────────
test('dueño: resuelve como owner con los mismos campos de req.business', async () => {
  seed();
  const r = await call(businessContext, { user: { id: 'user-owner' }, method: 'GET', originalUrl: '/api/cash/summary' });
  assert.equal(r.nextCalled, true);
  assert.equal(r.req.role, 'owner');
  assert.equal(r.req.businessId, BIZ);
  assert.deepEqual(Object.keys(r.req.business).sort(), ['business_type', 'country', 'id', 'name', 'plan', 'user_id']);
  assert.equal(r.req.employeeId, null);
});

test('empleado activo: resuelve negocio, rol y employeeId desde el servidor', async () => {
  seed();
  const r = await call(businessContext, asEmployee('GET', '/api/me/appointments?date=2026-11-12'));
  assert.equal(r.nextCalled, true);
  assert.equal(r.req.role, 'employee');
  assert.equal(r.req.businessId, BIZ);
  assert.equal(r.req.employeeId, EMP);
  assert.deepEqual(Object.keys(r.req.business).sort(), ['business_type', 'country', 'id', 'name', 'plan', 'user_id']);
});

test('dueño y empleado a la vez: gana dueño', async () => {
  seed([{ id: EMP, business_id: BIZ2, name: 'Juan', is_active: true, user_id: 'user-owner' }]);
  const r = await call(businessContext, { user: { id: 'user-owner' }, method: 'GET', originalUrl: '/api/cash/summary' });
  assert.equal(r.nextCalled, true);
  assert.equal(r.req.role, 'owner');
  assert.equal(r.req.businessId, BIZ);
});

test('empleado inactivo → 404 (sin acceso)', async () => {
  seed([{ id: EMP, business_id: BIZ, name: 'Juan', is_active: false, user_id: 'user-barber' }]);
  const r = await call(businessContext, asEmployee('GET', '/api/me'));
  assert.equal(r.status, 404);
  assert.equal(r.nextCalled, false);
});

test('empleado revocado (sin vínculo) → 404 en la siguiente petición', async () => {
  seed();
  assert.equal((await call(businessContext, asEmployee('GET', '/api/me'))).nextCalled, true);
  fake.db.employees[0].user_id = null;
  const r = await call(businessContext, asEmployee('GET', '/api/me'));
  assert.equal(r.status, 404);
});

test('usuario sin negocio ni vínculo → 404', async () => {
  seed([]);
  const r = await call(businessContext, { user: { id: 'nadie' }, method: 'GET', originalUrl: '/api/me' });
  assert.equal(r.status, 404);
});

test('si la migración 066 no corrió (columna user_id no existe), el dueño sigue igual y el resto queda fuera', async () => {
  seed();
  const realFrom = fake.from;
  fake.from = (t) => {
    const q = realFrom(t);
    if (t !== 'employees') return q;
    const fail = { data: null, error: { code: '42703', message: 'column employees.user_id does not exist' } };
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => fail, single: async () => fail };
    return chain;
  };
  try {
    assert.equal((await call(businessContext, { user: { id: 'user-owner' }, method: 'GET', originalUrl: '/api/cash' })).req.role, 'owner');
    assert.equal((await call(businessContext, asEmployee('GET', '/api/me'))).status, 404);
  } finally {
    fake.from = realFrom;
  }
});

test('segunda pasada en la misma petición no vuelve a consultar y sigue aplicando la allowlist', async () => {
  seed();
  const r = await call([businessContext, businessContext], asEmployee('GET', '/api/me'));
  assert.equal(r.nextCalled, true);
  const before = fake.calls.length;
  const r2 = await call([businessContext], { ...asEmployee('GET', '/api/cash/summary'), role: 'employee', businessId: BIZ, employeeId: EMP });
  assert.equal(r2.status, 403);
  assert.equal(fake.calls.length, before, 'no consulta la base si ya está resuelto');
});

// ── Allowlist ───────────────────────────────────────────────────
test('allowlist: solo rutas exactas de /api/me con ids UUID', () => {
  assert.equal(isEmployeeAllowed('GET', '/api/me'), true);
  assert.equal(isEmployeeAllowed('POST', `/api/me/appointments/${ANY}/complete`), true);
  assert.equal(isEmployeeAllowed('POST', `/api/me/products/${ANY}/sell`), true);
  for (const [m, p] of [
    ['DELETE', '/api/me'], ['PUT', '/api/me/appointments'], ['POST', '/api/me/appointments/abc/complete'],
    ['POST', `/api/me/appointments/${ANY}/delete`], ['GET', '/api/me/commissions/all'], ['GET', '/api/meX'],
    ['GET', '/api/me/../cash/summary'], ['GET', '/api/me%2F..%2Fcash'], ['HEAD', '/api/me'], ['GET', '/API/ME/clients/x'],
    ['DELETE', `/api/me/clients/${ANY}`], ['PATCH', `/api/me/products/${ANY}`],
  ]) assert.equal(isEmployeeAllowed(m, p), false, `${m} ${p}`);
});

test('allowlist acepta barra final y query string', async () => {
  seed();
  assert.equal((await call(businessContext, asEmployee('GET', '/api/me/clients/?search=ana'))).nextCalled, true);
});

// Prefijos de montaje (app.js). Si se agrega un router nuevo, el test obliga a declararlo aquí.
const MOUNTS = {
  'admin.routes.js': '/api/admin', 'alerts.routes.js': '/api/alerts', 'appointments.routes.js': '/api/appointments',
  'assistant.routes.js': '/api/assistant', 'auth.routes.js': '/api/auth', 'businesses.routes.js': '/api/businesses',
  'cash.routes.js': '/api/cash', 'clients.routes.js': '/api/clients', 'contact.routes.js': '/api/contact',
  'dashboard.routes.js': '/api/dashboard', 'employees.routes.js': '/api/employees', 'expenses.routes.js': '/api/expenses',
  'internal.routes.js': '/api/internal', 'invitations.routes.js': '/api/invitations', 'loyalty.routes.js': '/api/loyalty',
  'me.routes.js': '/api/me', 'metrics.routes.js': '/api/metrics', 'orders.routes.js': '/api/orders',
  'payment.routes.js': '/api/payments', 'productVariants.routes.js': '/api/products', 'products.routes.js': '/api/products',
  'services.routes.js': '/api/services', 'settings.routes.js': '/api/settings', 'store.routes.js': '/api/store',
  'subscription.routes.js': '/api/subscription', 'support.routes.js': '/api/support', 'webhook.routes.js': '/api/webhook',
};
// Routers sin businessContext: públicos, con secreto/firma o solo superadmin (no son del panel del negocio)
const NOT_BUSINESS = new Set(['admin.routes.js', 'auth.routes.js', 'contact.routes.js', 'internal.routes.js', 'invitations.routes.js', 'store.routes.js']);
// Montados con businessContext en app.js (no en el propio router)
const APP_LEVEL_CONTEXT = new Set(['subscription.routes.js']);

function routesOf(file) {
  const mod = require(path.join(__dirname, '..', 'src', 'routes', file));
  const router = typeof mod === 'function' ? mod : (mod.supportRouter || mod.router || Object.values(mod).find((v) => typeof v === 'function'));
  const routerUsesCtx = router.stack.some((l) => !l.route && l.handle === businessContext);
  const out = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const routeUsesCtx = layer.route.stack.some((l) => l.handle === businessContext);
    for (const method of Object.keys(layer.route.methods)) {
      const sub = layer.route.path.replace(/:[A-Za-z_]+/g, ANY);
      out.push({ method: method.toUpperCase(), url: (MOUNTS[file] + sub).replace(/\/$/, '') || '/', guarded: routerUsesCtx || routeUsesCtx || APP_LEVEL_CONTEXT.has(file) });
    }
  }
  return out;
}

test('todos los routers están declarados en el test', () => {
  const files = fs.readdirSync(path.join(__dirname, '..', 'src', 'routes')).filter((f) => f.endsWith('.routes.js'));
  for (const f of files) assert.ok(MOUNTS[f], `router sin declarar en MOUNTS: ${f}`);
});

test('matriz: el empleado recibe 403 en toda ruta del negocio fuera de la allowlist', async () => {
  seed();
  let checked = 0; const usedEntries = new Set();
  for (const file of Object.keys(MOUNTS)) {
    if (NOT_BUSINESS.has(file)) continue;
    for (const { method, url, guarded } of routesOf(file)) {
      if (file === 'webhook.routes.js' && !guarded) continue; // webhook de Meta: firma, sin JWT
      if (file === 'payment.routes.js' && !guarded) continue; // webhook de Wompi: firma, sin JWT
      assert.ok(guarded, `${method} ${url} no pasa por businessContext`);
      const r = await call(businessContext, asEmployee(method, url));
      if (isEmployeeAllowed(method, url)) {
        EMPLOYEE_ALLOWLIST.forEach(([m, re], i) => { if (m === method && re.test(url)) usedEntries.add(i); });
        assert.equal(r.nextCalled, true, `${method} ${url} debería pasar`);
        assert.ok(url.startsWith('/api/me'), `${method} ${url} permitido fuera de /api/me`);
      } else {
        assert.equal(r.status, 403, `${method} ${url} debería ser 403`);
        assert.equal(r.nextCalled, false);
      }
      checked++;
    }
  }
  assert.ok(checked > 120, `se revisaron ${checked} rutas`);
  assert.equal(usedEntries.size, EMPLOYEE_ALLOWLIST.length, 'cada entrada de la allowlist corresponde a una ruta real de /api/me');
});

test('matriz: el dueño pasa por businessContext en todas las rutas del negocio (salvo las solo-empleado)', async () => {
  seed();
  for (const file of Object.keys(MOUNTS)) {
    if (NOT_BUSINESS.has(file)) continue;
    for (const { method, url, guarded } of routesOf(file)) {
      if (!guarded) continue;
      const r = await call(businessContext, { user: { id: 'user-owner' }, method, originalUrl: url });
      assert.equal(r.nextCalled, true, `${method} ${url}`);
    }
  }
});

test('requireOwner / requireEmployee', async () => {
  assert.equal((await call(requireOwner, { role: 'owner' })).nextCalled, true);
  assert.equal((await call(requireOwner, { role: 'employee' })).status, 403);
  assert.equal((await call(requireEmployee, { role: 'employee', employeeId: EMP })).nextCalled, true);
  assert.equal((await call(requireEmployee, { role: 'owner' })).status, 403);
  assert.equal((await call(requireEmployee, { role: 'employee' })).status, 403);
});
