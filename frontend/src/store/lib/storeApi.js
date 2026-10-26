// Cliente HTTP de la tienda pública: instancia propia, SIN el interceptor de JWT del panel
// ni el redirect a /login. Nunca envía precios: el servidor calcula todo.
import axios from 'axios';

const storeHttp = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  timeout: 15000,
});

const unwrap = (r) => r.data?.data;
const enc = encodeURIComponent;

export const storeApi = {
  getStore: (slug) => storeHttp.get(`/api/store/${enc(slug)}`).then(unwrap),

  getProducts: (slug, { category, q, page = 1, limit = 24 } = {}) =>
    storeHttp.get(`/api/store/${enc(slug)}/products`, {
      params: { ...(category ? { category } : {}), ...(q ? { q } : {}), page, limit },
    }).then(unwrap),

  getProduct: (slug, id) => storeHttp.get(`/api/store/${enc(slug)}/products/${enc(id)}`).then(unwrap),

  getCategories: (slug) => storeHttp.get(`/api/store/${enc(slug)}/categories`).then(unwrap),

  // items: [{ product_id, variant_id, quantity }] — solo identificadores y cantidades
  createOrder: (slug, { items, customer, shipping, payment_method, idempotency_key, website, consents }) =>
    storeHttp.post(`/api/store/${enc(slug)}/orders`, {
      items: items.map((i) => ({ product_id: i.product_id, variant_id: i.variant_id || null, quantity: i.quantity })),
      customer,
      shipping,
      payment_method,
      idempotency_key,
      consents,
      website,
    }),

  getOrderStatus: (slug, id, phone) =>
    storeHttp.get(`/api/store/${enc(slug)}/orders/${enc(id)}`, { params: { phone } }).then(unwrap),
};

// Mensaje legible de un error de la API
export function apiErrorMessage(err, fallback = 'Algo salió mal. Intenta de nuevo.') {
  if (!err?.response) return 'No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.';
  const e = err.response.data?.error;
  if (e === 'sin_stock') return 'Algunos productos ya no tienen unidades disponibles.';
  if (e === 'producto_no_disponible' || e === 'variante_no_disponible') return 'Algunos productos ya no están disponibles.';
  if (err.response.status === 429) return e || 'Demasiados intentos. Espera un minuto e intenta de nuevo.';
  return e || fallback;
}
