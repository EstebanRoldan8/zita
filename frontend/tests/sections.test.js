// Secciones Mujer / Hombre por products.gender, Camisetas y Crop top. Sin red ni build.
// Ejecutar desde frontend/:  npm run test:sections
import test from 'node:test';
import assert from 'node:assert/strict';
import { flowContent } from '../src/store/content/flowContent.js';
import { productsInSection, getSection, productTypes, productTypesOf, garmentOf, productGender } from '../src/store/lib/collections.js';

const P = (id, name, category, gender, extra = {}) => ({ id, name, category, gender, ...extra });
const catalog = [
  P(1, 'Top Aria', 'Tops', 'mujer'),
  P(2, 'Oversize Renacer', 'Unisex', 'hombre'),
  P(3, 'Pantaloneta Nila', 'Hombre', 'hombre'),
  P(4, 'Camiseta Circulo', 'Flow Archive', 'unisex'),
  P(5, 'Crop Top Pura Vida', 'Flow Archive', 'mujer'),
  P(6, 'Jolie Sol', 'Flow Archive', 'mujer'),
  P(7, 'Set Aria', 'Sets', 'mujer', { is_bundle: true }),
  P(8, 'Set Hombre', 'Sets', 'hombre', { is_bundle: true }),
];
const mujer = getSection('mujer');
const hombre = getSection('hombre');
const names = (list) => list.map((p) => p.name);

test('Mujer: gender mujer + unisex; nunca hombre', () => {
  assert.deepEqual(names(productsInSection(catalog, mujer)), ['Top Aria', 'Camiseta Circulo', 'Crop Top Pura Vida', 'Jolie Sol', 'Set Aria']);
});

test('Hombre: gender hombre + unisex; el Oversize solo aquí (no en Mujer)', () => {
  assert.deepEqual(names(productsInSection(catalog, hombre)), ['Oversize Renacer', 'Pantaloneta Nila', 'Camiseta Circulo', 'Set Hombre']);
  assert.ok(!names(productsInSection(catalog, mujer)).includes('Oversize Renacer'));
});

test('Camisetas aparece como tipo en Mujer y en Hombre (aunque sean de Flow Archive)', () => {
  for (const s of [mujer, hombre]) {
    const types = productTypes(productsInSection(catalog, s), { archive: false }).map((t) => t.name);
    assert.ok(types.includes('Camisetas'), `${s.slug}: ${types}`);
  }
});

test('Crop top: tipo de Mujer por el nombre; Hombre no lo tiene; la categoría no cambia', () => {
  assert.equal(garmentOf(P(0, 'crop TOP Cuadro')).label, 'Crop top');
  assert.equal(garmentOf(P(0, 'Cropó Top')), null);
  assert.deepEqual(productTypesOf(catalog[4]), ['Crop top', 'Flow Archive']);
  assert.equal(catalog[4].category, 'Flow Archive');
  const m = productTypes(productsInSection(catalog, mujer), { archive: false }).map((t) => t.name);
  const h = productTypes(productsInSection(catalog, hombre), { archive: false }).map((t) => t.name);
  assert.ok(m.includes('Crop top'));
  assert.ok(!h.includes('Crop top'));
});

test('Ver todo no cambia: los tipos salen de todo el catálogo', () => {
  const all = productTypes(catalog, { archive: false }).map((t) => t.name);
  for (const t of ['Tops', 'Camisetas', 'Crop top', 'Pantalonetas', 'Oversize', 'Sets']) assert.ok(all.includes(t), t);
});

test('productGender valida; sin gender la sección usa el criterio anterior por categoría', () => {
  assert.equal(productGender({ gender: ' HOMBRE ' }), 'hombre');
  assert.equal(productGender({ gender: 'otro' }), null);
  const legacy = [P(1, 'Top Aria', 'Tops', undefined), P(2, 'Pantaloneta Nila', 'Hombre', undefined), P(3, 'Oversize', 'Unisex', undefined)];
  assert.deepEqual(names(productsInSection(legacy, mujer)), ['Top Aria', 'Oversize']);
  assert.deepEqual(names(productsInSection(legacy, hombre)), ['Pantaloneta Nila', 'Oversize']);
});

test('las secciones del contenido declaran su género', () => {
  assert.deepEqual(flowContent.sections.map((s) => s.gender), ['mujer', 'hombre']);
});
