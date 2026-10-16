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

// Envío estimado con las reglas de la tienda (el servidor lo recalcula al crear el pedido)
export function shippingFor(store, subtotal) {
  const flat = Number(store.shipping_flat_cost) || 0;
  const freeFrom = Number(store.free_shipping_from) || 0;
  return freeFrom > 0 && subtotal >= freeFrom ? 0 : flat;
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
