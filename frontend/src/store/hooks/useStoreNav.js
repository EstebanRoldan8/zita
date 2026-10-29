import { useMemo } from 'react';
import { useCatalog, useCategories } from './useCatalog';
import { useStorePath } from './useStore';
import { flowContent } from '../content/flowContent';
import {
  getActiveCollection, productsInCollection, productsInArchive, productsInDrop, productsInSection,
  categoriesOrdered, categoryPath, typePath, isArchiveCategory,
  firstImage, sortByHierarchy, productTypes,
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
    // Tipos de prenda de "Ver todo" (Tops, Licras, …, Pantalonetas): mismo helper que el filtro del listado.
    // Nunca Mujer/Hombre/Unisex; Archive va aparte.
    const shopCategories = productTypes(products, { archive: false });
    const archiveCategory = categories.find((c) => isArchiveCategory(c.name)) || null;
    const drops = (collection?.drops || [])
      .map((d) => ({ ...d, count: productsInDrop(inCollection, d).length, href: path(`/colores/${d.slug}`) }))
      .filter((d) => d.count > 0);
    // Secciones (Mujer, Hombre): solo si tienen productos (incluye los Unisex). Su catálogo en el menú son
    // los tipos de prenda de esos productos (productTypes, el mismo helper del filtro), filtrados dentro de
    // la sección: Mujer → Tops, Licras, Shorts, Faldas, Oversize; Hombre → Pantalonetas, Oversize.
    const sections = (flowContent.sections || []).map((s) => {
      const items = productsInSection(products, s);
      const href = path(`/coleccion/${s.slug}`);
      const menu = productTypes(items, { archive: false })
        .map((t) => ({ name: t.name, count: t.count, href: `${href}?categoria=${encodeURIComponent(t.name)}` }));
      return { ...s, count: items.length, href, menu, menuTitle: menu.length > 1 ? 'Categorías' : 'Prendas' };
    }).filter((s) => s.count > 0);
    const mujer = sections.find((s) => s.slug === 'mujer');
    const hombre = sections.find((s) => s.slug === 'hombre');
    const catalogCount = products.length;
    const shopLinks = shopCategories.map((c) => ({ ...c, href: path(typePath(c.name)) }));
    const featuredProduct = sortByHierarchy(inCollection, collection).find((p) => firstImage(p)) || null;

    const hasAbout = !!flowContent.about || (collection?.storytelling || []).length > 0;
    const items = [
      // "Ver todo" primero. Los tres desplegables llevan su catálogo y la columna "Comprar por color"
      catalogCount > 0 && { id: 'todo', label: 'Ver todo', href: path('/coleccion'), mega: true, categories: shopLinks, menuTitle: 'Categorías', byColor: true, extras: true },
      ...[mujer, hombre].filter(Boolean).map((sec) => ({
        id: sec.slug, label: sec.label, href: sec.href, mega: true, categories: sec.menu, menuTitle: sec.menuTitle, byColor: true, section: true,
      })),
      archiveCategory && archive.length > 0 && { id: 'archive', label: 'Archive', href: catLink(path, archiveCategory.name), wide: true },
      hasAbout && { id: 'sobre', label: 'Sobre FLOW', href: path('/sobre-flow'), wide: true },
    ].filter(Boolean);

    return {
      ready: catalog.isSuccess && categoriesQ.isSuccess,
      items,
      sections,
      collection,
      shopCategories: shopLinks,
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
