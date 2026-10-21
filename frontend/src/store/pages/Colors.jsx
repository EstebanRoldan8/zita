import { Link, useParams } from 'react-router-dom';
import { useStorePath } from '../hooks/useStore';
import { useSeo, useSeoContext } from '../hooks/useSeo';
import { colorsSeo, dropSeo } from '../lib/seo';
import { useCatalog } from '../hooks/useCatalog';
import { getActiveCollection, productsInCollection, productsInDrop, coverForColors } from '../lib/collections';
import ProductListing from '../components/ProductListing';
import ColorDot from '../components/ColorDot';
import StoreImage from '../components/StoreImage';
import { PageNotFound, ProductGridSkeleton } from '../components/States';

// /colores: índice de los drops de la colección activa (solo los que tienen productos)
export function ColorsIndex() {
  const path = useStorePath();
  const catalog = useCatalog();
  const collection = getActiveCollection();
  const products = productsInCollection(catalog.data || [], collection);
  const drops = (collection?.drops || []).map((d) => ({ ...d, items: productsInDrop(products, d) })).filter((d) => d.items.length > 0);
  useSeo(colorsSeo(useSeoContext(), { drops }));

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-8 md:py-14">
      <h1 className="flow-display text-3xl md:text-4xl">Comprar por color</h1>
      {collection && <p className="mt-3 text-sm text-flow-muted">{collection.label}</p>}
      <div className="mt-10">
        {catalog.isLoading ? <ProductGridSkeleton count={6} /> : drops.length === 0 ? (
          <div className="bg-flow-sand px-6 py-16 text-center">
            <p className="flow-serif text-2xl">Muy pronto</p>
            <p className="mt-3 text-sm text-flow-muted">Los colores de la colección se están preparando.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {drops.map((d) => {
              const cover = coverForColors(d.items, d.colors);
              return (
                <Link key={d.slug} to={path(`/colores/${d.slug}`)} className="group relative block overflow-hidden"
                  style={{ aspectRatio: '4 / 5', background: d.palette?.bg, color: d.palette?.fg }}>
                  {cover && <StoreImage src={cover} alt="" width="800" height="1000" sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />}
                  {cover && <span className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(28,28,28,0.7), rgba(28,28,28,0) 55%)' }} aria-hidden="true" />}
                  <span className={`absolute inset-x-0 bottom-0 p-6 ${cover ? 'text-flow-white' : ''}`}>
                    <span className="flow-collection-name block text-4xl">{d.name}</span>
                    {d.description && <span className="mt-2 block text-sm opacity-90">{d.description}</span>}
                    <span className="flow-label mt-4 inline-block border-b border-current pb-1">Comprar · {d.items.length}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// /colores/:dropSlug: encabezado con la paleta del drop y grid filtrado por sus colores
export function DropPage() {
  const { dropSlug } = useParams();
  const path = useStorePath();
  const catalog = useCatalog();
  const collection = getActiveCollection();
  const drop = (collection?.drops || []).find((d) => d.slug === dropSlug) || null;
  const capsule = drop ? collection.capsules?.find((c) => c.slug === drop.capsule) : null;
  useSeo(dropSeo(useSeoContext(), { drop }));

  if (!drop) return <PageNotFound homePath={path('/colores')} />;
  const products = productsInDrop(productsInCollection(catalog.data || [], collection), drop);

  return (
    <>
      <header style={{ background: drop.palette?.bg, color: drop.palette?.fg }}>
        <div className="mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-20">
          <Link to={path('/colores')} className="flow-label opacity-80 hover:underline">Comprar por color</Link>
          <h1 className="flow-collection-name mt-4 text-5xl md:text-7xl">{drop.name}</h1>
          {drop.description && <p className="mt-4 max-w-xl text-sm md:text-base">{drop.description}</p>}
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            {capsule && <span className="flow-label">Cápsula {capsule.name}</span>}
            {drop.protagonist && <span className="opacity-90">Protagonista: {drop.protagonist}</span>}
            <span className="flex items-center gap-1.5" aria-label="Colores del drop">
              {drop.colors.map((c) => <ColorDot key={c} name={c} size={14} />)}
            </span>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-10 md:px-8">
        <ProductListing products={products} loading={catalog.isLoading} error={catalog.isError} onRetry={catalog.refetch}
          isNew emptyText="Este color se está preparando." />
      </div>
    </>
  );
}
