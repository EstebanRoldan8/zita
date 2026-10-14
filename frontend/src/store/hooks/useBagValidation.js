import { useQueries } from '@tanstack/react-query';
import { storeApi } from '../lib/storeApi';
import { asArray } from '../lib/safe';
import { evaluateBag, assertProduct } from '../lib/bagRules';

// Revalida la bolsa contra la API: producto/variante disponible, cupo (max_qty) y precio actual.
// Con enabled=false (drawer cerrado) las consultas no corren: las líneas sin datos en caché
// no se marcan (antes se leía data=undefined y la tienda quedaba en blanco).
export function useBagValidation(slug, lines, enabled = true) {
  const safeLines = asArray(lines).filter((l) => l && typeof l.product_id === 'string');
  const productIds = [...new Set(safeLines.map((l) => l.product_id))];

  const results = useQueries({
    queries: productIds.map((id) => ({
      queryKey: ['store', slug, 'product', id],
      queryFn: async () => assertProduct(await storeApi.getProduct(slug, id)),
      enabled: enabled && !!slug,
      staleTime: 0,
      retry: (count, err) => !err?.notAvailable && err?.response?.status !== 404 && count < 1,
    })),
  });

  const byId = {};
  productIds.forEach((id, i) => { byId[id] = results[i]; });
  const loading = enabled && results.some((r) => r?.isLoading);
  const { issues, blocking } = evaluateBag(safeLines, byId);
  return { loading, issues, blocking };
}
