// Helpers puros (sin React) para colecciones, cápsulas, drops y colores.
// Trabajan sobre las tarjetas de /api/store/:slug/products:
//   { id, name, category, price, images[], colors[{ key, name, image, available }], sizes_available[], in_stock, low_stock }
import { flowContent, colorMap } from '../content/flowContent.js';

const arr = (v) => (Array.isArray(v) ? v : []);

// Minúsculas, sin tildes, guiones/guion bajo como espacio, espacios simples, trim.
// "Azul-Noche" y "azul noche" → "azul noche". La key de la API ("verde-rocio") también coincide.
export function normalize(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Hex del color o null si no está en el mapa
export function colorHex(name, map = colorMap) {
  const key = normalize(name);
  return key && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

// Colores claros llevan borde stone (blanco, arena, beige, rocío...)
export function isLightColor(hex) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return true;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170;
}

export function getActiveCollection(content = flowContent) {
  const list = arr(content?.collections);
  return list.find((c) => c && c.slug === content.activeCollection) || list[0] || null;
}

export function getCollection(slug, content = flowContent) {
  return arr(content?.collections).find((c) => c && c.slug === slug) || null;
}

export function isArchiveCategory(category, content = flowContent) {
  const cat = normalize(category);
  return !!cat && arr(content?.archive?.categoryMatch).some((m) => normalize(m) === cat);
}

// Colores de un producto: [{ key (normalizado), name, image, available }]
export function colorsOfProduct(product) {
  const seen = new Set();
  const out = [];
  for (const c of arr(product?.colors)) {
    if (!c || (!c.name && !c.key)) continue;
    const name = String(c.name || c.key).trim();
    const key = normalize(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name, image: typeof c.image === 'string' && c.image ? c.image : null, available: c.available !== false, apiKey: c.key || null });
  }
  return out;
}

const hasAnyColor = (product, colors) => {
  const wanted = new Set(arr(colors).map(normalize));
  return colorsOfProduct(product).some((c) => wanted.has(c.key));
};

// Productos de la colección: todo lo que NO es Archive ni categoría excluida
export function productsInCollection(products, collection, content = flowContent) {
  const excluded = new Set(arr(collection?.excludeCategories).map(normalize));
  return arr(products).filter((p) => p && p.id
    && !isArchiveCategory(p.category, content)
    && !excluded.has(normalize(p.category)));
}

export function productsInArchive(products, content = flowContent) {
  return arr(products).filter((p) => p && p.id && isArchiveCategory(p.category, content));
}

// Colores que DEFINEN un drop (drop.defines con sus alias; si no tiene, sus colores). Solo estos deciden
// qué productos entran: un producto con gris pero sin verde no entra a DEW.
export function dropDefiningColors(drop) {
  return colorPriority(null, arr(drop?.defines).length ? drop.defines : drop?.colors);
}

export function productsInDrop(products, drop) {
  if (!drop) return [];
  const colors = dropDefiningColors(drop);
  return arr(products).filter((p) => p && p.id && hasAnyColor(p, colors));
}

// Colores de una cápsula: los propios más los de sus drops
export function capsuleColors(collection, capsule) {
  if (!capsule) return [];
  const fromDrops = arr(collection?.drops).filter((d) => d && d.capsule === capsule.slug).flatMap((d) => arr(d.colors));
  return [...new Set([...arr(capsule.colors), ...fromDrops].map(normalize))];
}

// Otros nombres con los que puede venir un color de cápsula (se comparan normalizados: sin mayúsculas, tildes ni
// guiones). Cada alias va justo después de su color, con la misma prioridad.
const COLOR_ALIASES = {
  negro: ['noir'], azul: ['deep blue'], 'vino tinto': ['merlot'], rojo: ['merlot'], beige: ['sand'],
  lavanda: ['lila', 'lavender', 'lavander', 'dew'], verde: ['dew'],
};

// Orden de colores para la foto principal de las tarjetas (cápsulas y drops): primero `priority`, luego el
// resto de `colors`, cada uno con sus alias. La tarjeta usa el primero que el producto tenga CON foto.
function colorPriority(priority, colors) {
  const all = arr(colors).map(normalize);
  const first = arr(priority).map(normalize).filter((k) => all.includes(k));
  return [...new Set([...first, ...all].flatMap((k) => [k, ...arr(COLOR_ALIASES[k]).map(normalize)]))];
}

