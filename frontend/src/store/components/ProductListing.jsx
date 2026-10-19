import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, X } from 'lucide-react';
import { useStorePath } from '../hooks/useStore';
import {
  filterProducts, colorsIn, sizesOf, productsInCapsule, normalize, categoriesOrdered, isHiddenFromFilters,
} from '../lib/collections';
import ProductCard from './ProductCard';
import ColorDot from './ColorDot';
import { ProductGridSkeleton, ErrorState } from './States';

const PAGE = 24;

// Listado con filtros en query params: capsula, color, categoria, talla, orden.
// Filtra en el cliente sobre el catálogo ya cargado (sin llamadas nuevas al backend).
export default function ProductListing({
  products, loading, error, onRetry, collection = null, showCategory = true, isNew = false,
  emptyText = 'No hay productos con estos filtros.',
}) {
  const path = useStorePath();
  const [params, setParams] = useSearchParams();
  const [shown, setShown] = useState(PAGE);
  const [panelOpen, setPanelOpen] = useState(false);

  const capsuleSlug = params.get('capsula') || '';
  const color = params.get('color') || '';
  const category = params.get('categoria') || '';
  const size = params.get('talla') || '';
  const sort = params.get('orden') || (collection ? 'sugerido' : 'nuevo');

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
    setShown(PAGE);
  };
  const clearAll = () => {
    const next = new URLSearchParams();
    if (params.get('q')) next.set('q', params.get('q'));
    setParams(next, { replace: true });
    setShown(PAGE);
  };

  const base = useMemo(() => (Array.isArray(products) ? products : []), [products]);
  const capsule = collection?.capsules?.find((c) => c.slug === capsuleSlug) || null;
  const afterCapsule = useMemo(() => (capsule ? productsInCapsule(base, collection, capsule) : base), [base, capsule, collection]);
  const list = useMemo(() => filterProducts(afterCapsule, { category, color, size, sort, collection, q: params.get('q') || '' }),
    [afterCapsule, category, color, size, sort, collection, params]);

  const colorOptions = useMemo(() => colorsIn(afterCapsule), [afterCapsule]);
  const sizeOptions = useMemo(() => sizesOf(afterCapsule), [afterCapsule]);
  const categoryOptions = useMemo(() => {
    const counts = {};
    // Hombre y Unisex no se ofrecen como filtro (flowContent.hiddenFromFilters)
    for (const p of afterCapsule) if (p.category && !isHiddenFromFilters(p.category)) counts[p.category] = (counts[p.category] || 0) + 1;
    return categoriesOrdered(Object.entries(counts).map(([name, count]) => ({ name, count })));
  }, [afterCapsule]);

  const active = [capsule && { key: 'capsula', label: capsule.name }, color && { key: 'color', label: colorOptions.find((c) => c.key === normalize(color))?.name || color },
    category && { key: 'categoria', label: category }, size && { key: 'talla', label: `Talla ${size}` }].filter(Boolean);

  const sortOptions = [
    collection && { value: 'sugerido', label: 'Sugerido' },
    { value: 'nuevo', label: 'Lo más nuevo' },
    { value: 'precio-asc', label: 'Precio: menor a mayor' },
    { value: 'precio-desc', label: 'Precio: mayor a menor' },
  ].filter(Boolean);

  const filters = (
    <div className="grid gap-6">
      {collection?.capsules?.length > 0 && (
        <fieldset>
          <legend className="flow-label mb-3">Cápsula</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setParam('capsula', '')} aria-pressed={!capsule} className={`flow-option ${!capsule ? 'is-active' : ''}`}>Todas</button>
            {collection.capsules.map((c) => (
              <button key={c.slug} type="button" onClick={() => setParam('capsula', c.slug)} aria-pressed={capsule?.slug === c.slug}
                className={`flow-option ${capsule?.slug === c.slug ? 'is-active' : ''}`}>
                {c.name.charAt(0) + c.name.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {colorOptions.length > 0 && (
        <fieldset>
          <legend className="flow-label mb-3">Color</legend>
          <div className="flex flex-wrap gap-2">
            {colorOptions.map((c) => {
              const on = normalize(color) === c.key;
              return (
                <button key={c.key} type="button" onClick={() => setParam('color', on ? '' : c.key)} aria-pressed={on}
                  aria-label={`Color ${c.name}`} title={c.name}
                  className={`flex h-11 items-center gap-2 border px-3 text-sm ${on ? 'border-flow-black' : 'border-[color:var(--flow-sand)]'}`}>
                  <ColorDot name={c.name} hex={c.hex} size={16} label={false} />
                  <span className="hidden sm:inline">{c.name}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      {showCategory && categoryOptions.length > 1 && (
        <label className="block">
          <span className="flow-label mb-3 block">Categoría</span>
          <select value={category} onChange={(e) => setParam('categoria', e.target.value)} className="flow-input">
            <option value="">Todas</option>
            {categoryOptions.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
          </select>
        </label>
      )}
      {sizeOptions.length > 0 && (
        <fieldset>
          <legend className="flow-label mb-3">Talla</legend>
          <div className="flex flex-wrap gap-2">
            {sizeOptions.map((s) => {
              const on = normalize(size) === normalize(s);
              return (
                <button key={s} type="button" onClick={() => setParam('talla', on ? '' : s)} aria-pressed={on}
                  className={`flow-option ${on ? 'is-active' : ''}`}>{s}</button>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );

  if (error) return <ErrorState message="No pudimos cargar los productos." onRetry={onRetry} />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-flow-stone py-3">
        <button type="button" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen} aria-controls="flow-filtros"
          className="flow-label flex min-h-11 items-center gap-2">
          <SlidersHorizontal size={16} strokeWidth={1.5} aria-hidden="true" /> Filtrar{active.length ? ` (${active.length})` : ''}
        </button>
        <p className="flow-label text-flow-muted" aria-live="polite">{loading ? 'Cargando…' : `${list.length} ${list.length === 1 ? 'producto' : 'productos'}`}</p>
        <label className="flex items-center gap-2">
          <span className="flow-sr-only">Ordenar</span>
          <select value={sort} onChange={(e) => setParam('orden', e.target.value)} className="flow-input w-auto min-w-[12rem]">
            {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>

      {panelOpen && <div id="flow-filtros" className="border-b border-flow-stone py-6">{filters}</div>}

      {active.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {active.map((a) => (
            <button key={a.key} type="button" onClick={() => setParam(a.key, '')} className="flex min-h-9 items-center gap-1 bg-flow-sand px-3 text-xs"
              aria-label={`Quitar filtro ${a.label}`}>
              {a.label} <X size={12} strokeWidth={1.5} aria-hidden="true" />
            </button>
          ))}
          <button type="button" onClick={clearAll} className="text-xs underline">Limpiar filtros</button>
        </div>
      )}

      <div className="mt-8">
        {loading ? (
          <ProductGridSkeleton count={8} />
        ) : list.length === 0 ? (
          <div className="bg-flow-sand px-6 py-16 text-center">
            <p className="flow-serif text-2xl">{active.length ? 'Nada por aquí con esos filtros' : 'Muy pronto'}</p>
            <p className="mt-3 text-sm text-flow-muted">{active.length ? 'Prueba con otro color, talla o categoría.' : emptyText}</p>
            {active.length > 0 && <button type="button" onClick={clearAll} className="flow-btn flow-btn-outline mt-6">Limpiar filtros</button>}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 md:gap-x-4 lg:grid-cols-4">
              {list.slice(0, shown).map((p, i) => (
                <ProductCard key={p.id} product={p} to={path(`/producto/${p.id}`)} eager={i < 4} isNew={isNew} activeColor={normalize(color)} />
              ))}
            </div>
            {list.length > shown && (
              <div className="mt-14 text-center">
                <button type="button" onClick={() => setShown((n) => n + PAGE)} className="flow-btn flow-btn-outline">Cargar más</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
