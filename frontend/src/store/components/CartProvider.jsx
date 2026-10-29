import { useCallback, useEffect, useMemo, useState } from 'react';
import { CartContext } from '../hooks/cartContext';
import { MAX_LINES, lineKey, readBag, writeBag } from '../lib/bagStorage';
import { setDiscount } from '../lib/setPromo';

// Bolsa por tienda en localStorage (lib/bagStorage.js descarta líneas dañadas al leer).
// Cada línea guarda solo lo necesario para mostrarla; el precio es informativo
// (el total real lo calcula el servidor).

export default function CartProvider({ slug, children }) {
  const [lines, setLines] = useState(() => readBag(slug));
  const [open, setOpen] = useState(false);

  useEffect(() => { writeBag(slug, lines); }, [slug, lines]);

  const add = useCallback((line) => {
    setLines((prev) => {
      const key = lineKey(line.product_id, line.variant_id);
      const existing = prev.find((l) => l.key === key);
      const max = Math.max(Number(line.max_qty) || 10, 1);
      if (existing) {
        return prev.map((l) => (l.key === key ? { ...l, ...line, key, quantity: Math.min(l.quantity + line.quantity, max) } : l));
      }
      if (prev.length >= MAX_LINES) return prev;
      return [...prev, { ...line, key, quantity: Math.min(line.quantity, max) }];
    });
  }, []);

  const setQuantity = useCallback((key, quantity) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, Math.min(quantity, Number(l.max_qty) || 10)) } : l)));
  }, []);

  const update = useCallback((key, patch) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  const remove = useCallback((key) => setLines((prev) => prev.filter((l) => l.key !== key)), []);
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo(() => {
    const count = lines.reduce((s, l) => s + l.quantity, 0);
    const subtotal = lines.reduce((s, l) => s + (Number(l.price) || 0) * l.quantity, 0);
    // Descuento por set (estimado); netSubtotal = subtotal − descuento, base del envío gratis
    const discount = setDiscount(lines).amount;
    return { lines, count, subtotal, discount, netSubtotal: subtotal - discount, add, setQuantity, update, remove, clear, open, setOpen, isFull: lines.length >= MAX_LINES };
  }, [lines, add, setQuantity, update, remove, clear, open]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
