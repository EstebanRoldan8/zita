import { createContext, useContext } from 'react';

// { slug, base, store } — base es '/tienda/<slug>' o '' en dominio propio
export const StoreContext = createContext(null);

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore debe usarse dentro de StoreApp');
  return ctx;
}

// Ruta interna de la tienda: to('/coleccion') → '/tienda/flow/coleccion'
export function useStorePath() {
  const { base } = useStore();
  return (path = '/') => `${base}${path === '/' ? '' : path}` || '/';
}
