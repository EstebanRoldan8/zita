// Estructura de caché de prompts del bot: qué va cacheado, qué no, y que el turno siguiente reutilice el prefijo.
// Ejecutar: node --test tests/bot-cache.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes, scriptedAnthropic, toolUse, text } = require('./helpers/fakeSupabase');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';
const BIZ = 'biz-1';
const PNID = 'pnid-1';
const PHONE = '573001112233';
const fake = createFakeSupabase({
  businesses: [{ id: BIZ, name: 'Barbería Test', plan: 'pro', status: 'active', whatsapp_phone_number_id: PNID, whatsapp_access_token: null, plan_expires_at: new Date(Date.now() + 9e8).toISOString() }],
  business_hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ business_id: BIZ, day_of_week: d, open_time: '08:00:00', close_time: '20:00:00', is_open: true })),
  business_closed_days: [], employees: [{ id: 'e1', business_id: BIZ, name: 'Carlos', is_active: true }],
  services: [{ id: 's1', business_id: BIZ, name: 'Corte', price: 25000, duration_minutes: 30, active: true }],
  clients: [], appointments: [], whatsapp_conversations: [], bot_daily_message_counts: [], system_alerts: [], ai_usage: [], wa_processed_messages: [],
});
const env = installFakes(fake);
const chatbot = require('../src/services/chatbot.service');
const { buildBotRequest, STATIC_PROMPT, BOT_TOOLS } = require('../src/services/chatbot/prompt');

const countMarks = (req) => JSON.stringify(req).split('"cache_control"').length - 1;

test('prefijo compartido: tools y prompt estático idénticos para negocios distintos', () => {
  const a = buildBotRequest({ business: { name: 'A' }, businessHours: [], services: [{ name: 'X', price: 1, duration_minutes: 30 }], citasActivas: [] });
  const b = buildBotRequest({ business: { name: 'B' }, businessHours: [], services: [], citasActivas: [] });
  assert.equal(a.system[0].text, b.system[0].text);
  assert.deepEqual(a.tools, b.tools);
  assert.notEqual(a.system[1].text, b.system[1].text);
  assert.ok(a.system[0].cache_control && a.system[1].cache_control);
});

test('lo volátil (hora actual, cliente, citas) no va en el system', () => {
  const r = buildBotRequest({ business: { name: 'A' }, clientInfo: { name: 'Juan' }, businessHours: [], services: [], citasActivas: [] });
  const system = r.system.map((s) => s.text).join('\n');
  assert.doesNotMatch(system, /hora actual en Colombia: \d/i);
  assert.doesNotMatch(system, /Juan/);
  assert.match(r.volatileText, /hora actual en Colombia: \d{2}:\d{2}/);
  assert.doesNotMatch(STATIC_PROMPT, /4 julio|2026/, 'sin fechas fijas en el prompt');
});

test('turno con tool: ≤ 4 breakpoints, volátil al final del mensaje del cliente y breakpoint en el último tool_result', async () => {
  const ai = scriptedAnthropic([toolUse('verificar_disponibilidad', { fecha: '2030-03-12', service_name: 'Corte' }), text('Tengo estas horas…')]);
  chatbot.__setAnthropicClientForTests(ai);
  await chatbot.processWhatsAppMessage({ from: PHONE, phoneNumberId: PNID, messageText: 'quiero un corte el martes', messageId: 'w1' });
  const [r0, r1] = ai.requests;
  for (const r of [r0, r1]) assert.ok(countMarks(r) <= 4, `breakpoints: ${countMarks(r)}`);
  const user = r0.messages.at(-1);
  assert.ok(user.content[0].cache_control, 'breakpoint en el texto del cliente');
  assert.match(user.content[1].text, /<contexto>/);
  assert.ok(!user.content[1].cache_control, 'el volátil no lleva breakpoint propio');
  const lastBlock = r1.messages.at(-1).content.at(-1);
  assert.equal(lastBlock.type, 'tool_result');
  assert.ok(lastBlock.cache_control);
  assert.deepEqual(r0.tools, BOT_TOOLS);
});

test('el siguiente turno manda el mensaje anterior del cliente con los mismos bytes (lectura de caché)', async () => {
  const ai = scriptedAnthropic([text('¿Para qué día?'), text('Perfecto')]);
  chatbot.__setAnthropicClientForTests(ai);
  await chatbot.processWhatsAppMessage({ from: '573009990000', phoneNumberId: PNID, messageText: 'quiero un corte', messageId: 'w2' });
  await chatbot.processWhatsAppMessage({ from: '573009990000', phoneNumberId: PNID, messageText: 'mañana', messageId: 'w3' });
  const turno1Texto = ai.requests[0].messages.at(-1).content[0].text;
  const turno2Historial = ai.requests[1].messages[0].content[0].text;
  assert.equal(turno2Historial, turno1Texto);
  assert.equal(ai.requests[1].messages[1].content, '¿Para qué día?');
});

test('cliente nuevo: el contexto le pide al modelo el nombre antes de agendar', () => {
  const r = buildBotRequest({ business: { name: 'A' }, clientInfo: { name: 'Cliente WhatsApp' }, businessHours: [], services: [], citasActivas: [] });
  assert.match(r.volatileText, /NUEVO/);
});

test('cada llamada a Claude queda en ai_usage con su iteración y sin el teléfono', async () => {
  await new Promise((r) => setImmediate(r));
  const rows = fake.db.ai_usage.filter((r) => r.flow === 'whatsapp_bot');
  assert.ok(rows.length >= 4);
  assert.ok(rows.some((r) => r.iteration === 1));
  assert.ok(rows.every((r) => !JSON.stringify(r).includes(PHONE)));
});
