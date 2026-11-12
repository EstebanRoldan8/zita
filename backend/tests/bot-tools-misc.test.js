// Tools del bot que no cubren los otros tests (caracterización antes del refactor a módulos por tool).
// Ejecutar: node --test tests/bot-tools-misc.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes, scriptedAnthropic, toolUse, text } = require('./helpers/fakeSupabase');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';
const BIZ = 'biz-1';
const PHONE = '573001112233';
const FUT = new Date(Date.now() + 3 * 86400000);
const FECHA = FUT.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
function seed() {
  return {
    businesses: [{ id: BIZ, name: 'Barbería Test', plan: 'pro', phone: '573000000000', whatsapp_phone_number_id: 'pnid-1', whatsapp_access_token: null }],
    business_hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ business_id: BIZ, day_of_week: d, open_time: '08:00:00', close_time: '20:00:00', is_open: true })),
    business_closed_days: [{ business_id: BIZ, date: FECHA, reason: 'Festivo' }],
    employees: [{ id: 'emp-1', business_id: BIZ, name: 'Carlos', is_active: true }, { id: 'emp-2', business_id: BIZ, name: 'Pedro', is_active: true }],
    services: [{ id: 'srv-1', business_id: BIZ, name: 'Corte', price: 25000, duration_minutes: 30, active: true }, { id: 'srv-1b', business_id: BIZ, name: 'Corte', price: 25000, duration_minutes: 30, active: true }],
    products: [{ id: 'p1', business_id: BIZ, name: 'Cera', price: 15000, stock: 3, is_active: true }, { id: 'p2', business_id: BIZ, name: 'Gel', price: 9000, stock: 0, is_active: true }],
    clients: [{ id: 'cli-1', business_id: BIZ, phone: PHONE, name: 'Juan Pérez' }],
    client_loyalty: [{ business_id: BIZ, client_id: 'cli-1', loyalty_visits: 7, total_visits: 9 }],
    loyalty_config: [{ business_id: BIZ, visits_for_reward: 10, reward_service_id: 'srv-1' }],
    appointments: [{ id: 'aaaaaaaa-0000-4000-8000-000000000009', business_id: BIZ, client_id: 'cli-1', employee_id: 'emp-1', service_id: 'srv-1', status: 'confirmed', scheduled_at: FUT.toISOString() }],
    waitlist: [], whatsapp_conversations: [{ id: 'c1', business_id: BIZ, client_phone: PHONE, messages: [], context: {} }], system_alerts: [], income: [],
  };
}
const fake = createFakeSupabase(seed());
const env = installFakes(fake);
const chatbot = require('../src/services/chatbot.service');
function reset() { const f = seed(); for (const k of Object.keys(fake.db)) delete fake.db[k]; Object.assign(fake.db, f); env.sent.length = 0; }
async function runTool(name, input) {
  const ai = scriptedAnthropic([toolUse(name, input), text('ok')]);
  chatbot.__setAnthropicClientForTests(ai);
  const out = await chatbot.processChatbotMessage(BIZ, PHONE, 'x', [], fake.db.businesses[0], { name: 'Juan Pérez' });
  const block = ai.requests[1]?.messages.at(-1).content.find((b) => b.type === 'tool_result');
  return { result: block ? JSON.parse(block.content) : null, out };
}

test('ver_servicios: sin duplicados por nombre', async () => {
  reset();
  const { result } = await runTool('ver_servicios', {});
  assert.deepEqual(result.servicios.map((s) => s.name), ['Corte']);
});

test('ver_mis_citas: solo las del cliente, con hora de Colombia', async () => {
  reset();
  const { result } = await runTool('ver_mis_citas', {});
  assert.equal(result.citas.length, 1);
  assert.equal(result.citas[0].id, 'aaaaaaaa-0000-4000-8000-000000000009');
});

test('ver_productos: solo con stock', async () => {
  reset();
  const { result } = await runTool('ver_productos', {});
  assert.deepEqual(result.productos.map((p) => p.name), ['Cera']);
});

test('ver_mi_fidelizacion: visitas y faltantes', async () => {
  reset();
  const { result } = await runTool('ver_mi_fidelizacion', {});
  assert.equal(result.visitas_acumuladas, 7);
  assert.equal(result.visitas_faltantes, 3);
});

test('ver_empleados y ver_horarios (con festivo próximo)', async () => {
  reset();
  const { result: e } = await runTool('ver_empleados', {});
  assert.equal(e.empleados.length, 2);
  const { result: h } = await runTool('ver_horarios', {});
  assert.equal(h.horarios.length, 7);
  assert.equal(h.dias_cerrados.length, 1);
});

test('lista_espera: queda registrada con el teléfono del que escribe', async () => {
  reset();
  const { result } = await runTool('lista_espera', { fecha: FECHA, hora: '10:00', servicio: 'Corte' });
  assert.equal(result.success, true);
  assert.equal(fake.db.waitlist[0].client_phone, PHONE);
});

test('escalar_a_humano: avisa al dueño (motivo recortado), pausa el bot y corta el loop', async () => {
  reset();
  const { out } = await runTool('escalar_a_humano', { motivo: 'x'.repeat(500) });
  assert.match(out.response, /le avisé al dueño/);
  assert.equal(env.sent[0].to, '573000000000');
  assert.ok(env.sent[0].text.length < 500);
  assert.ok(new Date(fake.db.whatsapp_conversations[0].bot_paused_until) > new Date());
});

test('gestionar_grupo: agregar dos personas y confirmar_todas agenda ambas con empleados distintos', async () => {
  reset();
  fake.db.business_closed_days = [];
  await runTool('gestionar_grupo', { accion: 'agregar_persona', persona: { nombre: 'Ana', servicio: 'Corte', fecha: FECHA, hora: '10:00' } });
  await runTool('gestionar_grupo', { accion: 'agregar_persona', persona: { nombre: 'Luis', servicio: 'Corte', fecha: FECHA, hora: '10:00' } });
  const { result } = await runTool('gestionar_grupo', { accion: 'confirmar_todas' });
  assert.equal(result.exitosas, 2, JSON.stringify(result));
  const nuevas = fake.db.appointments.filter((a) => a.notes);
  assert.notEqual(nuevas[0].employee_id, nuevas[1].employee_id);
});
