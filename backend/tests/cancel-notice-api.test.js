// Aviso de cancelación contra la API de WhatsApp mockeada a nivel HTTP (axios): la petición va a
// /{phone_number_id del negocio}/messages con el token del negocio, y el token no aparece en los logs.
// Ejecutar: node --test tests/cancel-notice-api.test.js
process.env.ENCRYPT_SECRET = process.env.ENCRYPT_SECRET || 'test-secret';
process.env.WHATSAPP_ACCESS_TOKEN = 'token-global-de-zita';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'pnid-global';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createFakeSupabase } = require('./helpers/fakeSupabase');

// axios falso: guarda cada POST a Meta
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

const BIZ = '11111111-1111-4111-8111-111111111111';
const APPT = '55555555-5555-4555-8555-555555555555';
const { encrypt } = require('../src/utils/encrypt');
const fake = createFakeSupabase({
  businesses: [{ id: BIZ, country: 'colombia', whatsapp_phone_number_id: 'pnid-negocio', whatsapp_access_token: encrypt('token-del-negocio') }],
  clients: [{ id: 'c1', business_id: BIZ, phone: '573001112233' }],
  services: [{ id: 's1', business_id: BIZ, name: 'Corte' }],
  appointments: [{ id: APPT, business_id: BIZ, client_id: 'c1', service_id: 's1', source: 'whatsapp', scheduled_at: '2030-11-12T15:00:00-05:00' }],
});
stub('config/supabase', { supabaseAdmin: fake, createUserClient: () => fake });

const { notifyClientOfCancellation } = require('../src/services/cancellationNotice');

test('POST a Meta con el número y el token del negocio (no los globales)', async () => {
  const r = await notifyClientOfCancellation({ businessId: BIZ, appointmentId: APPT });
  assert.deepEqual(r, { sent: true });
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/pnid-negocio\/messages$/);
  assert.equal(posts[0].auth, 'Bearer token-del-negocio');
  assert.equal(posts[0].body.to, '573001112233');
  assert.equal(posts[0].body.type, 'text');
  const all = JSON.stringify(logs);
  assert.equal(all.includes('token-del-negocio'), false);
  assert.equal(all.includes('573001112233'), false);
});

test('sin número configurado: no se envía nada (regla S3, ya no hay respaldo al número global)', async () => {
  posts.length = 0;
  fake.db.businesses[0].whatsapp_phone_number_id = null;
  await notifyClientOfCancellation({ businessId: BIZ, appointmentId: APPT });
  assert.equal(posts.length, 0);
  assert.equal(JSON.stringify(logs).includes('token-global-de-zita'), false);
});
