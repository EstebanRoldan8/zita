import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useCatalog } from '../hooks/useCatalog';
import { flowContent } from '../content/flowContent';
import { isArchiveCategory } from '../lib/collections';
import ProductListing from '../components/ProductListing';

// /coleccion: todo el catálogo (incluye Archive). Filtros por categoría, color, talla y orden en la URL.
export default function Collection() {
  const [params, setParams] = useSearchParams();
  const category = params.get('categoria') || '';
  const q = params.get('q') || '';
  const catalog = useCatalog();
  const archive = isArchiveCategory(category);
  const title = archive ? flowContent.archive.title : category || 'Tienda';
  useDocumentMeta(`${title} — ${flowContent.brand.name}`, archive ? flowContent.archive.text : `Tienda ${flowContent.brand.name}: ${flowContent.brand.slogan}.`);

  const submitSearch = (e) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    const value = String(new FormData(e.currentTarget).get('q') || '').trim();
    if (value) next.set('q', value); else next.delete('q');
    setParams(next, { replace: true });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-8 md:py-14">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className={archive ? 'flow-collection-name text-4xl md:text-5xl' : 'flow-display text-3xl md:text-4xl'}>{title}</h1>
          {archive && <p className="mt-3 text-sm text-flow-muted">{flowContent.archive.text}</p>}
        </div>
        <form key={q} role="search" className="relative" onSubmit={submitSearch}>
          <label htmlFor="flow-q" className="flow-sr-only">Buscar en la tienda</label>
          <input id="flow-q" name="q" type="search" defaultValue={q} placeholder="Buscar" maxLength={60} className="flow-input pr-11 md:w-64" />
          <button type="submit" aria-label="Buscar" className="absolute right-0 top-0 flex h-12 w-11 items-center justify-center">
            <Search size={16} strokeWidth={1.5} />
          </button>
        </form>
      </div>
      <ProductListing products={catalog.data} loading={catalog.isLoading} error={catalog.isError} onRetry={catalog.refetch} />
    </div>
  );
}