// Cápsula: capsule.photoPriority y luego los colores de la cápsula y sus drops
export function capsuleColorOrder(collection, capsule) {
  return colorPriority(capsule?.photoPriority, capsuleColors(collection, capsule));
}

// Drop ("Comprar por color"): drop.photoPriority (si la tiene) y luego sus colores
export function dropColorOrder(drop) {
  return colorPriority(drop?.photoPriority, drop?.colors);
}

// Colores que definen una cápsula: la unión de los que definen sus drops (si no tiene drops, sus colores)
export function capsuleDefiningColors(collection, capsule) {
  if (!capsule) return [];
  const drops = arr(collection?.drops).filter((d) => d && d.capsule === capsule.slug);
  return drops.length ? [...new Set(drops.flatMap(dropDefiningColors))] : colorPriority(null, capsule.colors);
}

export function productsInCapsule(products, collection, capsule) {
  if (!capsule) return [];
  const colors = capsuleDefiningColors(collection, capsule);
  return arr(products).filter((p) => p && p.id && hasAnyColor(p, colors));
}

// Foto del producto para un conjunto de colores (la del primer color que coincida) o null
// Foto del producto para unos colores, respetando su orden (el primero de la lista que tenga foto)
export function imageForColors(product, colors) {
  const own = colorsOfProduct(product);
  for (const k of arr(colors).map(normalize)) {
    const hit = own.find((c) => c.key === k && c.image);
    if (hit) return hit.image;
  }
  return null;
}

export function firstImage(product) {
  return arr(product?.images).find((u) => typeof u === 'string' && u) || null;
}

// Primera foto disponible de una lista de productos para unos colores (para tiles de color)
export function coverForColors(products, colors) {
  for (const p of arr(products)) {
    const img = imageForColors(p, colors);
    if (img) return img;
  }
  return null;
}

// Producto cuyo nombre contiene la clave (normalizado)
export function findProductByKey(products, key) {
  const k = normalize(key);
  if (!k) return null;
  return arr(products).find((p) => p && p.id && normalize(p.name).includes(k)) || null;
}

// Rango de jerarquía: 0 ícono, 1 disruptivos, 2 expansión, 3 esenciales, 9 el resto
export function hierarchyRank(product, collection) {
  const name = normalize(product?.name);
  const h = collection?.products || {};
  const match = (keys) => arr(keys).some((k) => normalize(k) && name.includes(normalize(k)));
  if (h.icon && name.includes(normalize(h.icon))) return 0;
  if (match(h.disruptive)) return 1;
  if (match(h.expansion)) return 2;
  if (match(h.essential)) return 3;
  return 9;
}

// Orden sugerido de la colección (estable: respeta el orden original dentro de cada rango)
export function sortByHierarchy(products, collection) {
  return arr(products)
    .map((p, i) => ({ p, i, r: hierarchyRank(p, collection) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.p);
}

// Categorías [{ name, count }] en el orden de config, luego alfabético, Archive al final
export function categoriesOrdered(categories, content = flowContent) {
  const order = arr(content?.categoryOrder).map(normalize);
  const rank = (c) => {
    if (isArchiveCategory(c.name, content)) return 10000;
    const i = order.indexOf(normalize(c.name));
    return i === -1 ? 1000 : i;
  };
  return arr(categories)
    .filter((c) => c && typeof c.name === 'string' && c.name.trim())
    .slice()
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'es'));
}

// ── Secciones del menú (Mujer, Hombre) y catálogo "Ver todo" ─────────────────
const inList = (category, list) => !!normalize(category) && arr(list).some((c) => normalize(c) === normalize(category));

export function getSection(slug, content = flowContent) {
  return arr(content?.sections).find((s) => s && s.slug === slug) || null;
}

export const categoryInSection = (category, section) => inList(category, section?.categories);

