// HTML para bots y previews (vercel.json solo enruta aquí user-agents de buscadores y redes).
// Devuelve el mismo index.html de la build con el <head> SEO y, dentro de #root, el contenido
// equivalente al que ve una persona (React lo reemplaza al montar). Los textos y datos salen de
// la API pública y de los mismos helpers de la SPA. Si la API falla: HTML base con <head> de marca.
import {
  config, queryOf, resolveStorePath, canonicalOrigin, requestOrigin, storeApi, send, CACHE,
} from './_lib/store.js';
import { esc, escLines, headTags, compose, loadBaseHtml } from './_lib/html.js';
import {
  routeOf, homeSeo, listingSeo, collectionSeo, colorsSeo, dropSeo, productSeo, helpSeo, aboutSeo,
  aboutText, policySeo, privateSeo, notFoundSeo, brandDescription, productColor, productImages,
  productSoldOut, productDescription,
} from '../src/store/lib/seo.js';
import {
  getActiveCollection, getCollection, productsInCollection, productsInDrop, productsInCapsule,
  sortByHierarchy, filterProducts, firstImage,
} from '../src/store/lib/collections.js';
import { policyText, faqItems, sizeGuide } from '../src/store/lib/policies.js';
import { parseSpecs } from '../src/store/lib/specs.js';
import { formatCOP, waLink } from '../src/store/lib/format.js';
import { COPY } from '../src/store/lib/copy.js';
import { flowContent } from '../src/store/content/flowContent.js';

const HTML = 'text/html; charset=utf-8';
const MAX_LIST = 48;

// ── Bloques de contenido (mismo texto visible que la SPA) ────────────────────
const link = (base, p) => `${base}${p === '/' ? '' : p}` || '/';
const paragraphs = (text) => String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  .map((p) => `<p>${escLines(p)}</p>`).join('');

function productList(base, items, title) {
  if (!items.length) return '';
  const lis = items.slice(0, MAX_LIST).map((p) => {
    const img = firstImage(p);
    return `<li><a href="${esc(link(base, `/producto/${encodeURIComponent(p.id)}`))}">`
      + (img ? `<img src="${esc(img)}" alt="${esc(p.name)}" width="400" height="500" loading="lazy">` : '')
      + `<span>${esc(p.name)}</span></a> <span>${esc(formatCOP(p.price))}</span>`
      + (p.in_stock === false ? ` <span>${esc(COPY.soldOut)}</span>` : '')
      + '</li>';
  }).join('');
  return `<section>${title ? `<h2>${esc(title)}</h2>` : ''}<ul>${lis}</ul></section>`;
}

function dropLinks(base, drops) {
  if (!drops.length) return '';
  return `<ul>${drops.map((d) => `<li><a href="${esc(link(base, `/colores/${d.slug}`))}">${esc(d.name)}</a>${d.tagline ? ` <span>${esc(d.tagline)}</span>` : ''}</li>`).join('')}</ul>`;
}

const visibleDrops = (collection, inCollection) => (collection?.drops || []).filter((d) => productsInDrop(inCollection, d).length > 0);

function homeContent(base, all) {
  const collection = getActiveCollection();
  const hero = collection?.hero || {};
  const inCollection = sortByHierarchy(productsInCollection(all, collection), collection);
  const drops = visibleDrops(collection, inCollection);
  return `<main>`
    + `<section>${collection?.eyebrow ? `<p>${esc(collection.eyebrow)}</p>` : ''}<h1>${esc(hero.title || flowContent.brand.name)}</h1>`
    + (hero.subtitle ? `<p>${esc(hero.subtitle)}</p>` : '')
    + (collection && hero.cta1 ? `<p><a href="${esc(link(base, `/coleccion/${collection.slug}`))}">${esc(hero.cta1)}</a></p>` : '')
    + (hero.cta2 ? `<p><a href="${esc(link(base, '/colores'))}">${esc(hero.cta2)}</a></p>` : '')
    + `<p>${esc(flowContent.brand.slogan)}</p></section>`
    + productList(base, inCollection, collection?.label)
    + (drops.length ? `<section><h2>Comprar por color</h2>${dropLinks(base, drops)}</section>` : '')
    + `</main>`;
}

function listingContent(base, all, params, collection) {
  const capsule = collection && params.get('capsula') ? (collection.capsules || []).find((c) => c.slug === params.get('capsula')) : null;
  const source = collection ? productsInCollection(all, collection) : all;
  const afterCapsule = capsule ? productsInCapsule(source, collection, capsule) : source;
  return filterProducts(afterCapsule, {
    category: params.get('categoria') || '', color: params.get('color') || '', size: params.get('talla') || '',
    q: params.get('q') || '', sort: params.get('orden') || (collection ? 'sugerido' : 'nuevo'), collection,
  });
}

