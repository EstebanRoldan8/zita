// Lectura y escritura de la bolsa en localStorage (funciones puras, sin React).
// Cada línea dañada o incompleta se descarta sin romper.
export const MAX_LINES = 20;
export const bagStorageKey = (slug) => `flow-bag:${slug}`;
export const lineKey = (productId, variantId) => `${productId}:${variantId || ''}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optText = (v) => (typeof v === 'string' && v.trim() ? v.slice(0, 120) : null);

// Normaliza una línea guardada; devuelve null si está dañada o incompleta
export function sanitizeLine(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const productId = typeof raw.product_id === 'string' ? raw.product_id : '';
  if (!UUID_RE.test(productId)) return null;
  const variantId = raw.variant_id == null || raw.variant_id === '' ? null : raw.variant_id;
  if (variantId !== null && (typeof variantId !== 'string' || !UUID_RE.test(variantId))) return null;
  const quantity = Number(raw.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) return null;
  const maxQty = Number(raw.max_qty);
  const price = Number(raw.price);
  return {
    key: lineKey(productId, variantId),
    product_id: productId,
    variant_id: variantId,
    name: optText(raw.name) || 'Producto',
    price: Number.isFinite(price) && price >= 0 ? price : 0,
    image: typeof raw.image === 'string' && raw.image ? raw.image : null,
    color: optText(raw.color),
    size: optText(raw.size),
    // Solo en sets: qué incluye ("Top Aria + Licra Aria"), para mostrarlo en la bolsa y el checkout
    includes: optText(raw.includes),
    // Grupo del descuento por set ('top' | 'bottom'); solo para la vista previa, el servidor recalcula
    group: raw.group === 'top' || raw.group === 'bottom' ? raw.group : null,
    max_qty: Number.isInteger(maxQty) && maxQty > 0 ? Math.min(maxQty, 10) : 10,
    quantity: Math.min(quantity, 10),
  };
}

// Texto guardado → líneas válidas, sin repetidas y como máximo MAX_LINES
export function parseBag(raw) {
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set();
  const lines = [];
  for (const item of parsed) {
    const line = sanitizeLine(item);
    if (!line || seen.has(line.key)) continue;
    seen.add(line.key);
    lines.push(line);
    if (lines.length >= MAX_LINES) break;
  }
  return lines;
}

export function readBag(slug) {
  try {
    return parseBag(window.localStorage.getItem(bagStorageKey(slug)));
  } catch {
    return [];
  }
}

export function writeBag(slug, lines) {
  try {
    window.localStorage.setItem(bagStorageKey(slug), JSON.stringify(lines));
  } catch {
    // sin almacenamiento: la bolsa vive solo en memoria
  }
}

export function clearStoredBag(slug) {
  try {
    window.localStorage.removeItem(bagStorageKey(slug));
  } catch {
    // sin almacenamiento: no hay nada que limpiar
  }
}
