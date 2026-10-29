// Descuento por set (vista previa en la bolsa y el checkout). El valor que cuenta lo calcula el servidor
// (backend/src/utils/setPromo.js, misma regla; tests/set-promo.test.js compara la clasificación).
// Por cada pareja Top + (Falda, Short o Licra): percent % sobre el precio de las dos prendas.
// Parejas = min(unidades de tops, unidades de bottoms); tops y bottoms por precio descendente, en orden.
// Los sets (is_bundle) no entran.
import { normalize, productTypesOf } from './collections.js';

export const SET_PROMO = {
  percent: 5,
  label: 'Descuento por set (5 %)',
  topTypes: ['Tops'],
  bottomTypes: ['Faldas', 'Shorts', 'Licras'],
};

// 'top' | 'bottom' | null, por el tipo de prenda de la tienda (categoría o prenda del nombre en Archive)
export function promoGroup(product) {
  if (!product || product.is_bundle) return null;
  const types = productTypesOf(product).map(normalize);
  if (types.some((t) => SET_PROMO.topTypes.map(normalize).includes(t))) return 'top';
  if (types.some((t) => SET_PROMO.bottomTypes.map(normalize).includes(t))) return 'bottom';
  return null;
}

// lines: [{ group, price, quantity }] → { pairs, amount } (pesos enteros, redondeo por pareja)
export function setDiscount(lines) {
  const units = (group) => (Array.isArray(lines) ? lines : [])
    .filter((l) => l && l.group === group)
    .flatMap((l) => Array.from({ length: Math.max(0, Math.floor(Number(l.quantity) || 0)) }, () => Math.max(0, Number(l.price) || 0)))
    .sort((a, b) => b - a);
  const tops = units('top');
  const bottoms = units('bottom');
  const pairs = Math.min(tops.length, bottoms.length);
  let amount = 0;
  for (let i = 0; i < pairs; i += 1) amount += Math.round(((tops[i] + bottoms[i]) * SET_PROMO.percent) / 100);
  return { pairs, amount };
}
