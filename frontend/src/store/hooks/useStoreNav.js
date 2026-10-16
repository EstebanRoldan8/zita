import { useMemo } from 'react';
import { useCatalog, useCategories } from './useCatalog';
import { useStorePath } from './useStore';
import { flowContent } from '../content/flowContent';
import {
  getActiveCollection, productsInCollection, productsInArchive, productsInDrop,
  categoriesOrdered, categoriesMatching, isArchiveCategory, firstImage, sortByHierarchy,
} from '../lib/collections';

const catLink = (path, name) => `${path('/coleccion')}?categoria=${encodeURIComponent(name)}`;

// Navegación derivada de las categorías reales + flowContent. Lo que no tiene productos no aparece.
export function useStoreNav() {
  const path = useStorePath();
  const catalog = useCatalog();
  const categoriesQ = useCategories();

  return useMemo(() => {
    const products = catalog.data || [];
    const collection = getActiveCollection();
    const inCollection = productsInCollection(products, collection);
    const archive = productsInArchive(products);
    const categories = categoriesOrdered(categoriesQ.data || []).filter((c) => Number(c.count) > 0);
    const shopCategories = categories.filter((c) => !isArchiveCategory(c.name));
    const archiveCategory = categories.find((c) => isArchiveCategory(c.name)) || null;
    const drops = (collection?.drops || [])
      .map((d) => ({ ...d, count: productsInDrop(inCollection, d).length, href: path(`/colores/${d.slug}`) }))
      .filter((d) => d.count > 0);
    const mujer = categoriesMatching(shopCategories, 'mujer');
    const hombre = categoriesMatching(shopCategories, 'hombre');
    const featuredProduct = sortByHierarchy(inCollection, collection).find((p) => firstImage(p)) || null;

    const hasAbout = !!flowContent.about || (collection?.storytelling || []).length > 0;
    const items = [
      collection && inCollection.length > 0 && { id: 'nuevo', label: 'Nuevo', href: path(`/coleccion/${collection.slug}`), mega: true },
      mujer.length > 0 && { id: 'mujer', label: 'Mujer', href: catLink(path, mujer[0].name), mega: true, categories: mujer },
      hombre.length > 0 && { id: 'hombre', label: 'Hombre', href: catLink(path, hombre[0].name), mega: true, categories: hombre },
      drops.length > 0 && { id: 'colores', label: 'Colores', href: path('/colores'), mega: true },
      archiveCategory && archive.length > 0 && { id: 'archive', label: 'Archive', href: catLink(path, archiveCategory.name), wide: true },
      hasAbout && { id: 'sobre', label: 'Sobre FLOW', href: path('/sobre-flow'), wide: true },
    ].filter(Boolean);

    return {
      ready: catalog.isSuccess && categoriesQ.isSuccess,
      items,
      collection,
      shopCategories: shopCategories.map((c) => ({ ...c, href: catLink(path, c.name) })),
      archiveCategory: archiveCategory ? { ...archiveCategory, href: catLink(path, archiveCategory.name) } : null,
      drops,
      featured: collection ? {
        title: collection.label,
        href: path(`/coleccion/${collection.slug}`),
        image: firstImage(featuredProduct),
        palette: collection.capsules?.[0]?.palette || null,
      } : null,
    };
  }, [catalog.data, catalog.isSuccess, categoriesQ.data, categoriesQ.isSuccess, path]);
}
