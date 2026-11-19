// Guarda contra confirmaciones inventadas + citas activas en el contexto.
// Bug real: "prefiero que sea a las 5, me lo cambias?" → "Perfecto, cambio el degradado a las 5:00 p. m. ✅" sin llamar
// a actualizar_cita (la cita siguió a las 15:00). Ejecutar: node --test tests/bot-confirmaciones.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes, scriptedAnthropic, toolUse, text } = require('./helpers/fakeSupabase');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';
const BIZ = 'biz-1';
const PHONE = '573001112233';
const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const D = (n) => { const [y, m, d] = HOY.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const DEGRADADO = 'dddddddd-0000-4000-8000-000000000001';
const CLASICO = 'dddddddd-0000-4000-8000-000000000002';
const PASADA = 'dddddddd-0000-4000-8000-000000000003';

const fake = createFakeSupabase({});
const env = installFakes(fake);
const chatbot = require('../src/services/chatbot.service');
const { detectClaim, isBacked } = require('../src/services/chatbot/confirmationGuard');

const business = { id: BIZ, name: 'Barbería Test', plan: 'pro', phone: '573000000000' };
const clientInfo = { id: 'cli-1', name: 'Juan Pérez' };

function seed({ dosCitas = false } = {}) {
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  env.logs.length = 0;
  Object.assign(fake.db, {
    businesses: [{ id: BIZ, name: 'Barbería Test', plan: 'pro', phone: '573000000000' }],
    business_hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ business_id: BIZ, day_of_week: d, open_time: '08:00:00', close_time: '20:00:00', is_open: true })),
    business_closed_days: [],
    employees: [{ id: 'emp-1', business_id: BIZ, name: 'Carlos', is_active: true }],
    services: [
      { id: 'srv-deg', business_id: BIZ, name: 'Degradado', price: 30000, duration_minutes: 30, active: true },
      { id: 'srv-cla', business_id: BIZ, name: 'Corte clásico', price: 25000, duration_minutes: 30, active: true },
    ],
    clients: [{ id: 'cli-1', business_id: BIZ, phone: PHONE, name: 'Juan Pérez' }],
    appointments: [
      { id: DEGRADADO, business_id: BIZ, client_id: 'cli-1', employee_id: 'emp-1', service_id: 'srv-deg', status: 'confirmed', price: 30000, scheduled_at: `${D(2)}T15:00:00-05:00` },
      ...(dosCitas ? [{ id: CLASICO, business_id: BIZ, client_id: 'cli-1', employee_id: 'emp-1', service_id: 'srv-cla', status: 'confirmed', price: 25000, scheduled_at: `${D(3)}T11:00:00-05:00` }] : []),
      // Pasada pero sin cerrar (pending): no debe ir al contexto
      { id: PASADA, business_id: BIZ, client_id: 'cli-1', employee_id: 'emp-1', service_id: 'srv-cla', status: 'pending', price: 25000, scheduled_at: `${D(-3)}T10:00:00-05:00` },
    ],
    whatsapp_conversations: [{ id: 'conv-1', business_id: BIZ, client_phone: PHONE, messages: [] }], system_alerts: [], income: [], ai_usage: [],
  });
}
const run = (msg, ai) => { chatbot.__setAnthropicClientForTests(ai); return chatbot.processChatbotMessage(BIZ, PHONE, msg, [], business, clientInfo); };
const cita = (id) => fake.db.appointments.find((a) => a.id === id);
const hasLog = (tag) => env.logs.find((l) => String(l[1]).includes(tag));
const noPii = () => assert.equal(JSON.stringify(env.logs).includes(PHONE), false, 'sin teléfono en logs');

