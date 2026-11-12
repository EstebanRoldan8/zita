// Invitación de empleados por enlace. Ejecutar: node --test tests/employee-invites.test.js
process.env.FRONTEND_URL = 'https://panel.zita.test/';
process.env.ENCRYPT_SECRET = process.env.ENCRYPT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');
const { call } = require('./helpers/http');

// Cuenta las comparaciones en tiempo constante
let timingSafeCalls = 0;
const realTimingSafeEqual = crypto.timingSafeEqual;
crypto.timingSafeEqual = (a, b) => { timingSafeCalls++; return realTimingSafeEqual(a, b); };

const fake = createFakeSupabase({});
const { logs } = installFakes(fake);
const authUsers = [];
fake.auth = {
  admin: {
    async createUser({ email }) {
      await new Promise((r) => setImmediate(r)); // da pie a que otra petición se cruce
      if (authUsers.some((x) => x.email === email)) {
        return { data: { user: null }, error: { code: 'email_exists', status: 422, message: 'A user with this email address has already been registered' } };
      }
      const user = { id: crypto.randomUUID(), email };
      authUsers.push(user);
      return { data: { user }, error: null };
    },
    async deleteUser(id) {
      const i = authUsers.findIndex((x) => x.id === id);
      if (i >= 0) authUsers.splice(i, 1);
      return { data: {}, error: null };
    },
  },
};

const inv = require('../src/controllers/invitations.controller');
const employees = require('../src/controllers/employees.controller');
const invitationsRoutes = require('../src/routes/invitations.routes');
const { clientIp } = require('../src/middlewares/rateLimiter');

const BIZ = '11111111-1111-4111-8111-111111111111';
const BIZ2 = '22222222-2222-4222-8222-222222222222';
const EMP = '33333333-3333-4333-8333-333333333333';
const EMP_NOPHONE = '44444444-4444-4444-8444-444444444444';
const EMP_BIZ2 = '55555555-5555-4555-8555-555555555555';

function seed() {
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  authUsers.length = 0;
  logs.length = 0;
  Object.assign(fake.db, {
    businesses: [
      { id: BIZ, user_id: 'owner-1', name: 'Barbería Uno' },
      { id: BIZ2, user_id: 'owner-2', name: 'Barbería Dos' },
    ],
    employees: [
      { id: EMP, business_id: BIZ, name: 'Juan', phone: '300 123 4567', is_active: true, user_id: null, commission_percent: 10 },
      { id: EMP_NOPHONE, business_id: BIZ, name: 'Pedro', phone: null, is_active: true, user_id: null, commission_percent: 10 },
      { id: EMP_BIZ2, business_id: BIZ2, name: 'Luis', phone: null, is_active: true, user_id: null, commission_percent: 10 },
    ],
    employee_invites: [],
  });
}

const ownerReq = (over = {}) => ({ businessId: BIZ, role: 'owner', user: { id: 'owner-1' }, business: { id: BIZ, name: 'Barbería Uno' }, ...over });
const tokenOf = (link) => link.split('/invitacion/')[1];

async function invite(employeeId = EMP, over = {}) {
  const r = await call(inv.createInvite, ownerReq({ params: { id: employeeId }, ...over }));
  return { ...r, token: r.body?.data?.link ? tokenOf(r.body.data.link) : null };
}
const getInv = (token) => call(inv.getInvitation, { params: { token } });
const accept = (token, email = 'juan@correo.com', password = 'clave-segura-1') => call(inv.acceptInvitation, { params: { token }, body: { email, password } });

test('crear invitación: enlace, mensaje para WhatsApp y solo el hash guardado', async () => {
  seed();
  const r = await invite();
  assert.equal(r.status, 201);
  const { link, message, whatsapp_url: wa, expires_at: exp } = r.body.data;
  assert.match(link, /^https:\/\/panel\.zita\.test\/invitacion\/[A-Za-z0-9_-]{43}$/);
  assert.equal(message, `Hola Juan, te invito a tu panel de Barbería Uno en ZITA: ${link}`);
  assert.equal(wa, `https://wa.me/573001234567?text=${encodeURIComponent(message)}`);
  const days = (Date.parse(exp) - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days <= 7, '7 días de vigencia');
  const row = fake.db.employee_invites[0];
  assert.equal(row.token_hash, crypto.createHash('sha256').update(r.token).digest('hex'));
  assert.equal(JSON.stringify(fake.db).includes(r.token), false, 'el token en claro no se guarda');
  assert.equal(JSON.stringify(logs).includes(r.token), false, 'el token no se loguea');
  assert.equal(JSON.stringify(logs).includes(row.token_hash), false, 'el hash no se loguea');
});

test('sin teléfono: solo enlace (whatsapp_url null)', async () => {
  seed();
  const r = await invite(EMP_NOPHONE);
  assert.equal(r.status, 201);
  assert.equal(r.body.data.whatsapp_url, null);
});

