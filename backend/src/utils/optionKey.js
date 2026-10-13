// Funciones puras (sin base de datos) para agrupar variantes por color.
// Mismo criterio que utils/sku.js: las claves de atributo se comparan sin mayúsculas ni tildes.

const COLOR_ATTRIBUTE_KEYS = ['color', 'colour'];
const MAX_OPTION_KEY_LENGTH = 40;

function removeAccents(str) {
  return String(str).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeAttributeName(name) {
  return removeAccents(name).toLowerCase().trim();
}

// "Negró Mate " → "negro-mate". Solo [a-z0-9-], máximo 40 caracteres; '' si queda vacío.
function normalizeOptionKey(value) {
  if (value === null || value === undefined) return '';
  return removeAccents(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_OPTION_KEY_LENGTH)
    .replace(/-+$/g, '');
}

// { key, value } del atributo color ("color", "Color", "colour"...) o null si no hay
// o si su valor queda vacío al normalizarlo.
function findColorAttribute(attributes) {
  if (!attributes || typeof attributes !== 'object') return null;
  for (const [key, value] of Object.entries(attributes)) {
    if (COLOR_ATTRIBUTE_KEYS.includes(normalizeAttributeName(key)) && normalizeOptionKey(value)) {
      return { key, value };
    }
  }
  return null;
}

module.exports = { normalizeOptionKey, findColorAttribute, normalizeAttributeName, COLOR_ATTRIBUTE_KEYS };
