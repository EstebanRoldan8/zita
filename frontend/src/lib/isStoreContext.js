// ¿Esta carga es la tienda pública de Flow? (ruta /tienda... o dominio propio VITE_STORE_HOST).
// Misma regla que App.jsx; se evalúa una sola vez al arrancar.
const STORE_HOST = import.meta.env.VITE_STORE_HOST;
const STORE_HOST_SLUG = import.meta.env.VITE_STORE_HOST_SLUG;

// Host propio de la tienda (www.flowactivewear.co): ahí no debe quedar el service worker de ZITA
export const isStoreHost = typeof window !== 'undefined' && !!STORE_HOST && !!STORE_HOST_SLUG
  && window.location.hostname.toLowerCase() === String(STORE_HOST).toLowerCase();

export const isStoreContext = typeof window !== 'undefined' && (
  /^\/tienda(\/|$)/.test(window.location.pathname) || isStoreHost
);
