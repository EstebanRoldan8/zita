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

// Colores de las variantes, deduplicados por clave normalizada: "Negro" y "negro" son la misma opción, pero
// "Negro active" es otra (clave negro-active). label = primera forma vista (las activas primero).
// Por defecto solo variantes activas (tienda). El panel pide includeInactive (un grupo de fotos por CADA color,
// también de variantes inactivas) e includeOrphans (fotos guardadas con un color que ya ninguna variante usa).
function getColorOptions(variants, optionImages, { includeInactive = false, includeOrphans = false } = {}) {
  const byKey = new Map();
  const list = [...(variants || [])].sort((a, b) => Number(isActive(b)) - Number(isActive(a)));
  for (const v of list) {
    if (!includeInactive && !isActive(v)) continue;
    const attr = findColorAttribute(v.attributes);
    if (!attr) continue;
    const key = normalizeOptionKey(attr.value);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        label: String(attr.value).trim(),
        variant_count: 0,
        active_count: 0,
        images: uniqueUrls(optionImages?.[key]),
      });
    }
    const o = byKey.get(key);
    o.variant_count += 1;
    if (isActive(v)) o.active_count += 1;
  }
  const out = [...byKey.values()];
  if (includeOrphans) {
    for (const [key, urls] of Object.entries(optionImages || {})) {
      const images = uniqueUrls(urls);
      if (byKey.has(key) || images.length === 0) continue;
      out.push({ key, label: key, variant_count: 0, active_count: 0, images, orphan: true });
    }
  }
  return out;
}

// Al cambiar el color de una variante (oldKey → newKey), qué pasa con option_images. Función pura.
//  - nadie más usa el color viejo → las fotos se MUEVEN al nuevo (si el nuevo ya tenía, se suman sin repetir);
//  - otra variante (activa o no) sigue con el color viejo → las fotos se QUEDAN con ese color y se avisa;
//  - mover superaría maxPhotos en el nuevo color → no se mueve y se avisa.
// others = las demás variantes del producto (sin la que cambia). Devuelve { action, optionImages, message, ... }.
function planColorRename({ oldValue, newValue, others = [], optionImages = {}, maxPhotos = 8 }) {
  const oldKey = normalizeOptionKey(oldValue);
  const newKey = normalizeOptionKey(newValue);
  const all = { ...(optionImages || {}) };
  const fromPhotos = uniqueUrls(all[oldKey]);
  const base = { oldKey, newKey, optionImages: all, moved: 0 };
  if (!oldKey || !newKey || oldKey === newKey) return { ...base, action: 'none', message: null };
  if (fromPhotos.length === 0) return { ...base, action: 'none', message: null };
  const sharing = others.filter((v) => colorKeyOf(v) === oldKey).length;
  const oldLabel = String(oldValue).trim();
  const newLabel = String(newValue).trim();
  if (sharing > 0) {
    return {
      ...base, action: 'keep', sharing,
      message: `Las ${fromPhotos.length} fotos de «${oldLabel}» se quedan con ese color porque ${sharing} variante${sharing !== 1 ? 's' : ''} más lo usa${sharing !== 1 ? 'n' : ''}. «${newLabel}» queda sin fotos: súbelas en «Fotos por color», o cambia también las otras variantes y las fotos se moverán con la última.`,
    };
  }
  const merged = uniqueUrls([...(all[newKey] || []), ...fromPhotos]);
  if (merged.length > maxPhotos) {
    return {
      ...base, action: 'full',
      message: `No se movieron las fotos de «${oldLabel}»: «${newLabel}» pasaría de ${maxPhotos} fotos. Quedan guardadas como «${oldLabel}» (fotos sin variante); quita algunas y vuelve a intentarlo.`,
    };
  }
  const next = { ...all, [newKey]: merged };
  delete next[oldKey];
  return {
    ...base, action: 'move', optionImages: next, moved: fromPhotos.length,
    message: `${fromPhotos.length} foto${fromPhotos.length !== 1 ? 's' : ''} de «${oldLabel}» pas${fromPhotos.length !== 1 ? 'aron' : 'ó'} a «${newLabel}».`,
  };
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
// source: 'color' | 'variant' | 'gallery' | 'none'. Nunca usa las fotos de OTRO color.
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

// Fotos propias de un color (option_images o fotos de sus variantes), sin la galería general: para la tienda,
// que así no muestra en un color fotos que no son suyas. [] si el color no tiene fotos propias.
function colorOnlyImages(args) {
  const r = resolveImages(args);
  return r.source === 'color' || r.source === 'variant' ? r.images : [];
}

module.exports = { getColorOptions, planColorRename, resolveImages, colorOnlyImages, uniqueUrls, findMatchingVariant, colorKeyOf };
