// Secciones Mujer / Hombre por products.gender, Camisetas y Crop top. Sin red ni build.
// Ejecutar desde frontend/:  npm run test:sections
import test from 'node:test';
import assert from 'node:assert/strict';
import { flowContent } from '../src/store/content/flowContent.js';
import { productsInSection, getSection, productTypes, productTypesOf, garmentOf, productGender, productsInArchive, filterProducts } from '../src/store/lib/collections.js';

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

// Las 4 Jolie de FLOW (Flow Archive, mujer), las camisetas de hombre del Archive y el resto del catálogo real
const FLOW = [
  ...['Jolie Ballena', 'Jolie Flow Club', 'Jolie Flow Active', 'Jolie Sol'].map((n, i) => P(`j${i}`, n, 'Flow Archive', 'mujer')),
  ...['Camiseta Bandera Flow', 'Camiseta Circulo', 'Camiseta Cuadro', 'Camiseta Make Waves', 'Camiseta Find The Good', 'Camiseta Flow Club'].map((n, i) => P(`c${i}`, n, 'Flow Archive', 'hombre')),
  ...['Crop top Cuadro', 'Crop Top Arte de fluir', 'Crop Top Pura Vida', 'Crop Top Flow Cursiva'].map((n, i) => P(`k${i}`, n, 'Flow Archive', 'mujer')),
  P('a1', 'Licra Liva', 'Flow Archive', 'mujer'), P('a2', 'Short Liva', 'Flow Archive', 'mujer'),
  P('t1', 'Top Aria', 'Tops', 'mujer'), P('o1', 'Oversize Renacer', 'Unisex', 'hombre'), P('p1', 'Pantaloneta Nila', 'Hombre', 'hombre'),
];
const unique = (list) => new Set(list.map((p) => p.id)).size === list.length;

test('Jolie: Camisetas por el nombre y sigue en Flow Archive (la categoría no cambia)', () => {
  for (const p of FLOW.filter((x) => x.name.startsWith('Jolie'))) {
    assert.deepEqual(productTypesOf(p), ['Camisetas', 'Flow Archive'], p.name);
    assert.equal(p.category, 'Flow Archive');
  }
});

test('Mujer → Camisetas: las 4 Jolie; Hombre → Camisetas: solo las camisetas de hombre', () => {
  const m = filterProducts(productsInSection(FLOW, mujer), { category: 'Camisetas' });
  const h = filterProducts(productsInSection(FLOW, hombre), { category: 'Camisetas' });
  assert.deepEqual(names(m).sort(), ['Jolie Ballena', 'Jolie Flow Active', 'Jolie Flow Club', 'Jolie Sol']);
  assert.ok(names(h).every((n) => n.startsWith('Camiseta ')) && h.length === 6, names(h).join(', '));
});

test('Flow Archive conserva sus 16 productos y ninguna lista repite productos', () => {
  const archive = productsInArchive(FLOW);
  assert.equal(archive.length, 16);
  assert.ok(unique(archive));
  assert.ok(unique(filterProducts(FLOW, { category: 'Flow Archive' })));
  assert.equal(filterProducts(FLOW, { category: 'Flow Archive' }).length, 16);
  // "Ver todo": cada producto una vez; Camisetas cuenta 10 (6 de hombre + 4 Jolie), sin repetir
  assert.ok(unique(filterProducts(FLOW, {})));
  assert.equal(filterProducts(FLOW, {}).length, FLOW.length);
  const camis = filterProducts(FLOW, { category: 'Camisetas' });
  assert.equal(camis.length, 10);
  assert.ok(unique(camis));
  assert.equal(productTypes(FLOW, { archive: false }).find((t) => t.name === 'Camisetas').count, 10);
});
