const { processMessage } = require('../src/services/assistant.service');

const BUSINESS_ID = 'd26bc18e-bbcf-4ca3-bba3-d66d1025132f';

const tests = [
  {
    name: 'Crear cita con cliente existente',
    message: 'Hazme una cita hoy a las 3pm para Carlos Ruiz con corte clásico',
    expect: ['cita', 'Carlos', 'PM']
  },
  {
    name: 'Crear cita cliente ocasional',
    message: 'Cita a las 4pm hoy corte niño para cliente ocasional',
    expect: ['cita', '4']
  },
  {
    name: 'Listar servicios',
    message: '¿Qué servicios tienen?',
    expect: ['corte', 'servicio']
  },
  {
    name: 'Ver citas de hoy',
    message: '¿Cuántas citas hay hoy?',
    expect: ['cita', 'hoy']
  },
  {
    name: 'Consultar métricas',
    message: '¿Cuánto hemos ganado esta semana?',
    expect: ['semana', '$']
  },
  {
    name: 'Crear cita mañana',
    message: 'Agenda un corte clásico mañana a las 10am',
    expect: ['cita', '10:00']
  },
  {
    name: 'Cliente con nombre parcial',
    message: 'Cita para Camilo a las 5pm con degradado',
    expect: ['Camilo', 'cita']
  },
  {
    name: 'Registrar venta producto',
    message: 'Registra la venta de 1 gel',
    expect: ['gel', 'venta']
  }
];

async function runTests() {
  console.log('=== TESTS DEL ASISTENTE ZITA ===\n');
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      console.log(`🧪 ${test.name}`);
      console.log(`   Mensaje: "${test.message}"`);

      const result = await processMessage(BUSINESS_ID, test.message, []);
      const response = result.response.toLowerCase();

      const allExpected = test.expect.every(word =>
        response.includes(word.toLowerCase())
      );

      if (allExpected) {
        console.log(`   ✅ PASÓ`);
        console.log(`   Respuesta: ${result.response.slice(0, 100)}...\n`);
        passed++;
      } else {
        console.log(`   ❌ FALLÓ`);
        console.log(`   Esperaba: ${test.expect.join(', ')}`);
        console.log(`   Respuesta: ${result.response.slice(0, 150)}...\n`);
        failed++;
      }
    } catch (error) {
      console.log(`   💥 ERROR: ${error.message}\n`);
      failed++;
    }
  }

  console.log(`\n=== RESULTADO: ${passed} pasaron, ${failed} fallaron ===`);
}

runTests();
