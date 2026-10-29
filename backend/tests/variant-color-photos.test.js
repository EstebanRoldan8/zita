// Fotos por color de variantes: un grupo por color, renombrar un color mueve o conserva sus fotos, y la tienda
// no mezcla colores. Base en memoria (sin red ni Supabase). Ejecutar: node --test tests/variant-color-photos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { getColorOptions, planColorRename, colorOnlyImages } = require('../src/utils/variantImages');

const V = (id, color, talla, extra = {}) => ({ id, attributes: { color, talla }, stock: 1, is_active: true, ...extra });

test('un grupo por cada color: "Negro active" y "Negro" son distintos; "negro"/"NEGRÓ" no', () => {
  const opts = getColorOptions([V(1, 'Negro', 'S'), V(2, 'negro', 'M'), V(3, 'Negro active', 'S'), V(4, 'NEGRÓ', 'L')], { negro: ['a'] });
  assert.deepEqual(opts.map((o) => [o.key, o.variant_count]), [['negro', 3], ['negro-active', 1]]);
  assert.deepEqual(opts.find((o) => o.key === 'negro').images, ['a']);
  assert.deepEqual(opts.find((o) => o.key === 'negro-active').images, []);
});

test('panel: incluye colores de variantes inactivas y fotos huérfanas; la tienda solo activas', () => {
  const variants = [V(1, 'Negro', 'S'), V(2, 'Negro viejo', 'S', { is_active: false })];
  const images = { negro: ['a'], 'negro-viejo': ['b'], rojo: ['c'] };
  assert.deepEqual(getColorOptions(variants, images).map((o) => o.key), ['negro']);
  const panel = getColorOptions(variants, images, { includeInactive: true, includeOrphans: true });
  assert.deepEqual(panel.map((o) => [o.key, o.active_count, !!o.orphan]), [['negro', 1, false], ['negro-viejo', 0, false], ['rojo', 0, true]]);
});

test('renombrar sin otra variante con el color viejo: las fotos se mueven', () => {
  const p = planColorRename({ oldValue: 'Negro', newValue: 'Negro active', others: [V(9, 'Azul', 'S')], optionImages: { negro: ['a', 'b'], azul: ['z'] } });
  assert.equal(p.action, 'move');
  assert.deepEqual(p.optionImages, { 'negro-active': ['a', 'b'], azul: ['z'] });
  assert.match(p.message, /2 fotos de «Negro» pasaron a «Negro active»/);
});

test('renombrar con otra variante que aún usa el color viejo: las fotos se quedan y se avisa', () => {
  const p = planColorRename({ oldValue: 'Negro', newValue: 'Negro active', others: [V(2, 'negro', 'M')], optionImages: { negro: ['a'] } });
  assert.equal(p.action, 'keep');
  assert.equal(p.sharing, 1);
  assert.deepEqual(p.optionImages, { negro: ['a'] });
  assert.match(p.message, /se quedan con ese color porque 1 variante más lo usa/);
});

test('una variante inactiva con el color viejo también lo conserva', () => {
  const p = planColorRename({ oldValue: 'Negro', newValue: 'Gris', others: [V(2, 'Negro', 'M', { is_active: false })], optionImages: { negro: ['a'] } });
  assert.equal(p.action, 'keep');
});

test('renombrar hacia un color que ya tiene fotos: se suman sin repetir; si pasaría de 8, no se mueve', () => {
  const ok = planColorRename({ oldValue: 'Negro viejo', newValue: 'Negro', optionImages: { 'negro-viejo': ['a', 'b'], negro: ['b', 'c'] } });
  assert.equal(ok.action, 'move');
  assert.deepEqual(ok.optionImages, { negro: ['b', 'c', 'a'] });
  const full = planColorRename({ oldValue: 'X', newValue: 'Y', optionImages: { x: ['1', '2', '3'], y: ['4', '5', '6', '7', '8', '9'] } });
  assert.equal(full.action, 'full');
  assert.deepEqual(full.optionImages, { x: ['1', '2', '3'], y: ['4', '5', '6', '7', '8', '9'] });
});

test('cambiar solo mayúsculas/tildes no es otro color; sin fotos no hay nada que mover', () => {
  assert.equal(planColorRename({ oldValue: 'Negro', newValue: 'NEGRÓ', optionImages: { negro: ['a'] } }).action, 'none');
  assert.equal(planColorRename({ oldValue: 'Negro', newValue: 'Gris', optionImages: {} }).action, 'none');
});

test('dos variantes con el mismo color comparten las fotos', () => {
  const variants = [V(1, 'Negro', 'S'), V(2, 'Negro', 'M')];
  const product = { option_images: { negro: ['a', 'b'] }, images: ['g'] };
  assert.deepEqual(getColorOptions(variants, product.option_images)[0], { key: 'negro', label: 'Negro', variant_count: 2, active_count: 2, images: ['a', 'b'] });
  assert.deepEqual(colorOnlyImages({ product, variants, selectedAttributes: { color: 'negro' } }), ['a', 'b']);
});

test('tienda: cada color solo sus fotos; un color sin fotos no toma la galería ni otro color', () => {
  const variants = [V(1, 'Negro', 'S'), V(2, 'Negro active', 'S')];
  const product = { option_images: { 'negro-active': ['act1', 'act2'] }, image_url: 'gal0', images: ['gal1'] };
  assert.deepEqual(colorOnlyImages({ product, variants, selectedAttributes: { color: 'Negro active' } }), ['act1', 'act2']);
  assert.deepEqual(colorOnlyImages({ product, variants, selectedAttributes: { color: 'Negro' } }), []);
  // la foto propia de la variante sí cuenta para su color
  const withVarImg = [V(1, 'Negro', 'S', { image_url: 'vneg' }), V(2, 'Negro active', 'S')];
  assert.deepEqual(colorOnlyImages({ product, variants: withVarImg, selectedAttributes: { color: 'Negro' } }), ['vneg']);
});