function productContent(base, p, colorParam) {
  const color = productColor(p, colorParam);
  const images = productImages(p, color?.key);
  const name = String(p.name || '');
  const alt = color ? `${name} en color ${color.name}` : name;
  const { specs } = parseSpecs(p.description);
  const text = productDescription(p);
  const colors = (Array.isArray(p.colors) ? p.colors : []).filter((c) => c && c.key).map((c) => String(c.name ?? c.key));
  const sizes = (Array.isArray(p.sizes_available) ? p.sizes_available : []).map(String);
  const soldOut = productSoldOut(p);
  return `<main>`
    + `<nav aria-label="Ruta"><a href="${esc(link(base, '/coleccion'))}">Tienda</a>`
    + (p.category ? ` / <a href="${esc(`${link(base, '/coleccion')}?categoria=${encodeURIComponent(p.category)}`)}">${esc(p.category)}</a>` : '')
    + `</nav>`
    + images.map((src, i) => `<img src="${esc(src)}" alt="${esc(`${alt}, foto ${i + 1} de ${images.length}`)}" width="800" height="1000"${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'}>`).join('')
    + `<h1>${esc(name)}</h1><p>${esc(formatCOP(p.price))}</p>`
    + (soldOut ? `<p>${esc(COPY.soldOut)}</p>` : p.low_stock ? `<p>${esc(COPY.lowStock)}</p>` : '')
    + (colors.length ? `<p>Colores: ${esc(colors.join(', '))}</p>` : '')
    + (sizes.length ? `<p>Tallas: ${esc(sizes.join(', '))}</p>` : '')
    + (text ? paragraphs(text) : '')
    + (specs.length ? `<dl>${specs.map((s) => `<dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd>`).join('')}</dl>` : '')
    + `</main>`;
}