// ── Detección (unidad) ───────────────────────────────────────────────────────────
test('detección: afirmaciones sí; preguntas, informativos, saludos y escalamiento no', () => {
  assert.equal(detectClaim('Perfecto, cambio el degradado a las 5:00 p. m. ✅'), 'cambiar');
  assert.equal(detectClaim('Listo ✅ Corte agendado'), 'agendar');
  assert.equal(detectClaim('Tu cita quedó cancelada.'), 'cancelar');
  assert.equal(detectClaim('Listo ✅ quedó el lunes a las 5 pm'), 'generica');
  for (const t of [
    '¿Quieres que te la cambie a las 5?', '✅ Tu cita es el martes a las 3:00 p. m.',
    'Sí ✅ tenemos disponibilidad a las 5:00 p. m. ¿Te la agendo?', 'Claro, el degradado cuesta 30.000 ✅',
    'Listo, le avisé al dueño. Te contactarán pronto 😊', '¡Hola Juan! 👋 ¿En qué te ayudo hoy?',
    'Tienes 2 citas agendadas: degradado el martes y corte clásico el jueves. ¿Cuál quieres cambiar?',
  ]) assert.equal(detectClaim(t), null, t);
  assert.equal(isBacked('cambiar', [{ name: 'actualizar_cita', success: true }]), true);
  assert.equal(isBacked('cambiar', [{ name: 'agendar_cita', success: true }]), false, 'otro tipo no respalda');
  assert.equal(isBacked('cambiar', [{ name: 'actualizar_cita', success: false }]), false);
});

// ── El bug real ──────────────────────────────────────────────────────────────────
test('confirma sin herramienta y el reintento insiste → texto seguro, cita intacta y log sin PII', async () => {
  seed();
  const ai = scriptedAnthropic([
    text('Perfecto, cambio el degradado a las 5:00 p. m. ✅'),
    text('Listo, cambiado a las 5:00 p. m. ✅'),
  ]);
  const r = await run('prefiero que sea a las 5, me lo cambias?', ai);
  assert.equal(r.response, 'Déjame confirmarlo, ¿me repites qué cita quieres cambiar y a qué hora?');
  assert.equal(ai.requests.length, 2, 'un solo reintento');
  assert.match(JSON.stringify(ai.requests[1].messages.at(-1)), /nota_del_sistema/);
  assert.equal(new Date(cita(DEGRADADO).scheduled_at).getTime(), new Date(`${D(2)}T15:00:00-05:00`).getTime(), 'sigue a las 15:00');
  const line = hasLog('BOT_CONFIRMACION_SIN_HERRAMIENTA');
  assert.deepEqual(line[2], { businessId: BIZ, tipo: 'cambiar', herramientaFallida: false });
  noPii();
});

test('confirma sin herramienta y en el reintento SÍ ejecuta actualizar_cita → cita movida y texto del modelo', async () => {
  seed();
  const ai = scriptedAnthropic([
    text('Perfecto, cambio el degradado a las 5:00 p. m. ✅'),
    toolUse('actualizar_cita', { appointment_id: DEGRADADO, nueva_hora: '17:00' }),
    text('Listo ✅ tu degradado quedó a las 5:00 p. m.'),
  ]);
  const r = await run('prefiero que sea a las 5, me lo cambias?', ai);
  assert.equal(r.response, 'Listo ✅ tu degradado quedó a las 5:00 p. m.');
  assert.equal(new Date(cita(DEGRADADO).scheduled_at).getTime(), new Date(`${D(2)}T17:00:00-05:00`).getTime());
  assert.ok(hasLog('BOT_CONFIRMACION_CORREGIDA'));
});

// ── Flujo feliz: sin llamadas extra ──────────────────────────────────────────────
test('herramienta con éxito → igual que hoy: mismo texto y exactamente 2 llamadas (sin reintento)', async () => {
  seed();
  const ai = scriptedAnthropic([
    toolUse('actualizar_cita', { appointment_id: DEGRADADO, nueva_hora: '17:00' }),
    text('Listo, cambié tu degradado a las 5:00 p. m. ✅'),
  ]);
  const r = await run('cámbiame el degradado a las 5', ai);
  assert.equal(r.response, 'Listo, cambié tu degradado a las 5:00 p. m. ✅');
  assert.equal(ai.requests.length, 2);
  assert.equal(hasLog('BOT_CONFIRMACION'), undefined);
});