// ── PATCH /api/products/:id/variants/:variantId en memoria ──
const BIZ = 'biz-1';
const P = 'prod-1';
const clone = (o) => JSON.parse(JSON.stringify(o));
let db;
let failImages = false;
function q(table) {
  const st = { op: 'select', f: [], payload: null };
  const match = (r) => st.f.every(([k, op, v]) => (op === 'eq' ? r[k] === v : op === 'neq' ? r[k] !== v : true));
  const run = (one) => {
    if (st.op === 'update') {
      if (table === 'products' && failImages && st.payload.option_images) return { data: null, error: { message: 'caída' } };
      db[table].filter(match).forEach((r) => Object.assign(r, clone(st.payload)));
      return { data: null, error: null };
    }
    const rows = db[table].filter(match).map(clone);
    return { data: one ? rows[0] || null : rows, error: one && !rows[0] ? { message: 'no rows' } : null };
  };
  const b = {
    select() { return b; }, eq(k, v) { st.f.push([k, 'eq', v]); return b; }, neq(k, v) { st.f.push([k, 'neq', v]); return b; },
    update(p) { st.op = 'update'; st.payload = p; return b; },
    single() { return Promise.resolve(run(true)); }, maybeSingle() { return Promise.resolve({ ...run(true), error: null }); },
    then(res, rej) { return Promise.resolve(run(false)).then(res, rej); },
  };
  return b;
}
const fake = { from: (t) => q(t), rpc: async () => ({ data: 0, error: null }) };
const supaPath = require.resolve('../src/config/supabase');
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { supabaseAdmin: fake, createUserClient: () => fake } };
const loggerPath = require.resolve('../src/utils/logger');
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: { info() {}, warn() {}, error() {} } };
const { update } = require('../src/controllers/productVariants.controller');
const { sanitizeAttributes } = require('../src/utils/variantRules');

function reset() {
  failImages = false;
  const v = (id, color, talla, extra = {}) => ({ id, product_id: P, business_id: BIZ, attributes: { color, talla }, stock: 1, is_active: true, ...extra });
  db = {
    products: [{ id: P, business_id: BIZ, stock: 4, option_images: { negro: ['n1', 'n2'], azul: ['a1'] } }],
    product_bundle_components: [],
    product_variants: [v('v1', 'Negro', 'S'), v('v2', 'Negro', 'M'), v('v3', 'Azul', 'S'), { ...v('vx', 'Negro', 'S'), product_id: 'otro', business_id: 'biz-2' }],
  };
}
async function patch(variantId, body) {
  let status = 200; let out;
  const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } };
  await update({ params: { productId: P, variantId }, body, headers: {}, businessId: BIZ }, res);
  return { status, body: out };
}
const variant = (id) => db.product_variants.find((x) => x.id === id);
const images = () => db.products[0].option_images;

test('PATCH: renombrar con otra variante en el color viejo → fotos se quedan y responde el aviso', async () => {
  reset();
  const r = await patch('v1', { attributes: { color: 'Negro active', talla: 'S' } });
  assert.equal(r.status, 200);
  assert.equal(variant('v1').attributes.color, 'Negro active');
  assert.deepEqual(images().negro, ['n1', 'n2']);
  assert.equal(images()['negro-active'], undefined);
  assert.equal(r.body.photos.action, 'keep');
});

test('PATCH: renombrar la última variante del color → las fotos se mueven al nuevo nombre', async () => {
  reset();
  await patch('v1', { attributes: { color: 'Negro active', talla: 'S' } });
  const r = await patch('v2', { attributes: { color: 'Negro active', talla: 'M' } });
  assert.equal(r.body.photos.action, 'move');
  assert.deepEqual(images()['negro-active'], ['n1', 'n2']);
  assert.equal(images().negro, undefined, 'no quedan fotos huérfanas');
  assert.deepEqual(images().azul, ['a1']);
});

test('PATCH: si no se pueden guardar las fotos, la variante conserva su color (todo o nada)', async () => {
  reset();
  await patch('v1', { attributes: { color: 'Negro active', talla: 'S' } });
  failImages = true;
  const r = await patch('v2', { attributes: { color: 'Negro active', talla: 'M' } });
  assert.equal(r.status, 500);
  assert.equal(variant('v2').attributes.color, 'Negro');
  assert.deepEqual(images().negro, ['n1', 'n2']);
});

test('PATCH: no deja dos variantes iguales (sin importar mayúsculas/tildes)', async () => {
  reset();
  const r = await patch('v1', { attributes: { color: 'NEGRÓ', talla: 'm' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'VARIANT_DUPLICATE');
  assert.equal(variant('v1').attributes.talla, 'S');
});

test('PATCH: atributos inválidos → 400; se sanitizan espacios y caracteres de control', async () => {
  reset();
  for (const bad of [[], 'x', {}, { color: { a: 1 } }, { color: 'x'.repeat(41) }, { ['k'.repeat(31)]: 'v' }]) {
    assert.equal((await patch('v1', { attributes: bad })).status, 400, JSON.stringify(bad));
  }
  assert.deepEqual(sanitizeAttributes({ ' color ': ' Negro\n  active ', talla: 'S' }).attributes, { color: 'Negro active', talla: 'S' });
});

test('PATCH: variante de otro negocio → 404 y nada cambia', async () => {
  reset();
  const r = await patch('vx', { attributes: { color: 'Rojo', talla: 'S' } });
  assert.equal(r.status, 404);
  assert.equal(variant('vx').attributes.color, 'Negro');
});
