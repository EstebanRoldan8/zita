// Flow Archive: hombre y mujer intercalados, determinista. Ejecutar desde frontend/:  npm run test:archive
import test from 'node:test';
import assert from 'node:assert/strict';
import { interleaveByGender, productsInArchive, filterProducts } from '../src/store/lib/collections.js';

const P = (id, gender, category = 'Flow Archive') => ({ id: `${gender[0]}${id}`, name: `Prenda ${id}`, category, gender });
const catalog = [P(1, 'hombre'), P(2, 'hombre'), P(3, 'hombre'), P(4, 'mujer'), P(5, 'mujer'), P(6, 'unisex'), P(7, 'mujer', 'Tops')];

test('intercala hombre/mujer y lo que sobra va al final (después unisex)', () => {
  assert.deepEqual(interleaveByGender(catalog.slice(0, 6)).map((p) => p.id), ['h1', 'm4', 'h2', 'm5', 'h3', 'u6']);
});

test('más mujeres que hombres: sobran mujeres al final', () => {
  const list = [P(1, 'mujer'), P(2, 'mujer'), P(3, 'mujer'), P(4, 'hombre')];
  assert.deepEqual(interleaveByGender(list).map((p) => p.id), ['h4', 'm1', 'm2', 'm3']);
});

test('determinista: misma entrada, misma salida (sin azar)', () => {
  assert.deepEqual(interleaveByGender(catalog), interleaveByGender(catalog));
});

test('carrusel de portada y página de Archive (orden por defecto) usan el mismo orden', () => {
  const home = productsInArchive(catalog).map((p) => p.id);
  assert.deepEqual(home, ['h1', 'm4', 'h2', 'm5', 'h3', 'u6']);
  assert.deepEqual(filterProducts(catalog, { category: 'Flow Archive', sort: 'nuevo' }).map((p) => p.id), home);
});

test('si la persona elige otro orden (precio) se respeta ese orden', () => {
  const list = filterProducts(catalog.map((p, i) => ({ ...p, price: 100 - i })), { category: 'Flow Archive', sort: 'precio-asc' });
  assert.equal(list.length, 6);
  assert.ok(list.every((p, i) => i === 0 || p.price >= list[i - 1].price));
});

test('otras categorías no cambian de orden', () => {
  const tops = [P(1, 'mujer', 'Tops'), P(2, 'hombre', 'Tops'), P(3, 'hombre', 'Tops')];
  assert.deepEqual(filterProducts(tops, { category: 'Tops', sort: 'nuevo' }).map((p) => p.id), ['m1', 'h2', 'h3']);
});
