import { createContext, useContext } from 'react';

export const CartContext = createContext(null);
export const lineKey = (productId, variantId) => `${productId}:${variantId || ''}`;

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart debe usarse dentro de CartProvider');
  return ctx;
}
