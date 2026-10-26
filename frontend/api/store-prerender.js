// HTML para bots y previews (vercel.json solo enruta aquí user-agents de buscadores y redes).
// Devuelve el mismo index.html de la build con el <head> SEO y, dentro de #root, el contenido
// equivalente al que ve una persona (React lo reemplaza al montar). Los textos y datos salen de
// la API pública y de los mismos helpers de la SPA. Si la API falla: HTML base con <head> de marca.
import {
  config, queryOf, resolveStorePath, seoContext, requestOrigin, storeApi, send, CACHE,
} from './_lib/store.js';
import { esc, escLines, headTags, compose, loadBaseHtml } from './_lib/html.js';
import {
  routeOf, homeSeo, listingSeo, collectionSeo, sectionSeo, colorsSeo, dropSeo, productSeo, helpSeo, aboutSeo, sizeGuideSeo,
  aboutText, policySeo, formsSeo, formSeo, privateSeo, notFoundSeo, brandDescription, productColor, productImages,
  productSoldOut, productDescription,
} from '../src/store/lib/seo.js';
import {
  getActiveCollection, getCollection, getSection, productsInCollection, productsInDrop, productsInCapsule,
  productsInSection, sectionForCategory, productType, typePath,
  sortByHierarchy, filterProducts, firstImage,
} from '../src/store/lib/collections.js';
import { faqItems, sizeGuide, policyLinks, FORMS, FORMS_TITLE } from '../src/store/lib/policies.js';
import { legalTokens, legalEffective, formOptions } from '../src/store/lib/legal.js';
import { whatsappNumber, instagramUrl } from '../src/store/lib/contact.js';
import { LEGAL_DOCS, LEGAL_FORMS } from '../src/store/content/flowLegal.js';
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
    + (productType(p) ? ` / <a href="${esc(link(base, typePath(productType(p))))}">${esc(productType(p))}</a>` : '')
    + `</nav>`
    + images.map((src, i) => `<img src="${esc(src)}" alt="${esc(`${alt}, foto ${i + 1} de ${images.length}`)}" width="800" height="1000"${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'}>`).join('')
    + `<h1>${esc(name)}</h1><p>${esc(formatCOP(p.price))}</p>`
    + (soldOut ? `<p>${esc(COPY.soldOut)}</p>` : p.low_stock ? `<p>${esc(COPY.lowStock)}</p>` : '')
    + (colors.length ? `<p>Colores: ${esc(colors.join(', '))}</p>` : '')
    + (sizes.length ? `<p>Tallas: ${esc(sizes.join(', '))}</p>` : '')
    + (text ? paragraphs(text) : '')
    // Set: qué incluye (igual que el bloque "Incluye" de la página)
    + (Array.isArray(p.bundle?.components) && p.bundle.components.length
      ? `<h2>Incluye</h2><ul>${p.bundle.components.map((c) => `<li>${Number(c.quantity) > 1 ? `${esc(c.quantity)} × ` : ''}${esc(c.name)}</li>`).join('')}</ul>`
      : '')
    + (specs.length ? `<dl>${specs.map((s) => `<dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd>`).join('')}</dl>` : '')
    + `</main>`;
}

