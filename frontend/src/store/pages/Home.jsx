import { useStore, useStorePath } from '../hooks/useStore';
import { useSeo, useSeoContext } from '../hooks/useSeo';
import { homeSeo } from '../lib/seo';
import { useCatalog } from '../hooks/useCatalog';
import { useStoreNav } from '../hooks/useStoreNav';
import { flowContent } from '../content/flowContent';
import {
  getActiveCollection, productsInCollection, productsInArchive, sortByHierarchy, findProductByKey,
} from '../lib/collections';
import { ErrorState } from '../components/States';
import {
  Hero, CurrentCollection, ShopByColor, Protagonist, Storytelling, Capsules,
  PopularCategories, ValuesStrip, ArchiveBanner, FirstTime, FlowClub, SloganBand,
} from '../components/home/HomeSections';
import InstagramReels from '../components/home/InstagramReels';

// Inicio. Todo se pinta desde getActiveCollection(): al cambiar activeCollection en flowContent,
// el hero y la sección de colección cambian solos.
export default function Home() {
  const { store } = useStore();
  const path = useStorePath();
  const catalog = useCatalog();
  const nav = useStoreNav();
  const collection = getActiveCollection();
  useSeo(homeSeo(useSeoContext(), { store }));

  const all = catalog.data || [];
  const inCollection = sortByHierarchy(productsInCollection(all, collection), collection);
  const protagonist = findProductByKey(inCollection, collection?.products?.icon);

  return (
    <>
      <Hero collection={collection} path={path} />
      {catalog.isError ? (
        <ErrorState message="No pudimos cargar los productos." onRetry={catalog.refetch} />
      ) : (
        <CurrentCollection collection={collection} products={inCollection} path={path} loading={catalog.isLoading} />
      )}
      <ShopByColor collection={collection} products={inCollection} path={path} />
      <Protagonist product={protagonist} path={path} />
      <Storytelling collection={collection} />
      <Capsules collection={collection} path={path} />
      <PopularCategories categories={nav.shopCategories} products={all} />
      <ValuesStrip values={collection?.values || flowContent.values} />
      <ArchiveBanner category={nav.archiveCategory} count={productsInArchive(all).length} />
      <FirstTime path={path} />
      <InstagramReels />
      <FlowClub store={store} />
      <SloganBand />
    </>
  );
}