// Productos de la sección: sus categorías más las de género compartido (Unisex), que van en todas
// Un set (is_bundle) entra si TODOS sus productos son de la sección o Unisex (bundle_categories de la API)
// Flow Archive: entra si su prenda (por el nombre: "Licra Liva" → Licras) es una categoría de la sección.
export function productsInSection(products, section, content = flowContent) {
  if (!section) return [];
  const fits = (category) => inList(category, section.categories) || inList(category, content?.unisexCategories);
  return arr(products).filter((p) => p && p.id && (p.is_bundle
    ? arr(p.bundle_categories).length > 0 && arr(p.bundle_categories).every(fits)
    : fits(p.category) || (isArchiveCategory(p.category, content) && inList(garmentOf(p)?.label, section.categories))));
}

// Mujer / Hombre / Unisex son GÉNERO (flowContent.genderCategories), nunca tipo de prenda ni filtro
export const isGenderCategory = (category, content = flowContent) => inList(category, content?.genderCategories);

// Sección de una categoría de género (Hombre → sección hombre); null si no es género o no tiene sección
export function sectionForCategory(category, content = flowContent) {
  if (!isGenderCategory(category, content)) return null;
  return arr(content?.sections).find((s) => inList(category, s.categories) || normalize(s.label) === normalize(category)) || null;
}

// Página de un tipo de prenda dentro de "Ver todo"
export const typePath = (type) => `/coleccion?categoria=${encodeURIComponent(type)}`;

// Ruta interna de una categoría de la base: una de género va a su sección; el resto, a su tipo de prenda
export function categoryPath(category, content = flowContent) {
  const section = sectionForCategory(category, content);
  return section ? `/coleccion/${section.slug}` : typePath(category);
}

// Tipo de prenda por la primera palabra del nombre ("Pantaloneta Nila" → Pantalonetas). Solo palabras de
// este diccionario: si el nombre no empieza por una de ellas, el producto no se agrupa (no se adivina).
const GARMENTS = {
  licra: 'Licras', pantaloneta: 'Pantalonetas', camiseta: 'Camisetas', buzo: 'Buzos', jogger: 'Joggers', sudadera: 'Sudaderas',
  chaqueta: 'Chaquetas', bermuda: 'Bermudas', short: 'Shorts', oversize: 'Oversize', esqueleto: 'Esqueletos',
};

export function garmentOf(product) {
  const word = normalize(product?.name).split(' ')[0];
  return word && Object.prototype.hasOwnProperty.call(GARMENTS, word) ? { key: word, label: GARMENTS[word] } : null;
}

// Tipos de prenda de un producto, para la guía de tallas: su tipo (productType) y el de su nombre (garmentOf,
// así una "Licra" de Flow Archive cuenta como Licras). Un set: los de sus componentes (por su nombre).
export function garmentTypesOf(product, content = flowContent) {
  const parts = Array.isArray(product?.bundle?.components) ? product.bundle.components : [];
  const types = parts.length
    ? parts.map((c) => garmentOf(c)?.label)
    : [productType(product, content), garmentOf(product)?.label];
  return [...new Set(types.filter(Boolean))];
}

