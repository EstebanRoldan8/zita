import { useQuery } from '@tanstack/react-query';
import { storeApi } from '../lib/storeApi';
import { useStore } from './useStore';

const PAGE = 48; // máximo que acepta la API
const MAX_PAGES = 10; // tope de seguridad (480 productos)

// Catálogo completo de la tienda (todas las páginas), para filtrar en el cliente por color,
// talla, cápsula y búsqueda sin llamadas nuevas al backend. Se cachea 5 minutos.
export function useCatalog() {
  const { slug } = useStore();
  return useQuery({
    queryKey: ['store', slug, 'catalog'],
    queryFn: async () => {
      const all = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const data = await storeApi.getProducts(slug, { page, limit: PAGE });
        const items = Array.isArray(data?.products) ? data.products.filter((p) => p && p.id) : [];
        all.push(...items);
        const total = Number(data?.total) || 0;
        if (items.length < PAGE || all.length >= total) break;
      }
      return all;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCategories() {
  const { slug } = useStore();
  return useQuery({
    queryKey: ['store', slug, 'categories'],
    queryFn: () => storeApi.getCategories(slug),
    staleTime: 5 * 60 * 1000,
    select: (d) => (Array.isArray(d?.categories) ? d.categories : []),
  });
}
