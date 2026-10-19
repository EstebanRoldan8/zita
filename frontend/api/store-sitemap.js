// /sitemap.xml (vercel.json) → sitemap de la tienda del host. Las URLs salen de los mismos helpers
// que usa la SPA (src/store/lib/seo.js), así coinciden con los canonical de cada página.
import { config, sitemapStore, canonicalOrigin, storeApi, send, CACHE } from './_lib/store.js';
import {
  storeUrl, listingSeo, helpSeo, aboutSeo, policySeo,
} from '../src/store/lib/seo.js';
import {
  getActiveCollection, productsInCollection, productsInDrop, productsInSection, productTypes,
} from '../src/store/lib/collections.js';
import { flowContent } from '../src/store/content/flowContent.js';
import { POLICIES } from '../src/store/lib/policies.js';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function renderSitemap(urls) {
  const body = [...new Set(urls.filter(Boolean))].map((u) => `  <url><loc>${xml(u)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}${body ? '\n' : ''}</urlset>\n`;
}

export async function sitemapUrls(req, cfg = config()) {
  const target = sitemapStore(req, cfg);
  if (!target) return [];
  const ctx = { origin: canonicalOrigin(req, cfg), base: target.base };
  const [store, products] = await Promise.all([
    storeApi.store(target.slug, cfg),
    storeApi.catalog(target.slug, cfg),
  ]);

  const collection = getActiveCollection();
  const inCollection = productsInCollection(products, collection);
  const drops = (collection?.drops || []).filter((d) => productsInDrop(inCollection, d).length > 0);
  const help = helpSeo(ctx, { store });
  const about = aboutSeo(ctx);

  return [
    storeUrl(ctx, '/'),
    storeUrl(ctx, '/coleccion'),
    collection && storeUrl(ctx, `/coleccion/${collection.slug}`),
    // Secciones del menú con productos (Mujer, Hombre)
    ...(flowContent.sections || []).filter((sec) => productsInSection(products, sec).length > 0)
      .map((sec) => storeUrl(ctx, `/coleccion/${sec.slug}`)),
    drops.length > 0 && storeUrl(ctx, '/colores'),
    ...drops.map((d) => storeUrl(ctx, `/colores/${d.slug}`)),
    // Tipos de prenda con productos (mismo helper que el listado y el menú; incluye Flow Archive)
    ...productTypes(products)
      .map((t) => listingSeo(ctx, { search: `?categoria=${encodeURIComponent(t.name)}` }).canonical),
    !help.noindex && help.canonical,
    !about.noindex && about.canonical,
    ...Object.keys(POLICIES).map((kind) => policySeo(ctx, { kind, store })).filter((s) => !s.noindex).map((s) => s.canonical),
    ...products.map((p) => storeUrl(ctx, `/producto/${encodeURIComponent(p.id)}`)),
  ];
  // Sin lastmod: la API pública no expone la fecha de los productos
}

export default async function handler(req, res) {
  try {
    const urls = await sitemapUrls(req);
    send(res, 200, 'application/xml; charset=utf-8', renderSitemap(urls), CACHE.sitemap);
  } catch {
    // API caída: 503 sin caché para que el buscador reintente y no guarde un sitemap vacío
    res.setHeader('Retry-After', '600');
    send(res, 503, 'text/plain; charset=utf-8', 'Sitemap temporalmente no disponible.', CACHE.none);
  }
}
