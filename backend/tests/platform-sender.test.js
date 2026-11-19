// Número global de ZITA (opcional) para aviso_fin_prueba y pago_rechazado (de ZITA a sus clientes, no del negocio).
// Ejecutar: node --test tests/platform-sender.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes } = require('./helpers/fakeSupabase');

const BIZ = '11111111-1111-4111-8111-111111111111';
const OWNER_PHONE = '573004445566';
const fake = createFakeSupabase({});
const { sent, logs } = installFakes(fake);
const { checkTrialExpiringWarnings, notifyPaymentDeclined } = require('../src/services/notification.service');
const { platformSender } = require('../src/services/businessSender');

function seed() {
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  sent.length = 0; logs.length = 0;
  fake.db.businesses = [{
    id: BIZ, name: 'Barbería Test', phone: OWNER_PHONE, status: 'trial', trial_warning_sent_at: null,
    trial_ends_at: new Date(Date.now() + 3 * 86400000).toISOString(),
  }];
}
function setPlatform(pnid, token) {
  if (pnid === undefined) delete process.env.WA_PLATFORM_PHONE_NUMBER_ID; else process.env.WA_PLATFORM_PHONE_NUMBER_ID = pnid;
  if (token === undefined) delete process.env.WA_PLATFORM_ACCESS_TOKEN; else process.env.WA_PLATFORM_ACCESS_TOKEN = token;
}
const noToken = () => assert.equal(JSON.stringify(logs).includes('tok-plataforma'), false, 'el token no se loguea');

test('sin variables: comportamiento actual (credenciales por defecto, token y número null)', async () => {
  setPlatform(undefined, undefined);
  seed();
  await checkTrialExpiringWarnings();
  await notifyPaymentDeclined(fake.db.businesses[0], { amount: 5000000, decline_reason: 'Fondos insuficientes' });
  assert.equal(sent.length, 2);
  assert.ok(sent.every((s) => s.token === null && s.pnid === null));
});

test('con variables: aviso_fin_prueba y pago_rechazado salen del número de ZITA', async () => {
  setPlatform('pnid-plataforma', 'tok-plataforma');
  process.env.WA_TEMPLATES_ENABLED = 'true';
  process.env.WA_TPL_FIN_PRUEBA = 'aviso_fin_prueba_v2';
  process.env.WA_TPL_PAGO_RECHAZADO = 'pago_rechazado_v2';
  try {
    seed();
    await checkTrialExpiringWarnings();
    await notifyPaymentDeclined(fake.db.businesses[0], { amount: 5000000, decline_reason: 'Fondos insuficientes' });
    assert.deepEqual(sent.map((s) => [s.name, s.token, s.pnid, s.to]), [
      ['aviso_fin_prueba_v2', 'tok-plataforma', 'pnid-plataforma', OWNER_PHONE],
      ['pago_rechazado_v2', 'tok-plataforma', 'pnid-plataforma', OWNER_PHONE],
    ]);
    assert.ok(fake.db.businesses[0].trial_warning_sent_at, 'se marca el aviso como enviado');
    noToken();
  } finally {
    setPlatform(undefined, undefined);
    process.env.WA_TEMPLATES_ENABLED = 'false';
  }
});

test('solo una de las dos variables: no se mezclan credenciales; comportamiento actual + log claro', () => {
  setPlatform('pnid-plataforma', undefined);
  logs.length = 0;
  assert.deepEqual(platformSender(), { token: null, phoneNumberId: null });
  assert.ok(logs.some((l) => String(l[1]).includes('WA_PLATAFORMA_INCOMPLETA')));
  setPlatform(undefined, 'tok-plataforma');
  assert.deepEqual(platformSender(), { token: null, phoneNumberId: null });
  noToken();
  setPlatform(undefined, undefined);
});

test('espacios en blanco cuentan como no definidas', () => {
  setPlatform('  ', '  ');
  assert.deepEqual(platformSender(), { token: null, phoneNumberId: null });
  setPlatform(undefined, undefined);
});
