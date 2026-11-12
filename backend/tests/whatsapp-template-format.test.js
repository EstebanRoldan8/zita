// Formato de plantillas para la Cloud API de Meta (sin red).
// Ejecutar: node --test tests/whatsapp-template-format.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildComponents, templateParam } = require('../src/config/whatsapp');

test('parámetros: sin saltos de línea ni espacios múltiples, y nunca vacíos', () => {
  assert.equal(templateParam('Hola\nmundo   con\tespacios'), 'Hola mundo con espacios');
  assert.equal(templateParam(''), '-');
  assert.equal(templateParam(null), '-');
});

test('body + botones de respuesta rápida con payload', () => {
  const c = buildComponents({ body: ['Juan', 'Barbería'], buttons: ['CONFIRMAR_CITA', 'CANCELAR_CITA'] });
  assert.deepEqual(c[0], { type: 'body', parameters: [{ type: 'text', text: 'Juan' }, { type: 'text', text: 'Barbería' }] });
  assert.deepEqual(c[1], { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'CONFIRMAR_CITA' }] });
  assert.equal(c[2].index, '1');
});

test('plantilla sin parámetros: sin componentes', () => {
  assert.deepEqual(buildComponents({ body: [] }), []);
});
