import { createContext, useContext } from 'react';

export { lineKey, bagStorageKey, clearStoredBag } from '../lib/bagStorage';

export const CartContext = createContext(null);

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart debe usarse dentro de CartProvider');
  return ctx;
}