function helpContent(store) {
  const faq = faqItems();
  const envios = policyText('envios', store);
  const cambios = policyText('cambios', store);
  const guide = sizeGuide();
  const wa = waLink(store?.whatsapp_number, 'Hola FLOW, necesito ayuda con mi pedido.');
  const ig = store?.social?.instagram || flowContent.brand.instagram;
  const { email, city } = flowContent.brand;
  return `<main><h1>Ayuda</h1>`
    + (faq.length ? `<section><h2>Preguntas frecuentes</h2>${faq.map((f) => `<h3>${esc(f.q)}</h3><p>${escLines(f.a)}</p>`).join('')}</section>` : '')
    + ((envios || cambios || guide) ? `<section><h2>Pedidos</h2>`
      + (envios ? `<h3>Envíos</h3><p>${escLines(envios)}</p>` : '')
      + (cambios ? `<h3>Cambios y devoluciones</h3><p>${escLines(cambios)}</p>` : '')
      + (guide ? `<h3>${esc(guide.title || 'Guía de tallas')}</h3><table><thead><tr>${guide.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${guide.rows.map((r) => `<tr>${(Array.isArray(r) ? r : []).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '')
      + `</section>` : '')
    + ((wa || ig || email || city) ? `<section><h2>Contacto</h2><ul>`
      + (city ? `<li>${esc(city)}</li>` : '')
      + (email ? `<li><a href="mailto:${esc(email)}">${esc(email)}</a></li>` : '')
      + (ig ? `<li><a href="${esc(ig)}">Instagram</a></li>` : '')
      + (wa ? `<li><a href="${esc(wa)}">Escríbenos por WhatsApp</a></li>` : '')
      + `</ul></section>` : '')
    + `</main>`;
}

function aboutContent() {
  const collection = getActiveCollection();
  const story = (collection?.storytelling || []).flatMap((b) => [...(b.lines || []), ...(b.list || [])]);
  return `<main><p>Sobre FLOW</p><h1>${esc(flowContent.brand.name)}</h1><p>${esc(flowContent.brand.slogan)}</p>`
    + paragraphs(aboutText())
    + (story.length ? `<section>${story.map((l) => `<p>${esc(l)}</p>`).join('')}</section>` : '')
    + `</main>`;
}

const simple = (h1, html = '') => `<main><h1>${esc(h1)}</h1>${html}</main>`;
const notFoundPage = (base) => ({
  status: 404,
  seo: notFoundSeo(),
  content: simple('Esta página no existe', `<p><a href="${esc(link(base, '/'))}">Volver al inicio</a></p>`),
});

// ── Página → { status, seo, content } ───────────────────────────────────────
async function renderPage(target, ctx, params, cfg) {
  const { slug, base } = target;
  const route = routeOf(target.rest);
  const store = await storeApi.store(slug, cfg); // 404 → tienda no encontrada (lo maneja el handler)
  const search = params.toString() ? `?${params}` : '';

  switch (route.kind) {
    case 'home': {
      const all = await storeApi.catalog(slug, cfg);
      return { status: 200, seo: homeSeo(ctx, { store }), content: homeContent(base, all) };
    }
    case 'listing': {
      const all = await storeApi.catalog(slug, cfg);
      const seo = listingSeo(ctx, { search });
      const archiveText = seo.category && seo.h1 === flowContent.archive.title ? `<p>${esc(flowContent.archive.text)}</p>` : '';
      return { status: 200, seo, content: simple(seo.h1, archiveText + productList(base, listingContent(base, all, params, null))) };
    }
    case 'collection': {
      const collection = getCollection(route.slug);
      if (!collection) return notFoundPage(base);
      const all = await storeApi.catalog(slug, cfg);
      const intro = [collection.intro, collection.hero?.subtitle].filter(Boolean).map((t) => `<p>${esc(t)}</p>`).join('');
      return { status: 200, seo: collectionSeo(ctx, { collection, search }), content: simple(collection.name, intro + productList(base, listingContent(base, all, params, collection))) };
    }
    case 'colors': {
      const all = await storeApi.catalog(slug, cfg);
      const collection = getActiveCollection();
      const drops = visibleDrops(collection, productsInCollection(all, collection));
      return { status: 200, seo: colorsSeo(ctx, { drops }), content: simple('Comprar por color', (collection ? `<p>${esc(collection.label)}</p>` : '') + dropLinks(base, drops)) };
    }
    case 'drop': {
      const collection = getActiveCollection();
      const drop = (collection?.drops || []).find((d) => d.slug === route.slug);
      if (!drop) return notFoundPage(base);
      const all = await storeApi.catalog(slug, cfg);
      const items = productsInDrop(productsInCollection(all, collection), drop);
      return { status: 200, seo: dropSeo(ctx, { drop }), content: simple(drop.name, (drop.description ? `<p>${esc(drop.description)}</p>` : '') + productList(base, items)) };
    }
    case 'product': {
      let product;
      try {
        product = await storeApi.product(slug, route.id, cfg);
      } catch (err) {
        if (err?.status === 404) return notFoundPage(base);
        throw err;
      }
      const seo = productSeo(ctx, { product, store, colorParam: params.get('color') });
      if (seo.notFound) return notFoundPage(base);
      return { status: 200, seo, content: productContent(base, product, params.get('color')) };
    }
    case 'help': return { status: 200, seo: helpSeo(ctx, { store }), content: helpContent(store) };
    case 'about': {
      const seo = aboutSeo(ctx);
      return seo.notFound ? notFoundPage(base) : { status: 200, seo, content: aboutContent() };
    }
    case 'policy': {
      const seo = policySeo(ctx, { kind: route.policy, store });
      const text = policyText(route.policy, store);
      return { status: 200, seo, content: simple(seo.h1, text ? `<p>${escLines(text)}</p>` : '<p>Esta información aún no está publicada.</p>') };
    }
    case 'private': return { status: 200, seo: privateSeo(route.title), content: '' };
    default: return notFoundPage(base);
  }
}

// Parámetros originales de la URL (sin "path", que agrega el rewrite)
function originalParams(query) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) {
    if (k === 'path') continue;
    for (const value of Array.isArray(v) ? v : [v]) if (value !== undefined) params.append(k, String(value));
  }
  return params;
}

export default async function handler(req, res) {
  const cfg = config();
  const query = queryOf(req);
  const rawPath = String(Array.isArray(query.path) ? query.path[0] : query.path || '/');
  const baseHtml = await loadBaseHtml(req);
  const target = resolveStorePath(req, rawPath, cfg);
  // No es una ruta de la tienda (p. ej. el panel en el dominio de ZITA): el HTML de siempre
  if (!target) return send(res, 200, HTML, baseHtml, CACHE.page);

  const params = originalParams(query);
  const ctx = { origin: canonicalOrigin(req, cfg), base: target.base };
  const url = `${requestOrigin(req)}${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}`;
  try {
    const page = await renderPage(target, ctx, params, cfg);
    return send(res, page.status, HTML, compose(baseHtml, headTags(page.seo, { origin: ctx.origin, url }), page.content), CACHE.page);
  } catch (err) {
    if (err?.status === 404) {
      // Tienda no encontrada o inactiva
      return send(res, 404, HTML, compose(baseHtml, headTags(notFoundSeo(), { origin: ctx.origin, url }), ''), CACHE.page);
    }
    // API caída o lenta: HTML base de la SPA con el <head> de marca (nunca un error a un bot)
    const fallback = { ...homeSeo(ctx, {}), description: brandDescription(), canonical: null, jsonLd: [] };
    return send(res, 200, HTML, compose(baseHtml, headTags(fallback, { origin: ctx.origin, url }), ''), CACHE.fallback);
  }
}
