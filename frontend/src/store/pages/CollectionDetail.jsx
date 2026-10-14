import { useParams } from 'react-router-dom';
import { useStorePath } from '../hooks/useStore';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useCatalog } from '../hooks/useCatalog';
import { flowContent } from '../content/flowContent';
import { getCollection, productsInCollection, getActiveCollection } from '../lib/collections';
import ProductListing from '../components/ProductListing';
import { PageNotFound } from '../components/States';

// /coleccion/:collectionSlug: encabezado de la colección y listado con filtro por cápsula
export default function CollectionDetail() {
  const { collectionSlug } = useParams();
  const path = useStorePath();
  const catalog = useCatalog();
  const collection = getCollection(collectionSlug);
  useDocumentMeta(collection ? `${collection.label} — ${flowContent.brand.name}` : flowContent.brand.name,
    collection?.intro || collection?.hero?.subtitle || flowContent.brand.slogan);

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
