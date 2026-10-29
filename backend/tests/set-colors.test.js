// Sets: los colores de SET_EXCLUDED_COLORS (Verde oliva) no se ofrecen; los productos sueltos no cambian
const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveBundle, isSetExcludedColor, SET_EXCLUDED_COLORS } = require('../src/utils/bundles');

const top = { quantity: 1, product: { id: 'top', name: 'Top', stock: 0 } };
const short = { quantity: 1, product: { id: 'short', name: 'Short', stock: 0 } };
const v = (id, color, talla, stock = 5) => ({ id, attributes: { Color: color, Talla: talla }, stock });

test('la lista de excluidos vive en una sola constante', () => {
  assert.ok(SET_EXCLUDED_COLORS.includes('verde oliva'));
});

test('tolerante a mayúsculas, tildes y espacios', () => {
  for (const c of ['Verde oliva', 'VERDE OLIVA', 'verde  olíva ', 'Verde Oliva']) assert.equal(isSetExcludedColor({ color: c }), true, c);
  assert.equal(isSetExcludedColor({ color: 'Verde' }), false);
  assert.equal(isSetExcludedColor({ talla: 'S' }), false);
});

test('el set no ofrece Verde oliva aunque ambos componentes lo tengan', () => {
  const d = deriveBundle({ id: 'set' }, [top, short], {
    top: [v('t1', 'Negro', 'S'), v('t2', 'Verde Oliva', 'S')],
    short: [v('s1', 'negro', 's'), v('s2', 'verde oliva', 'S')],
  });
  assert.equal(d.error, null);
  assert.equal(d.variants.length, 1);
  assert.equal(d.variants[0].attributes.Color, 'Negro');
  assert.equal(d.lost.length, 0, 'el color excluido tampoco se reporta como combinación perdida');
});

test('un componente con solo Verde oliva deja el set sin combinaciones (no lo trata como simple)', () => {
  const d = deriveBundle({ id: 'set' }, [top, short], { top: [v('t2', 'Verde oliva', 'S')], short: [v('s1', 'Negro', 'S')] });
  assert.equal(d.error, null);
  assert.equal(d.hasVariants, true);
  assert.equal(d.variants.length, 0);
});

test('los productos sueltos conservan el color (la lista de variantes original no se altera)', () => {
  const vars = { top: [v('t1', 'Negro', 'S'), v('t2', 'Verde oliva', 'S')], short: [v('s1', 'Negro', 'S')] };
  deriveBundle({ id: 'set' }, [top, short], vars);
  assert.equal(vars.top.length, 2);
});