test('no se puede invitar a un empleado de otro negocio, inactivo o que ya tiene acceso', async () => {
  seed();
  assert.equal((await invite(EMP_BIZ2)).status, 404);
  fake.db.employees[0].is_active = false;
  assert.equal((await invite(EMP)).status, 400);
  fake.db.employees[0].is_active = true;
  fake.db.employees[0].user_id = 'ya-tiene';
  assert.equal((await invite(EMP)).status, 409);
  assert.equal(fake.db.employee_invites.length, 0);
});

test('GET valida sin consumir: se puede abrir varias veces y luego aceptar', async () => {
  seed();
  const { token } = await invite();
  for (let i = 0; i < 3; i++) {
    const g = await getInv(token);
    assert.equal(g.status, 200);
    assert.deepEqual(g.body.data, { business_name: 'Barbería Uno', employee_name: 'Juan' });
  }
  assert.equal(fake.db.employee_invites[0].used_at ?? null, null);
  assert.equal((await accept(token)).status, 201);
});

test('aceptar: crea la cuenta, vincula al empleado y el enlace no sirve dos veces', async () => {
  seed();
  const { token } = await invite();
  const a = await accept(token, '  Juan@Correo.com ');
  assert.equal(a.status, 201);
  assert.equal(authUsers.length, 1);
  assert.equal(authUsers[0].email, 'juan@correo.com');
  assert.equal(fake.db.employees[0].user_id, authUsers[0].id);
  assert.ok(fake.db.employee_invites[0].used_at);
  const again = await accept(token, 'otro@correo.com');
  assert.equal(again.status, 400);
  assert.equal(again.body.code, 'INVITE_INVALID');
  assert.equal((await getInv(token)).status, 400);
  assert.equal(authUsers.length, 1);
  const allLogs = JSON.stringify(logs);
  assert.equal(allLogs.includes('juan@correo.com'), false, 'el correo no se loguea completo');
  assert.equal(allLogs.includes(token), false);
});

test('token inventado, mal formado, vencido o de otro negocio → mismo error genérico', async () => {
  seed();
  const { token } = await invite();
  const invented = crypto.randomBytes(32).toString('base64url');
  const r1 = await getInv(invented);
  const r2 = await getInv('abc');
  const r3 = await getInv(`${token}x`);
  for (const r of [r1, r2, r3]) {
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, r1.body);
  }
  // vencido
  fake.db.employee_invites[0].expires_at = new Date(Date.now() - 1000).toISOString();
  assert.deepEqual((await getInv(token)).body, r1.body);
  assert.equal((await accept(token)).status, 400);
  // invitación cuyo empleado fue movido a otro negocio: no vale
  seed();
  const t2 = (await invite()).token;
  fake.db.employee_invites[0].business_id = BIZ2;
  assert.deepEqual((await getInv(t2)).body, r1.body);
  assert.equal(authUsers.length, 0);
});

test('el hash se compara en tiempo constante', async () => {
  seed();
  const { token } = await invite();
  const before = timingSafeCalls;
  await getInv(token);
  assert.ok(timingSafeCalls > before);
});

test('generar un enlace nuevo invalida el anterior', async () => {
  seed();
  const first = (await invite()).token;
  const second = (await invite()).token;
  assert.notEqual(first, second);
  assert.equal((await getInv(first)).status, 400);
  assert.equal((await accept(first)).status, 400);
  assert.equal((await getInv(second)).status, 200);
  assert.equal(fake.db.employee_invites.filter((i) => !i.used_at && !i.revoked_at).length, 1);
});

test('dos aceptaciones simultáneas crean una sola cuenta', async () => {
  seed();
  const { token } = await invite();
  const results = await Promise.all([
    accept(token, 'uno@correo.com'), accept(token, 'dos@correo.com'), accept(token, 'tres@correo.com'),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 400, 400]);
  assert.equal(authUsers.length, 1);
  assert.equal(fake.db.employees[0].user_id, authUsers[0].id);
});

test('correo que ya existe en Auth: no se vincula y el enlace sigue sirviendo con otro correo', async () => {
  seed();
  authUsers.push({ id: 'existente', email: 'dueno@correo.com' });
  const { token } = await invite();
  const r = await accept(token, 'dueno@correo.com');
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'EMAIL_EXISTS');
  assert.equal(fake.db.employees[0].user_id, null);
  assert.equal(fake.db.employee_invites[0].used_at, null, 'se libera la reserva');
  assert.equal((await accept(token, 'juan@correo.com')).status, 201);
  assert.equal(fake.db.employees[0].user_id === 'existente', false);
});

test('validación del cuerpo: correo inválido y contraseña corta o enorme', async () => {
  seed();
  const { token } = await invite();
  assert.equal((await accept(token, 'no-es-correo')).status, 400);
  assert.equal((await accept(token, 'a@b.co', '1234567')).status, 400);
  assert.equal((await accept(token, 'a@b.co', 'x'.repeat(73))).status, 400);
  assert.equal((await call(inv.acceptInvitation, { params: { token }, body: { email: ['a@b.co'], password: { x: 1 } } })).status, 400);
  assert.equal(fake.db.employee_invites[0].used_at ?? null, null);
  assert.equal(authUsers.length, 0);
});

