// Validación del género de producto. Ejecutar: node --test tests/gender.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGender, GENDERS } = require('../src/utils/gender');

test('acepta mujer, hombre y unisex (sin importar mayúsculas ni espacios)', () => {
  assert.deepEqual(GENDERS, ['mujer', 'hombre', 'unisex']);
  assert.deepEqual(parseGender('Hombre'), { value: 'hombre' });
  assert.deepEqual(parseGender('  UNISEX '), { value: 'unisex' });
  assert.deepEqual(parseGender('mujer'), { value: 'mujer' });
});
test('undefined = no se toca; null o vacío = mujer', () => {
  assert.deepEqual(parseGender(undefined), { skip: true });
  assert.deepEqual(parseGender(null), { value: 'mujer' });
  assert.deepEqual(parseGender(''), { value: 'mujer' });
});
test('rechaza valores inválidos o que no son texto', () => {
  for (const bad of ['niño', 'male', 5, {}, ['mujer'], true]) assert.ok(parseGender(bad).error, String(bad));
});
