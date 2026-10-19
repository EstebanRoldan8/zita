import { useMemo } from 'react';
import { useCatalog, useCategories } from './useCatalog';
import { useStorePath } from './useStore';
import { flowContent } from '../content/flowContent';
import {
  getActiveCollection, productsInCollection, productsInArchive, productsInDrop, productsInSection,
  productsInCatalog, categoriesOrdered, categoryInSection, categoryPath, isArchiveCategory,
  isHiddenFromFilters, firstImage, sortByHierarchy,
} from '../lib/collections';

const catLink = (path, name) => path(categoryPath(name));

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
    // Categorías del menú: sin Archive y sin las ocultas en menús/filtros (Hombre, Unisex)
    const shopCategories = categories.filter((c) => !isArchiveCategory(c.name) && !isHiddenFromFilters(c.name));
    const archiveCategory = categories.find((c) => isArchiveCategory(c.name)) || null;
    const drops = (collection?.drops || [])
      .map((d) => ({ ...d, count: productsInDrop(inCollection, d).length, href: path(`/colores/${d.slug}`) }))
      .filter((d) => d.count > 0);
    // Secciones (Mujer, Hombre): solo si tienen productos; sus categorías en el orden de config
    const sections = (flowContent.sections || []).map((s) => ({
      ...s,
      count: productsInSection(products, s).length,
      href: path(`/coleccion/${s.slug}`),
      categories: categories.filter((c) => categoryInSection(c.name, s)).map((c) => ({ ...c, href: catLink(path, c.name) })),
    })).filter((s) => s.count > 0);
    const mujer = sections.find((s) => s.slug === 'mujer');
    const hombre = sections.find((s) => s.slug === 'hombre');
    const catalogCount = productsInCatalog(products).length;
    const featuredProduct = sortByHierarchy(inCollection, collection).find((p) => firstImage(p)) || null;

    const hasAbout = !!flowContent.about || (collection?.storytelling || []).length > 0;
    const items = [
      mujer && { id: 'mujer', label: mujer.label, href: mujer.href, mega: mujer.categories.length > 1, categories: mujer.categories },
      hombre && { id: 'hombre', label: hombre.label, href: hombre.href },
      catalogCount > 0 && { id: 'todo', label: 'Ver todo', href: path('/coleccion'), mega: true },
      archiveCategory && archive.length > 0 && { id: 'archive', label: 'Archive', href: catLink(path, archiveCategory.name), wide: true },
      hasAbout && { id: 'sobre', label: 'Sobre FLOW', href: path('/sobre-flow'), wide: true },
    ].filter(Boolean);

    return {
      ready: catalog.isSuccess && categoriesQ.isSuccess,
      items,
      sections,
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