test('si el empleado se desactiva antes de aceptar, el enlace deja de servir', async () => {
  seed();
  const { token } = await invite();
  fake.db.employees[0].is_active = false;
  assert.equal((await accept(token)).status, 400);
  assert.equal(authUsers.length, 0);
});

test('revocar acceso: desvincula, borra la cuenta y anula invitaciones pendientes', async () => {
  seed();
  const { token } = await invite();
  await accept(token);
  const userId = fake.db.employees[0].user_id;
  const pending = (await invite(EMP_NOPHONE)).token;
  const r = await call(inv.revokeAccess, ownerReq({ params: { id: EMP } }));
  assert.equal(r.status, 200);
  assert.equal(fake.db.employees[0].user_id, null);
  assert.equal(authUsers.some((x) => x.id === userId), false, 'cuenta borrada: se puede re-invitar con el mismo correo');
  assert.equal((await getInv(pending)).status, 200, 'no toca invitaciones de otros empleados');
  // re-invitar con el mismo correo funciona
  const again = (await invite()).token;
  assert.equal((await accept(again)).status, 201);
  // revocar a un empleado de otro negocio → 404
  assert.equal((await call(inv.revokeAccess, ownerReq({ params: { id: EMP_BIZ2 } }))).status, 404);
});

test('revocar no borra la cuenta si ese usuario es dueño de un negocio', async () => {
  seed();
  authUsers.push({ id: 'owner-2', email: 'dos@correo.com' });
  fake.db.employees[0].user_id = 'owner-2';
  await call(inv.revokeAccess, ownerReq({ params: { id: EMP } }));
  assert.equal(fake.db.employees[0].user_id, null);
  assert.equal(authUsers.some((x) => x.id === 'owner-2'), true);
});

test('revocar invitación pendiente (sin cuenta) la anula', async () => {
  seed();
  const { token } = await invite();
  await call(inv.revokeAccess, ownerReq({ params: { id: EMP } }));
  assert.equal((await getInv(token)).status, 400);
});

test('GET /api/employees muestra estado de acceso sin exponer user_id', async () => {
  seed();
  await invite(EMP_NOPHONE);
  fake.db.employees[0].user_id = 'u-juan';
  const r = await call(employees.getAll, ownerReq({ query: {} }));
  assert.equal(r.status, 200);
  const byName = Object.fromEntries(r.body.data.map((e) => [e.name, e.access_status]));
  assert.deepEqual(byName, { Juan: 'active', Pedro: 'invited' });
  assert.equal(JSON.stringify(r.body).includes('user_id'), false);
});

test('sin la migración 066: el listado de empleados funciona (todos sin acceso) e invitar responde 503', async () => {
  seed();
  const realFrom = fake.from;
  fake.from = (t) => {
    const q = realFrom(t);
    if (t === 'employee_invites') {
      const fail = { data: null, error: { code: '42P01', message: 'relation does not exist' } };
      const chain = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res(fail) : () => chain) });
      return chain;
    }
    if (t !== 'employees') return q;
    const origSelect = q.select;
    q.select = (cols, o) => {
      if (String(cols).includes('user_id')) {
        const fail = { data: null, error: { code: '42703', message: 'column employees.user_id does not exist' } };
        const chain = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res(fail) : () => (k === 'maybeSingle' || k === 'single' ? Promise.resolve(fail) : chain)) });
        return chain;
      }
      return origSelect(cols, o);
    };
    return q;
  };
  try {
    const list = await call(employees.getAll, ownerReq({ query: {} }));
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data.map((e) => e.access_status), ['none', 'none']);
    assert.equal((await invite()).status, 503);
  } finally {
    fake.from = realFrom;
  }
});

test('rate limit: aceptar se corta a las 5 peticiones por IP; ver, a las 30', async () => {
  seed();
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/invitations', invitationsRoutes);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/invitations`;
  try {
    const fakeToken = crypto.randomBytes(32).toString('base64url');
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${base}/${fakeToken}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.co', password: '12345678' }) });
      statuses.push(r.status);
    }
    assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
    let last;
    for (let i = 0; i < 31; i++) last = (await fetch(`${base}/${fakeToken}`)).status;
    assert.equal(last, 429);
  } finally {
    server.close();
  }
});

test('IP del rate limit: req.ip por defecto; X-Real-IP solo si se configura', () => {
  const req = { ip: '10.0.0.1', headers: { 'x-real-ip': '200.1.1.1' } };
  delete process.env.RATE_LIMIT_IP_HEADER;
  assert.equal(clientIp(req), '10.0.0.1');
  process.env.RATE_LIMIT_IP_HEADER = 'X-Real-IP';
  assert.equal(clientIp(req), '200.1.1.1');
  assert.equal(clientIp({ ip: '10.0.0.1', headers: {} }), '10.0.0.1');
  delete process.env.RATE_LIMIT_IP_HEADER;
});
