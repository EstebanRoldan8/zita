// Tools del bot de WhatsApp ejecutadas de punta a punta con processChatbotMessage, Supabase en memoria y un
// Claude simulado que pide la tool. Verifica lo que la tool devuelve y lo que queda en la base.
// Ejecutar: node --test tests/bot-tools.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFakes, scriptedAnthropic, toolUse, text } = require('./helpers/fakeSupabase');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test';
const BIZ = 'biz-1';
const PHONE = '573001112233';
const OTHER_PHONE = '573009998877';
const FECHA = '2030-03-12'; // martes futuro

function seed() {
  return {
    businesses: [{ id: BIZ, name: 'Barbería Test', plan: 'pro', phone: '573000000000', whatsapp_phone_number_id: 'pnid-1', whatsapp_access_token: null }],
    business_hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ business_id: BIZ, day_of_week: d, open_time: '08:00:00', close_time: '20:00:00', is_open: true })),
    business_closed_days: [],
    employees: [{ id: 'emp-carlos', business_id: BIZ, name: 'Carlos', is_active: true }],
    services: [
      { id: 'srv-corte', business_id: BIZ, name: 'Corte', price: 25000, duration_minutes: 30, active: true },
      { id: 'srv-tinte', business_id: BIZ, name: 'Tinte', price: 45000, duration_minutes: 60, active: true },
    ],
    clients: [
      { id: 'cli-juan', business_id: BIZ, phone: PHONE, name: 'Juan Pérez' },
      { id: 'cli-ana', business_id: BIZ, phone: OTHER_PHONE, name: 'Ana Gómez' },
    ],
    appointments: [
      // Cita de OTRA clienta (Ana) con Carlos a las 10:30 hora Colombia
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', business_id: BIZ, client_id: 'cli-ana', employee_id: 'emp-carlos', service_id: 'srv-corte', status: 'confirmed', price: 25000, scheduled_at: '2030-03-12T15:30:00+00:00' },
      // Cita de Juan a las 15:00 hora Colombia
      { id: 'bbbbbbbb-0000-4000-8000-000000000002', business_id: BIZ, client_id: 'cli-juan', employee_id: 'emp-carlos', service_id: 'srv-corte', status: 'confirmed', price: 25000, scheduled_at: '2030-03-12T20:00:00+00:00' },
    ],
    income: [],
    whatsapp_conversations: [],
    system_alerts: [],
  };
}

const fake = createFakeSupabase(seed());
const env = installFakes(fake);
const chatbot = require('../src/services/chatbot.service');

function reset() {
  const fresh = seed();
  for (const k of Object.keys(fake.db)) delete fake.db[k];
  Object.assign(fake.db, fresh);
  env.sent.length = 0;
}

// Ejecuta una tool a través del loop real y devuelve el resultado que vio el modelo
async function runTool(name, input, { phone = PHONE } = {}) {
  const ai = scriptedAnthropic([toolUse(name, input), text('listo')]);
  chatbot.__setAnthropicClientForTests(ai);
  const business = fake.db.businesses[0];
  await chatbot.processChatbotMessage(BIZ, phone, 'mensaje', [], business, { name: 'Juan Pérez' });
  const last = ai.requests[1].messages.at(-1);
  const block = last.content.find((b) => b.type === 'tool_result');
  return { result: JSON.parse(block.content), ai };
}

test('agendar_cita: un Tinte (60 min) a las 10:00 choca con la cita de las 10:30 y no se crea', async () => {
  reset();
  const { result } = await runTool('agendar_cita', { service_name: 'Tinte', fecha: FECHA, hora: '10:00', client_name: 'Juan Pérez' });
  assert.equal(result.success, false);
  assert.equal(result.error, 'sin_disponibilidad');
  assert.ok(!result.slots_alternativos.includes('10:30'));
  assert.equal(fake.db.appointments.length, 2, 'no se insertó ninguna cita');
});

test('agendar_cita: un Corte (30 min) a las 10:00 sí cabe', async () => {
  reset();
  const { result } = await runTool('agendar_cita', { service_name: 'Corte', fecha: FECHA, hora: '10:00', client_name: 'Juan Pérez' });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(fake.db.appointments.length, 3);
});

test('verificar_disponibilidad con servicio: usa la duración del servicio', async () => {
  reset();
  const { result } = await runTool('verificar_disponibilidad', { fecha: FECHA, hora: '10:00', service_name: 'Tinte' });
  assert.equal(result.disponible, false);
  const { result: r2 } = await runTool('verificar_disponibilidad', { fecha: FECHA, hora: '10:00', service_name: 'Corte' });
  assert.equal(r2.disponible, true);
});

module.exports = { seed, fake, env, chatbot, reset, runTool, BIZ, PHONE, OTHER_PHONE, FECHA };