// /guia-de-tallas: una tabla por tipo de prenda y la nota
function sizeGuideContent() {
  const guide = sizeGuide();
  return `<main><h1>${esc(guide.title)}</h1>`
    + (guide.intro ? `<p>${esc(guide.intro)}</p>` : '')
    + guide.tables.map((t) => `<section><h2>${esc(t.title)}</h2><table><thead><tr>${t.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>`
      + `<tbody>${t.rows.map((r) => `<tr>${(Array.isArray(r) ? r : []).map((c, j) => (j === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table></section>`).join('')
    + (guide.note ? `<p>${esc(guide.note)}</p>` : '')
    + `</main>`;
}

function helpContent(base, store) {
  const faq = faqItems();
  const guide = sizeGuide();
  const wa = waLink(whatsappNumber(store), 'Hola FLOW, necesito ayuda con mi pedido.');
  const ig = instagramUrl(store);
  const { email, city } = flowContent.brand;
  const links = [...policyLinks(), guide && { label: guide.title, href: '/guia-de-tallas' }].filter(Boolean);
  return `<main><h1>Ayuda</h1>`
    + (faq.length ? `<section><h2>Preguntas frecuentes</h2>${faq.map((f) => `<h3>${esc(f.q)}</h3><p>${escLines(f.a)}</p>`).join('')}`
      + `<p><a href="${esc(link(base, '/preguntas-frecuentes'))}">Ver todas las preguntas frecuentes</a></p></section>` : '')
    + `<section><h2>Pedidos y políticas</h2><ul>${links.map((l) => `<li><a href="${esc(link(base, l.href))}">${esc(l.label)}</a></li>`).join('')}</ul></section>`
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

// Texto legal con marcas → HTML (mismas piezas que components/LegalText)
function legalInline(base, store, text) {
  const render = (tokens) => tokens.map((t) => {
    if (t.type === 'bold') return `<strong>${render(t.children)}</strong>`;
    if (t.type === 'link') return `<a href="${esc(link(base, t.href))}">${esc(t.text)}</a>`;
    if (t.type === 'a') return `<a href="${esc(t.href)}"${t.external ? ' rel="noopener noreferrer"' : ''}>${esc(t.text)}</a>`;
    return esc(t.text);
  }).join('');
  return render(legalTokens(text, store));
}

function legalBlocks(base, store, blocks) {
  const inline = (t) => legalInline(base, store, t);
  return (blocks || []).map((b) => {
    if (b.t === 'p') return `<p>${inline(b.text)}</p>`;
    if (b.t === 'h3') return `<h3>${esc(b.text)}</h3>`;
    if (b.t === 'ul') return `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
    if (b.t === 'table') {
      return `<table><thead><tr>${b.head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>`
        + `<tbody>${b.rows.map((r) => `<tr>${r.map((c, j) => (j === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table>`;
    }
    if (b.t === 'sign') return `<p>${b.lines.map(esc).join('<br>')}</p>`;
    return '';
  }).join('');
}

// /terminos, /privacidad, /cambios, /envios, /preguntas-frecuentes, /promociones
function policyContent(base, store, doc) {
  const effective = legalEffective(doc);
  return `<main><article><h1>${esc(doc.title)}</h1>`
    + (effective ? `<p>${legalInline(base, store, effective)}</p>` : '')
    + (doc.sections.length > 1 ? `<nav aria-label="Índice"><ol>${doc.sections.map((s) => `<li><a href="#${esc(s.id)}">${esc(s.title)}</a></li>`).join('')}</ol></nav>` : '')
    + legalBlocks(base, store, doc.intro)
    + doc.sections.map((s) => `<section id="${esc(s.id)}"><h2>${esc(s.title)}</h2>${legalBlocks(base, store, s.blocks)}</section>`).join('')
    + legalBlocks(base, store, doc.outro)
    + `</article></main>`;
}

// /formatos y /formatos/:kind (sin las partes de uso interno, igual que la SPA)
function formsContent(base) {
  return `<main><h1>${esc(FORMS_TITLE)}</h1><ul>${Object.entries(FORMS)
    .map(([k, f]) => `<li><a href="${esc(link(base, `/formatos/${k}`))}">${esc(f.title)}</a></li>`).join('')}</ul></main>`;
}

function formContent(form) {
  const value = (f) => (formOptions(f.value) || []).map((o) => `☐ ${esc(o.label)}`).join(' ');
  return `<main><h1>${esc(form.title)}</h1><p><strong>${esc(form.heading)}</strong></p><p>${esc(form.basis)}</p>`
    + `<table><thead><tr>${form.fieldsHead.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>`
    + form.fields.map((f) => `<tr><th scope="row">${esc(f.label)}</th><td>${value(f)}</td></tr>`).join('')
    + `</tbody></table>${form.statement.map((p) => `<p>${esc(p)}</p>`).join('')}`
    + `<p>${form.signature.map(esc).join('<br>')}</p></main>`;
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
      // ?categoria=Hombre: la SPA redirige a su sección; aquí se muestra ese mismo contenido (noindex)
      const section = sectionForCategory(params.get('categoria'));
      if (section) return { status: 200, seo, content: simple(section.label, productList(base, productsInSection(all, section))) };
      const archiveText = seo.category && seo.h1 === flowContent.archive.title ? `<p>${esc(flowContent.archive.text)}</p>` : '';
      return { status: 200, seo, content: simple(seo.h1, archiveText + productList(base, listingContent(base, all, params, null))) };
    }
    case 'collection': {
      const collection = getCollection(route.slug);
      const section = collection ? null : getSection(route.slug);
      if (section) {
        const all = await storeApi.catalog(slug, cfg);
        return { status: 200, seo: sectionSeo(ctx, { section, search }), content: simple(section.label, productList(base, listingContent(base, productsInSection(all, section), params, null))) };
      }
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
      return { status: 200, seo: dropSeo(ctx, { drop, count: items.length }), content: simple(drop.name, (drop.description ? `<p>${esc(drop.description)}</p>` : '') + productList(base, items)) };
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
    case 'help': return { status: 200, seo: helpSeo(ctx, { store }), content: helpContent(base, store) };
    case 'sizeGuide': return sizeGuide() ? { status: 200, seo: sizeGuideSeo(ctx), content: sizeGuideContent() } : notFoundPage(base);
    case 'about': {
      const seo = aboutSeo(ctx);
      return seo.notFound ? notFoundPage(base) : { status: 200, seo, content: aboutContent() };
    }
    case 'policy': {
      const doc = LEGAL_DOCS[route.policy];
      if (!doc) return notFoundPage(base);
      return { status: 200, seo: policySeo(ctx, { kind: route.policy, doc, store }), content: policyContent(base, store, doc) };
    }
    case 'forms': return { status: 200, seo: formsSeo(ctx), content: formsContent(base) };
    case 'form': {
      const form = FORMS[route.form] ? LEGAL_FORMS[route.form] : null;
      return form ? { status: 200, seo: formSeo(ctx, { kind: route.form, form }), content: formContent(form) } : notFoundPage(base);
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
  // Canonical y og:url: en el dominio propio (sin prefijo) aunque la página se pida desde otro host;
  // los enlaces internos del HTML siguen usando target.base (funcionan en el host de la petición)
  const ctx = seoContext(req, target, cfg);
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