// [{ key, label, count }] por tipo de prenda, en orden alfabético; los productos sin tipo reconocido no cuentan
export function garmentGroups(products) {
  const groups = new Map();
  for (const p of arr(products)) {
    const g = garmentOf(p);
    if (!g) continue;
    if (!groups.has(g.key)) groups.set(g.key, { ...g, count: 0 });
    groups.get(g.key).count += 1;
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

// ── Tipo de prenda: helper ÚNICO del menú, del filtro del listado, del sitemap y del prerender ──
// Categoría normal (Tops, Licras…) y Flow Archive: la misma categoría. Categoría de género
// (Hombre, Unisex): el tipo de prenda del nombre (garmentOf); null si no se puede deducir.
export const SETS_TYPE = 'Sets';

export function productType(product, content = flowContent) {
  // Un set es un tipo de prenda propio, por is_bundle (nunca por el nombre)
  if (product?.is_bundle) return SETS_TYPE;
  const category = String(product?.category || '').trim();
  if (!category) return null;
  if (isGenderCategory(category, content)) return garmentOf(product)?.label || null;
  return category;
}

// Tipos de prenda en los que se LISTA un producto (filtro, menús, conteos). Normal: [productType]. Flow Archive:
// su prenda por el nombre (garmentOf) y además Flow Archive; si el nombre no dice la prenda, solo Flow Archive.
// productType (uno solo) sigue siendo la etiqueta del producto (ruta de la ficha, SEO).
export function productTypesOf(product, content = flowContent) {
  const type = productType(product, content);
  if (!type) return [];
  if (!isArchiveCategory(product?.category, content)) return [type];
  const garment = garmentOf(product)?.label;
  return garment && normalize(garment) !== normalize(type) ? [garment, type] : [type];
}

// [{ name, count }] de tipos de prenda en el orden de categoryOrder (Archive al final).
// archive: false deja fuera Flow Archive (el menú lo enlaza aparte); sus prendas sí cuentan en su tipo.
export function productTypes(products, { archive = true } = {}, content = flowContent) {
  const counts = new Map();
  for (const p of arr(products)) {
    if (!p || !p.id) continue;
    for (const type of productTypesOf(p, content)) {
      if (!archive && isArchiveCategory(type, content)) continue;
      const key = normalize(type);
      if (!counts.has(key)) counts.set(key, { name: type, count: 0 });
      counts.get(key).count += 1;
    }
  }
  return categoriesOrdered([...counts.values()], content);
}

// Categorías que coinciden con un término de navegación ("mujer", "hombre")
export function categoriesMatching(categories, term) {
  const t = normalize(term);
  return arr(categories).filter((c) => c && t && normalize(c.name).split(' ').some((w) => w.startsWith(t)));
}

// Todas las tallas de una lista de productos, ordenadas XS..XXL y luego numéricas/alfabéticas
const SIZE_ORDER = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', 'unica', 'talla unica'];
export function sizeRank(size) {
  const i = SIZE_ORDER.indexOf(normalize(size));
  if (i !== -1) return i;
  const n = Number(size);
  return Number.isFinite(n) ? 100 + n : 1000;
}
export function sizesOf(products) {
  const map = new Map();
  for (const p of arr(products)) {
    for (const s of arr(p?.sizes_available)) {
      const key = normalize(s);
      if (key && !map.has(key)) map.set(key, String(s).trim());
    }
  }
  return [...map.values()].sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b, 'es'));
}

// Colores presentes en una lista de productos [{ key, name, hex }], sin repetir
export function colorsIn(products) {
  const map = new Map();
  for (const p of arr(products)) {
    for (const c of colorsOfProduct(p)) if (!map.has(c.key)) map.set(c.key, { key: c.key, name: c.name, hex: colorHex(c.name) || colorHex(c.key) });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

// Filtros de listado (todos opcionales). sort: 'nuevo' | 'precio-asc' | 'precio-desc' | 'sugerido'
export function filterProducts(products, { category, color, size, q, sort, collection } = {}) {
  const cat = normalize(category);
  const col = normalize(color);
  const sz = normalize(size);
  const query = normalize(q);
  let list = arr(products).filter((p) => p && p.id);
  if (cat) list = list.filter((p) => productTypesOf(p).some((t) => normalize(t) === cat));
  if (col) list = list.filter((p) => colorsOfProduct(p).some((c) => c.key === col));
  if (sz) list = list.filter((p) => arr(p.sizes_available).some((s) => normalize(s) === sz));
  if (query) {
    list = list.filter((p) => normalize(p.name).includes(query)
      || normalize(p.category).includes(query)
      || colorsOfProduct(p).some((c) => c.key.includes(query)));
  }
  if (sort === 'precio-asc') list = [...list].sort((a, b) => Number(a.price) - Number(b.price));
  else if (sort === 'precio-desc') list = [...list].sort((a, b) => Number(b.price) - Number(a.price));
  // Al buscar por nombre, los sets van antes que sus piezas sueltas ("aria" → Set Aria, luego Top Aria…)
  if (query && sort !== 'precio-asc' && sort !== 'precio-desc') list = [...list.filter((p) => p.is_bundle), ...list.filter((p) => !p.is_bundle)];
  else if (sort === 'sugerido' && collection) list = sortByHierarchy(list, collection);
  return list;
}
