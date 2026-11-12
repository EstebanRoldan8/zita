// Recorrido simulado de punta a punta por el webhook (POST de Meta → bot → base → respuesta por WhatsApp).
// Claude está simulado: se fija qué tool pide y se verifica lo que hace el código con eso.
// Ejecutar: node --test tests/bot-recorrido.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes, scriptedAnthropic, toolUse, text } = require('./helpers/fakeSupabase');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';
const BIZ = 'biz-1';
const PNID = 'pnid-1';
const NUEVO = '573005551111';
const JUAN = '573001112233';
const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const D = (n) => { const [y, m, d] = HOY.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const CITA_JUAN = 'abababab-0000-4000-8000-000000000001';

const fake = createFakeSupabase({
  businesses: [{ id: BIZ, name: 'Barbería Recorrido', plan: 'pro', status: 'active', phone: '573000000000', whatsapp_phone_number_id: PNID, whatsapp_access_token: null, plan_expires_at: new Date(Date.now() + 9e8).toISOString() }],
  business_hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ business_id: BIZ, day_of_week: d, open_time: '08:00:00', close_time: '20:00:00', is_open: true })),
  business_closed_days: [],
  employees: [{ id: 'emp-1', business_id: BIZ, name: 'Carlos', is_active: true }],
  services: [{ id: 'srv-1', business_id: BIZ, name: 'Corte', price: 25000, duration_minutes: 30, active: true }],
  clients: [{ id: 'cli-juan', business_id: BIZ, phone: JUAN, name: 'Juan Pérez' }],
  appointments: [{ id: CITA_JUAN, business_id: BIZ, client_id: 'cli-juan', employee_id: 'emp-1', service_id: 'srv-1', status: 'confirmed', price: 25000, scheduled_at: `${D(3)}T10:00:00-05:00` }],
  whatsapp_conversations: [], bot_daily_message_counts: [], system_alerts: [], income: [], ai_usage: [], wa_processed_messages: [],
}, { unique: { wa_processed_messages: [['message_id']] } });
const env = installFakes(fake);
const chatbot = require('../src/services/chatbot.service');
const { handleWebhook } = require('../src/controllers/webhook.controller');

let seq = 0;
const idle = () => new Promise((r) => setTimeout(r, 80));
const res = () => { const r = { code: null }; r.sendStatus = (c) => { r.code = c; return r; }; r.status = r.sendStatus; r.json = () => r; return r; };
async function llega(from, texto, id = `wamid.rec.${++seq}`) {
  const r = res();
  await handleWebhook({ body: { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: PNID }, messages: [{ id, from, type: 'text', timestamp: String(Math.floor(Date.now() / 1000)), text: { body: texto } }] } }] }] } }, r);
  await idle();
  assert.equal(r.code, 200);
  return id;
}
const ultimo = (to) => env.sent.filter((s) => s.to === to).at(-1)?.text;

test('1. cliente NUEVO agenda: sin nombre no se crea; con nombre sí y queda guardado', async () => {
  const ai = scriptedAnthropic([
    // El modelo intenta agendar sin nombre: el servidor lo frena
    toolUse('agendar_cita', { service_name: 'Corte', fecha: D(2), hora: '15:00' }),
    (p) => { const r = JSON.parse(p.messages.at(-1).content[0].content); assert.equal(r.error, 'falta_nombre_cliente'); return text('¿A qué nombre te agendo? 😊'); },
    toolUse('agendar_cita', { service_name: 'Corte', fecha: D(2), hora: '15:00', client_name: 'maría lópez' }),
    text('Listo ✅ Corte agendado'),
  ]);
  chatbot.__setAnthropicClientForTests(ai);
  await llega(NUEVO, 'quiero un corte pasado mañana a las 3pm');
  // El contexto le avisó al modelo que el cliente es nuevo
  assert.match(ai.requests[0].messages.at(-1).content[1].text, /NUEVO/);
  assert.equal(ultimo(NUEVO), '¿A qué nombre te agendo? 😊');
  assert.equal(fake.db.appointments.length, 1, 'sin nombre no se agendó');
  await llega(NUEVO, 'María López');
  const cita = fake.db.appointments.at(-1);
  assert.equal(fake.db.appointments.length, 2);
  assert.equal(fake.db.clients.find((c) => c.id === cita.client_id).name, 'María López');
  assert.equal(new Date(cita.scheduled_at).getTime(), new Date(`${D(2)}T15:00:00-05:00`).getTime());
});

