// Bolitas de color: nombre exacto, luego el color base con el que empieza el nombre, y si no, gris.
// Ejecutar desde frontend/:  npm run test:colors
import test from 'node:test';
import assert from 'node:assert/strict';
import { colorHex, colorsIn } from '../src/store/lib/collections.js';
import { colorMap } from '../src/store/content/flowContent.js';

test('búsqueda exacta sin tildes ni mayúsculas', () => {
  assert.equal(colorHex('NEGRO'), colorMap.negro);
  assert.equal(colorHex('  Lavánda '), colorMap.lavanda);
  assert.equal(colorHex('Vino Tinto'), colorMap['vino tinto']);
  assert.equal(colorHex('negro viejo'), colorMap['negro viejo'], 'un nombre compuesto propio del mapa gana');
});

test('nombres compuestos usan exactamente el hex de su color base', () => {
  for (const n of ['Negro active', 'Negro estampado', 'negro FLORES', 'Négro Active']) assert.equal(colorHex(n), colorMap.negro, n);
  assert.equal(colorHex('Blanco hueso'), colorMap.blanco);
  assert.equal(colorHex('Beige arena'), colorMap.beige);
  assert.equal(colorHex('Gris jaspe'), colorMap.gris);
  assert.equal(colorHex('Lavanda estampado'), colorMap.lavanda);
});

test('varias palabras: primero el nombre completo más largo, luego el base', () => {
  assert.equal(colorHex('Verde oliva'), colorMap['verde oliva']);
  assert.equal(colorHex('Verde oliva claro'), colorMap['verde oliva']);
  assert.equal(colorHex('Verde menta'), colorMap.verde);
  assert.equal(colorHex('Azul claro active'), colorMap['azul claro']);
  assert.equal(colorHex('Azul petróleo'), colorMap.azul);
  assert.equal(colorHex('Vino tinto active'), colorMap['vino tinto']);
});

test('solo palabras completas al inicio; si nada coincide, null (gris neutro)', () => {
  assert.equal(colorHex('Negrita'), null);
  assert.equal(colorHex('Estampado negro'), null);
  assert.equal(colorHex('Turquesa'), null);
  assert.equal(colorHex(''), null);
  assert.equal(colorHex(null), null);
});

test('filtro por color: cada nombre conserva su etiqueta completa y su hex', () => {
  const list = colorsIn([{ colors: [{ name: 'Negro' }, { name: 'Negro active' }, { name: 'Turquesa' }] }]);
  assert.deepEqual(list.map((c) => [c.name, c.hex]), [['Negro', colorMap.negro], ['Negro active', colorMap.negro], ['Turquesa', null]]);
});
