import { useLocation, useParams } from 'react-router-dom';
import { useStorePath } from '../hooks/useStore';
import { useSeo, useSeoContext } from '../hooks/useSeo';
import { collectionSeo, sectionSeo } from '../lib/seo';
import { useCatalog } from '../hooks/useCatalog';
import { getCollection, getSection, productsInCollection, productsInSection, getActiveCollection } from '../lib/collections';
import ProductListing from '../components/ProductListing';
import { PageNotFound } from '../components/States';

// /coleccion/:collectionSlug: una colección (RENACER, con filtro por cápsula) o una sección del menú
// (Mujer, Hombre: sus categorías de flowContent.sections). Misma página de listado.
export default function CollectionDetail() {
  const { collectionSlug } = useParams();
  const path = useStorePath();
  const catalog = useCatalog();
  const collection = getCollection(collectionSlug);
  const section = collection ? null : getSection(collectionSlug);
  const seoCtx = useSeoContext();
  const search = useLocation().search;
  useSeo(section ? sectionSeo(seoCtx, { section, search }) : collectionSeo(seoCtx, { collection, search }));

  if (section) {
    return (
      <>
        <header className="bg-flow-sand">
          <div className="mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-20">
            <h1 className="flow-collection-name text-5xl md:text-7xl">{section.label}</h1>
          </div>
        </header>
        <div className="mx-auto max-w-7xl px-4 py-10 md:px-8">
          <ProductListing products={catalog.data ? productsInSection(catalog.data, section) : catalog.data} loading={catalog.isLoading}
            error={catalog.isError} onRetry={catalog.refetch} emptyText="Esta sección se está preparando. Vuelve muy pronto." />
        </div>
      </>
    );
  }
  if (!collection) return <PageNotFound homePath={path('/')} />;
  const products = productsInCollection(catalog.data || [], collection);
  const isActive = getActiveCollection()?.slug === collection.slug;

  return (
    <>
      <header className="bg-flow-sand">
        <div className="mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-20">
          {collection.eyebrow && isActive && <p className="flow-label">{collection.eyebrow}</p>}
          <h1 className="flow-collection-name mt-4 text-5xl md:text-7xl">{collection.name}</h1>
          {collection.intro && <p className="mt-5 max-w-xl text-sm md:text-base">{collection.intro}</p>}
          {collection.hero?.subtitle && <p className="mt-2 max-w-xl text-sm text-flow-muted">{collection.hero.subtitle}</p>}
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-10 md:px-8">
        <ProductListing products={products} loading={catalog.isLoading} error={catalog.isError} onRetry={catalog.refetch}
          collection={collection} isNew={isActive} emptyText="La colección se está preparando. Vuelve muy pronto." />
      </div>
    </>
  );
}
