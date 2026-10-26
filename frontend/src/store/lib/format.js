// Formato y helpers puros de la tienda.

const copFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export const formatCOP = (v) => copFormatter.format(Number(v) || 0);

const removeAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Mismo criterio que backend/src/utils/optionKey.js
export const attrName = (k) => removeAccents(k).toLowerCase().trim();
export function optionKey(value) {
  return removeAccents(value).trim().toLowerCase()
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
}

export const COLOR_KEYS = ['color', 'colour'];
export const SIZE_KEYS = ['talla', 'size', 'tamano'];

// Valor de un atributo de una variante buscando por varias claves posibles ("Color", "color"...)
export function attrValue(attributes, keys) {
  for (const [k, v] of Object.entries(attributes || {})) {
    if (keys.includes(attrName(k)) && String(v).trim()) return String(v).trim();
  }
  return null;
}

// Celular colombiano: 10 dígitos que empiezan por 3 (acepta +57 y espacios)
export function normalizePhone(value) {
  let d = String(value || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
  return /^3\d{9}$/.test(d) ? d : null;
}

// Ciudad normalizada igual que el servidor (backend/src/config/shipping.js): sin tildes ni signos,
// minúsculas, espacios simples; "Santiago de Cali" y "Cali, Valle" son "cali".
const CITY_ALIASES = {
  'santiago de cali': 'cali', 'cali valle': 'cali', 'cali valle del cauca': 'cali', 'cali colombia': 'cali',
  'santiago de cali valle': 'cali', 'santiago de cali valle del cauca': 'cali',
};
export function normalizeCity(value) {
  const base = removeAccents(value).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return CITY_ALIASES[base] || base;
}

const hasLocalCost = (v) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
const localCityOf = (store) => normalizeCity(store.shipping_local_city || 'cali');

// ¿La ciudad es la ciudad local de la tienda? (para el plazo de entrega y la tarifa local)
export const isLocalCity = (store, city) => normalizeCity(city) === localCityOf(store);

// Envío mostrado en pantalla con las reglas de la tienda; el servidor lo recalcula al crear el pedido.
// Sin shipping_local_cost la tienda cobra la tarifa plana en todo.
export function shippingFor(store, subtotal, city = '') {
  const flat = Number(store.shipping_flat_cost) || 0;
  const freeFrom = Number(store.free_shipping_from) || 0;
  if (freeFrom > 0 && subtotal >= freeFrom) return 0;
  return hasLocalCost(store.shipping_local_cost) && isLocalCity(store, city) ? Number(store.shipping_local_cost) : flat;
}

export const isEmail =(v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

// Clave de idempotencia: una por intento de compra
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export const STATUS_LABELS = {
  recibido: 'Recibido',
  en_proceso: 'En preparación',
  listo: 'Listo para envío',
  enviado: 'Enviado',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

// Enlace de WhatsApp (wa.me) con mensaje prellenado; null si no hay número
export function waLink(number, text) {
  const digits = String(number || '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
