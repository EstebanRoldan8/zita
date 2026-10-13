import { useQueries } from '@tanstack/react-query';
import { storeApi } from '../lib/storeApi';

// Revalida la bolsa contra la API al abrirla: producto/variante disponible, cupo (max_qty)
// y precio actual. Devuelve issues por línea y si todo está listo para pedir.
export function useBagValidation(slug, lines, enabled = true) {
  const productIds = [...new Set(lines.map((l) => l.product_id))];
  const results = useQueries({
    queries: productIds.map((id) => ({
      queryKey: ['store', slug, 'product', id],
      queryFn: () => storeApi.getProduct(slug, id),
      enabled: enabled && !!slug,
      staleTime: 0,
      retry: (count, err) => err?.response?.status !== 404 && count < 1,
    })),
  });

  const byId = {};
  productIds.forEach((id, i) => { byId[id] = results[i]; });
  const loading = results.some((r) => r.isLoading);

  const issues = {};
  for (const line of lines) {
    const r = byId[line.product_id];
    if (!r || r.isLoading) continue;
    if (r.isError) {
      issues[line.key] = r.error?.response?.status === 404
        ? { type: 'gone', text: 'Este producto ya no está disponible.' }
        : { type: 'error', text: 'No pudimos revisar este producto.' };
      continue;
    }
    const p = r.data;
    let maxQty;
    if (line.variant_id) {
      const v = (p.variants || []).find((x) => x.id === line.variant_id);
      if (!v || !v.available) { issues[line.key] = { type: 'soldout', text: 'Esta talla o color se agotó.' }; continue; }
      maxQty = v.max_qty;
    } else {
      if (!p.in_stock) { issues[line.key] = { type: 'soldout', text: 'Este producto se agotó.' }; continue; }
      maxQty = p.max_qty;
    }
    const priceChanged = Number(p.price) !== Number(line.price);
    if (maxQty != null && line.quantity > maxQty) {
      issues[line.key] = { type: 'qty', text: `Solo quedan ${maxQty} disponibles.`, maxQty, price: p.price };
    } else if (priceChanged) {
      issues[line.key] = { type: 'price', text: 'El precio cambió.', price: p.price };
    }
    if (maxQty != null) issues[line.key] = { ...(issues[line.key] || {}), maxQty, price: p.price };
  }

  const blocking = Object.values(issues).some((i) => ['gone', 'soldout', 'qty', 'error'].includes(i.type));
  return { loading, issues, blocking };
}