test('pregunta informativa con ✅: 1 sola llamada, sin bloqueo', async () => {
  seed();
  const ai = scriptedAnthropic([text('✅ Tu cita de Degradado es pasado mañana a las 3:00 p. m. con Carlos.')]);
  const r = await run('a qué hora es mi cita?', ai);
  assert.match(r.response, /Tu cita de Degradado/);
  assert.equal(ai.requests.length, 1);
});

test('saludo por Claude y escalamiento: no cambian (1 llamada, respuesta de siempre)', async () => {
  seed();
  let ai = scriptedAnthropic([text('¡Hola Juan! 👋 ¿En qué te ayudo hoy?')]);
  assert.equal((await run('hola, una pregunta', ai)).response, '¡Hola Juan! 👋 ¿En qué te ayudo hoy?');
  assert.equal(ai.requests.length, 1);
  ai = scriptedAnthropic([toolUse('escalar_a_humano', { motivo: 'quiere hablar con el dueño' })]);
  const r = await run('quiero hablar con el dueño', ai);
  assert.equal(r.response, 'Listo, le avisé al dueño. Te contactarán pronto 😊');
  assert.equal(ai.requests.length, 1);
});

// ── La herramienta falló: no puede afirmar éxito ─────────────────────────────────
test('herramienta con error y el modelo igual afirma → reintento; si insiste, texto seguro con herramientaFallida', async () => {
  seed();
  const ai = scriptedAnthropic([
    toolUse('actualizar_cita', { appointment_id: DEGRADADO, nueva_hora: '23:30' }), // fuera de horario → success:false
    (p) => {
      const r = JSON.parse(p.messages.at(-1).content[0].content);
      assert.notEqual(r.success, true);
      return text('Listo, cambié tu degradado a las 11:30 p. m. ✅');
    },
    (p) => { assert.match(JSON.stringify(p.messages.at(-1)), /devolvió un error/); return text('Perfecto, cambiado ✅'); },
  ]);
  const r = await run('pásamelo a las 11:30 de la noche', ai);
  assert.equal(r.response, 'Déjame confirmarlo, ¿me repites qué cita quieres cambiar y a qué hora?');
  assert.equal(hasLog('BOT_CONFIRMACION_SIN_HERRAMIENTA')[2].herramientaFallida, true);
  assert.equal(new Date(cita(DEGRADADO).scheduled_at).getTime(), new Date(`${D(2)}T15:00:00-05:00`).getTime());
});

test('herramienta con error y el reintento dice que no se pudo → se envía ese texto', async () => {
  seed();
  const ai = scriptedAnthropic([
    toolUse('actualizar_cita', { appointment_id: DEGRADADO, nueva_hora: '23:30' }),
    text('Listo, cambié tu degradado ✅'),
    text('Uy, no se pudo: a esa hora ya estamos cerrados. ¿Te sirve a las 7:00 p. m.?'),
  ]);
  const r = await run('pásamelo a las 11:30 de la noche', ai);
  assert.match(r.response, /no se pudo/);
});

// ── Varias citas: "el corte" es ambiguo ──────────────────────────────────────────
test('con dos citas el contexto trae ambas con su ID y la pista de preguntar; una pregunta no se bloquea', async () => {
  seed({ dosCitas: true });
  const ai = scriptedAnthropic([text('Tienes dos: Degradado pasado mañana a las 3:00 p. m. y Corte clásico a las 11:00 a. m. ¿Cuál quieres cambiar?')]);
  const r = await run('cámbiame el corte a las 5', ai);
  const ctx = ai.requests[0].messages.at(-1).content[1].text;
  assert.ok(ctx.includes(DEGRADADO) && ctx.includes(CLASICO));
  assert.match(ctx, /Tiene varias: si no dice cuál/);
  assert.match(r.response, /¿Cuál quieres cambiar\?/);
  assert.equal(ai.requests.length, 1);
  assert.match(ai.requests[0].system[0].text, /"el corte" teniendo Degradado y Corte clásico/);
});
