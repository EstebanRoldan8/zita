// Espejo de backend/src/utils/optionKey.js y getColorOptions de variantImages.js.
// Mantener ambos iguales: la clave normalizada debe coincidir con la del servidor.

const COLOR_ATTRIBUTE_KEYS = ['color', 'colour'];

const removeAccents = (str) => String(str).normalize('NFD').replace(/[̀-ͯ]/g, '');

export function normalizeOptionKey(value) {
  if (value === null || value === undefined) return '';
  return removeAccents(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function findColorAttribute(attributes) {
  if (!attributes || typeof attributes !== 'object') return null;
  for (const [key, value] of Object.entries(attributes)) {
    if (COLOR_ATTRIBUTE_KEYS.includes(removeAccents(key).toLowerCase().trim()) && normalizeOptionKey(value)) {
      return { key, value };
    }
  }
  return null;
}

// Colores de las variantes activas, deduplicados por clave (label = primera forma vista)
export function getColorOptions(variants) {
  const byKey = new Map();
  for (const v of variants || []) {
    if (!v || v.is_active === false) continue;
    const attr = findColorAttribute(v.attributes);
    if (!attr) continue;
    const key = normalizeOptionKey(attr.value);
    if (!byKey.has(key)) byKey.set(key, { key, label: String(attr.value).trim(), variant_count: 0 });
    byKey.get(key).variant_count += 1;
  }
  return [...byKey.values()];
}
