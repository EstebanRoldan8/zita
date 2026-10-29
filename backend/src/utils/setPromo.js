// Descuento por set de la tienda pública: por cada pareja Top + (Falda, Short o Licra) se descuenta
// SET_PROMO.percent % sobre el precio de las dos prendas. Lo calcula SIEMPRE el servidor (createOrder).
//  - Parejas = min(unidades de tops, unidades de falda/short/licra); color y modelo no importan.
//  - Emparejamiento determinista y a favor del cliente: tops y bottoms por precio descendente, en orden.
//  - Los sets (is_bundle) no entran: ya tienen su precio.
// El tipo de prenda sale de la categoría como en frontend/src/store/lib/collections.js (productTypesOf):
// categoría normal = su tipo; categoría de género o Flow Archive = la prenda del nombre ("Licra Liva" → Licras).
// tests/set-promo.test.js comprueba que esta clasificación coincide con la del frontend.

const SET_PROMO = {
  percent: 5,
  label: 'Descuento por set (5 %)',
  topTypes: ['Tops'],
  bottomTypes: ['Faldas', 'Shorts', 'Licras'],
};

// Copia de los diccionarios de collections.js / flowContent.js que intervienen en el tipo de prenda
const GENDER_CATEGORIES = ['mujer', 'hombre', 'unisex'];
const ARCHIVE_MATCH = ['flow archive', 'archive', 'archivo'];
const GARMENTS = {
  licra: 'Licras', pantaloneta: 'Pantalonetas', camiseta: 'Camisetas', buzo: 'Buzos', jogger: 'Joggers', sudadera: 'Sudaderas',
  chaqueta: 'Chaquetas', bermuda: 'Bermudas', short: 'Shorts', oversize: 'Oversize', esqueleto: 'Esqueletos',
  // Las Jolie (Flow Archive) son camisetas: siguen en Archive y además salen en Camisetas (su género decide la sección)
  jolie: 'Camisetas',
};
const GARMENT_PHRASES = { 'crop top': 'Crop top' };

const normalize = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

function garmentOf(name) {
  const n = normalize(name);
  const word = n.split(' ')[0];
  if (word && Object.prototype.hasOwnProperty.call(GARMENTS, word)) return GARMENTS[word];
  for (const [phrase, label] of Object.entries(GARMENT_PHRASES)) if ((` ${n} `).includes(` ${phrase} `)) return label;
  return null;
}

// Tipos de prenda del producto (mismo criterio que productTypesOf del frontend)
function productTypes(product) {
  if (!product || product.is_bundle) return [];
  const category = String(product.category || '').trim();
  if (!category) return [];
  const cat = normalize(category);
  if (GENDER_CATEGORIES.includes(cat)) { const g = garmentOf(product.name); return g ? [g] : []; }
  if (ARCHIVE_MATCH.includes(cat)) { const g = garmentOf(product.name); return g && normalize(g) !== cat ? [g, category] : [category]; }
  return [category];
}

// 'top' | 'bottom' | null
function promoGroup(product) {
  const types = productTypes(product).map(normalize);
  if (types.some((t) => SET_PROMO.topTypes.map(normalize).includes(t))) return 'top';
  if (types.some((t) => SET_PROMO.bottomTypes.map(normalize).includes(t))) return 'bottom';
  return null;
}

// lines: [{ group: 'top'|'bottom'|null, price, quantity }] → { pairs, amount }
// amount en pesos enteros: por pareja, round(percent % × (precio top + precio bottom))
function setDiscount(lines) {
  const units = (group) => (lines || [])
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

module.exports = { SET_PROMO, productTypes, promoGroup, setDiscount };
