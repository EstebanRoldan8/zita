// Funciones puras para decidir qué fotos mostrar según el color elegido.
// Las usará también la API pública de la tienda web.
const { normalizeOptionKey, findColorAttribute, normalizeAttributeName } = require('./optionKey');

const isActive = (v) => v && v.is_active !== false;

// Quita vacíos y duplicados conservando el orden
function uniqueUrls(list) {
  const seen = new Set();
  const out = [];
  for (const url of list || []) {
    if (typeof url !== 'string' || !url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

const colorKeyOf = (variant) => {
  const attr = findColorAttribute(variant?.attributes);
  return attr ? normalizeOptionKey(attr.value) : '';
};

// Colores de las variantes activas, deduplicados por clave normalizada.
// label = primera forma vista ("Negro" y "negro" son la misma opción).
function getColorOptions(variants, optionImages) {
  const byKey = new Map();
  for (const v of variants || []) {
    if (!isActive(v)) continue;
    const attr = findColorAttribute(v.attributes);
    if (!attr) continue;
    const key = normalizeOptionKey(attr.value);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        label: String(attr.value).trim(),
        variant_count: 0,
        images: uniqueUrls(optionImages?.[key]),
      });
    }
    byKey.get(key).variant_count += 1;
  }
  return [...byKey.values()];
}

// Variante activa que coincide con todos los atributos elegidos (claves y valores normalizados)
function findMatchingVariant(variants, selectedAttributes) {
  const selected = Object.entries(selectedAttributes || {})
    .map(([k, v]) => [normalizeAttributeName(k), normalizeOptionKey(v)])
    .filter(([k, v]) => k && v);
  if (selected.length === 0) return null;
  return (variants || []).find((variant) => {
    if (!isActive(variant)) return false;
    const attrs = Object.fromEntries(
      Object.entries(variant.attributes || {}).map(([k, v]) => [normalizeAttributeName(k), normalizeOptionKey(v)])
    );
    return selected.every(([k, v]) => attrs[k] === v);
  }) || null;
}

// Prioridad: (1) fotos del color en option_images; (2) image_url de la variante elegida
// o de cualquier variante activa de ese color; (3) galería general (image_url primero).
// source: 'color' | 'variant' | 'gallery' | 'none'.
function resolveImages({ product, variants, selectedAttributes } = {}) {
  const active = (variants || []).filter(isActive);
  const colorAttr = findColorAttribute(selectedAttributes);
  const colorKey = colorAttr ? normalizeOptionKey(colorAttr.value) : '';

  if (colorKey) {
    const colorImages = uniqueUrls(product?.option_images?.[colorKey]);
    if (colorImages.length > 0) return { images: colorImages, source: 'color' };
  }

  const selectedVariant = findMatchingVariant(active, selectedAttributes);
  const sameColor = colorKey ? active.filter((v) => colorKeyOf(v) === colorKey) : [];
  const variantImages = uniqueUrls([selectedVariant?.image_url, ...sameColor.map((v) => v.image_url)]);
  if (variantImages.length > 0) return { images: variantImages, source: 'variant' };

  const gallery = uniqueUrls([product?.image_url, ...(Array.isArray(product?.images) ? product.images : [])]);
  return { images: gallery, source: gallery.length > 0 ? 'gallery' : 'none' };
}

module.exports = { getColorOptions, resolveImages, uniqueUrls, findMatchingVariant };