test('2. cliente EXISTENTE agenda: usa su nombre registrado, sin pedirlo', async () => {
  const ai = scriptedAnthropic([toolUse('agendar_cita', { service_name: 'Corte', fecha: D(4), hora: '11:00' }), text('Listo ✅')]);
  chatbot.__setAnthropicClientForTests(ai);
  await llega(JUAN, 'corte el ' + D(4) + ' a las 11');
  assert.match(ai.requests[0].messages.at(-1).content[1].text, /Cliente: Juan Pérez/);
  const r = JSON.parse(ai.requests[1].messages.at(-1).content[0].content);
  assert.equal(r.success, true, JSON.stringify(r));
});

test('3. cancelar: solo con un ID de sus citas del contexto', async () => {
  const nueva = fake.db.appointments.find((a) => a.client_id === 'cli-juan' && a.id !== CITA_JUAN);
  const ai = scriptedAnthropic([toolUse('cancelar_cita', { appointment_id: nueva.id }), text('Listo, cancelada')]);
  chatbot.__setAnthropicClientForTests(ai);
  await llega(JUAN, 'cancela la del ' + D(4));
  assert.ok(ai.requests[0].messages.at(-1).content[1].text.includes(nueva.id), 'el ID estaba en el contexto');
  assert.equal(nueva.status, 'cancelled');
});

test('4. reagendar solo la fecha: conserva las 10:00 a. m. hora Colombia', async () => {
  const ai = scriptedAnthropic([toolUse('actualizar_cita', { appointment_id: CITA_JUAN, nueva_fecha: D(5) }), text('Listo, movida')]);
  chatbot.__setAnthropicClientForTests(ai);
  await llega(JUAN, 'pásame la cita al ' + D(5));
  const c = fake.db.appointments.find((a) => a.id === CITA_JUAN);
  assert.equal(new Date(c.scheduled_at).getTime(), new Date(`${D(5)}T10:00:00-05:00`).getTime());
});

test('5. "no" a una pregunta cualquiera: va a Claude y no cancela nada', async () => {
  const ai = scriptedAnthropic([text('¿Te ayudo con algo más?'), text('Dale, ¿para qué día?')]);
  chatbot.__setAnthropicClientForTests(ai);
  await llega(JUAN, '¿tienen cera?');
  await llega(JUAN, 'no');
  assert.equal(ai.requests.length, 2);
  assert.equal(fake.db.appointments.find((a) => a.id === CITA_JUAN).status, 'confirmed');
});

test('6. mensaje duplicado de Meta: se procesa una vez', async () => {
  const ai = scriptedAnthropic([text('respuesta 1'), text('respuesta 2')]);
  chatbot.__setAnthropicClientForTests(ai);
  const antes = env.sent.length;
  const id = await llega(JUAN, 'hola de nuevo, ¿qué horarios tienen?');
  await llega(JUAN, 'hola de nuevo, ¿qué horarios tienen?', id);
  assert.equal(ai.requests.length, 1);
  assert.equal(env.sent.length - antes, 1);
});

test('7. plan Pro con más de 40 mensajes hoy: sigue respondiendo', async () => {
  fake.db.bot_daily_message_counts.push({ business_id: BIZ, client_phone: '573000000999', date: HOY, message_count: 60 });
  const ai = scriptedAnthropic([text('¡Claro!')]);
  chatbot.__setAnthropicClientForTests(ai);
  await llega(JUAN, 'una pregunta más');
  assert.equal(ultimo(JUAN), '¡Claro!');
});

test('el uso de IA del recorrido quedó registrado por llamada y sin teléfonos', async () => {
  await idle();
  const rows = fake.db.ai_usage;
  assert.ok(rows.length >= 10);
  assert.ok(rows.every((r) => r.flow === 'whatsapp_bot' && !JSON.stringify(r).includes(JUAN) && !JSON.stringify(r).includes(NUEVO)));
});
