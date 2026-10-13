import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useStore, useStorePath } from '../hooks/useStore';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { storeApi } from '../lib/storeApi';
import ProductCard from '../components/ProductCard';
import { ProductGridSkeleton, ErrorState } from '../components/States';

const PAGE_SIZE = 24;
const SORTS = [
  { value: 'nuevo', label: 'Lo más nuevo' },
  { value: 'precio-asc', label: 'Precio: menor a mayor' },
  { value: 'precio-desc', label: 'Precio: mayor a menor' },
];

export default function Collection() {
  const { slug, store } = useStore();
  const path = useStorePath();
  const [params, setParams] = useSearchParams();
  const category = params.get('categoria') || '';
  const q = params.get('q') || '';
  const sort = params.get('orden') || 'nuevo';

  useDocumentMeta(`${category || 'Tienda'} — ${store.name || 'Flow'}`, `Colección ${store.name || 'Flow'}: ropa deportiva para moverte con intención.`);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const categories = useQuery({
    queryKey: ['store', slug, 'categories'],
    queryFn: () => storeApi.getCategories(slug),
    staleTime: 5 * 60 * 1000,
  });

  const products = useInfiniteQuery({
    queryKey: ['store', slug, 'products', { category, q }],
    queryFn: ({ pageParam }) => storeApi.getProducts(slug, { category, q, page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
    staleTime: 60 * 1000,
  });

  const all = useMemo(() => (products.data?.pages || []).flatMap((p) => p.products), [products.data]);
  // La API ordena por lo más nuevo; el orden por precio se aplica a lo ya cargado.
  const sorted = useMemo(() => {
    if (sort === 'precio-asc') return [...all].sort((a, b) => a.price - b.price);
    if (sort === 'precio-desc') return [...all].sort((a, b) => b.price - a.price);
    return all;
  }, [all, sort]);
  const total = products.data?.pages?.[0]?.total ?? 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 md:px-8">
      <h1 className="flow-display text-3xl md:text-4xl">{category || 'Tienda'}</h1>

      <div className="mt-8 flex flex-col gap-4 border-y border-flow-stone py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por categoría">
          <button type="button" onClick={() => setParam('categoria', '')} aria-pressed={!category}
            className={`flow-option ${!category ? 'is-active' : ''}`}>Todo</button>
          {(categories.data?.categories || []).map((c) => (
            <button key={c.name} type="button" onClick={() => setParam('categoria', c.name)} aria-pressed={category === c.name}
              className={`flow-option ${category === c.name ? 'is-active' : ''}`}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          {/* key={q}: el campo se reinicia cuando la búsqueda cambia desde la URL */}
          <form key={q} role="search" className="relative"
            onSubmit={(e) => { e.preventDefault(); setParam('q', String(new FormData(e.currentTarget).get('q') || '').trim()); }}>
            <label htmlFor="flow-q" className="flow-sr-only">Buscar productos</label>
            <input id="flow-q" name="q" type="search" defaultValue={q}
              placeholder="Buscar" maxLength={60} className="flow-input pr-11 sm:w-56" />
            <button type="submit" aria-label="Buscar" className="absolute right-0 top-0 flex h-12 w-11 items-center justify-center">
              <Search size={16} strokeWidth={1.5} />
            </button>
          </form>
          <label className="flex items-center gap-2">
            <span className="flow-sr-only">Ordenar</span>
            <select value={sort} onChange={(e) => setParam('orden', e.target.value === 'nuevo' ? '' : e.target.value)} className="flow-input sm:w-56">
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-10">
        {products.isLoading ? (
          <ProductGridSkeleton count={8} />
        ) : products.isError ? (
          <ErrorState message="No pudimos cargar los productos." onRetry={products.refetch} />
        ) : sorted.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-sm text-flow-muted">
              {q || category ? 'No encontramos productos con ese filtro.' : 'Muy pronto tendremos productos para ti.'}
            </p>
          </div>
        ) : (
          <>
            <p className="flow-label mb-6 text-flow-muted" aria-live="polite">{total} {total === 1 ? 'producto' : 'productos'}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
              {sorted.map((p, i) => <ProductCard key={p.id} product={p} to={path(`/producto/${p.id}`)} eager={i < 4} />)}
            </div>
            {products.hasNextPage && (
              <div className="mt-14 text-center">
                <button type="button" onClick={() => products.fetchNextPage()} disabled={products.isFetchingNextPage}
                  className="flow-btn flow-btn-outline">
                  {products.isFetchingNextPage ? 'Cargando...' : 'Cargar más'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
