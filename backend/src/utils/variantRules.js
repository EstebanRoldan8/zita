// Reglas puras de las variantes (sin base de datos): atributos, duplicados y si se puede eliminar de verdad.

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const MAX_ATTRS = 5;
const KEY_MAX = 30;
const VALUE_MAX = 40;
const MAX_MIN_STOCK = 100000;

// Minúsculas, sin tildes, espacios simples: "Azul  Cielo" y "azul cielo" son el mismo valor
function normalizeValue(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Atributos { color, talla }: 1 a 5 pares con texto o número; se limpian y se limitan. { error } o { attributes }.
function sanitizeAttributes(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Los atributos deben ser un objeto válido.' };
  }
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = String(rawKey).replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
    if (!key) continue;
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
      return { error: `El valor de «${key}» debe ser texto.` };
    }
    const value = String(rawValue).replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (key.length > KEY_MAX) return { error: `El nombre del atributo «${key.slice(0, 12)}…» es demasiado largo (máx. ${KEY_MAX}).` };
    if (value.length > VALUE_MAX) return { error: `El valor de «${key}» es demasiado largo (máx. ${VALUE_MAX}).` };
    if (Object.keys(out).some((k) => normalizeValue(k) === normalizeValue(key))) {
      return { error: `El atributo «${key}» está repetido.` };
    }
    out[key] = value;
  }
  const n = Object.keys(out).length;
  if (n === 0) return { error: 'Agrega al menos un atributo a la variante.' };
  if (n > MAX_ATTRS) return { error: `Una variante admite máximo ${MAX_ATTRS} atributos.` };
  return { attributes: out };
}

// Clave comparable de una combinación: "color=negro|talla=m" (sin mayúsculas, tildes ni orden)
function attributesKey(attributes) {
  return Object.entries(attributes || {})
    .map(([k, v]) => `${normalizeValue(k)}=${normalizeValue(v)}`)
    .sort()
    .join('|');
}

// ¿Ya existe otra variante del producto con el mismo color y talla (activa o no)? Devuelve la que choca o null.
function findDuplicate(attributes, siblings, ignoreId = null) {
  const key = attributesKey(attributes);
  if (!key) return null;
  return (siblings || []).find((v) => v.id !== ignoreId && attributesKey(v.attributes) === key) || null;
}

function duplicateMessage(dup) {
  const label = Object.values(dup.attributes || {}).join(' / ');
  return dup.is_active === false
    ? `Ya existe una variante ${label} (inactiva). Actívala en lugar de crear otra igual.`
    : `Ya existe una variante ${label} en este producto.`;
}

// Stock mínimo: entero 0..MAX. undefined = no viene.
function parseMinStock(value) {
  if (value === undefined) return { skip: true };
  const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : NaN);
  if (!Number.isInteger(n) || n < 0 || n > MAX_MIN_STOCK) return { error: 'El stock mínimo debe ser un entero mayor o igual a 0.' };
  return { value: n };
}

// Eliminar de verdad solo si NUNCA se usó: sin stock, sin pedidos y sin movimientos de inventario
// distintos del de creación ('inicial'). Si no, se ofrece desactivar.
// usage: { stock, orderItems, movements } (movements ya sin los de tipo 'inicial')
function deleteDecision(usage = {}) {
  const reasons = [];
  if (Number(usage.stock) > 0) reasons.push(`tiene ${Number(usage.stock)} unidad${Number(usage.stock) === 1 ? '' : 'es'} en stock`);
  if (Number(usage.orderItems) > 0) reasons.push(`aparece en ${Number(usage.orderItems)} pedido${Number(usage.orderItems) === 1 ? '' : 's'}`);
  if (Number(usage.movements) > 0) reasons.push('tiene movimientos de inventario');
  return {
    canDelete: reasons.length === 0,
    reasons,
    message: reasons.length ? `No se puede eliminar: ${reasons.join(', ')}. Desactívala para que deje de venderse y conservar el historial.` : null,
  };
}

module.exports = { normalizeValue, sanitizeAttributes, attributesKey, findDuplicate, duplicateMessage, parseMinStock, deleteDecision };
