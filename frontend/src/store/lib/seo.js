// SEO de la tienda: funciones puras que usan la SPA (hooks/useSeo) y las funciones de Vercel
// (frontend/api). Lo que reciben buscadores y previews sale de aquí mismo, por eso es equivalente
// a lo que ve una persona. Nada se inventa: sin dato, el campo no se incluye.
// Imports con extensión .js: este archivo también se carga en Node (funciones serverless).
import { flowContent } from '../content/flowContent.js';
import { getActiveCollection, isArchiveCategory, normalize } from './collections.js';
import { policyText, faqItems, sizeGuide, POLICIES } from './policies.js';
import { parseSpecs } from './specs.js';

export const SITE_NAME = flowContent.brand.name;
export const LOCALE = 'es_CO';
export const THEME_COLOR = '#1C1C1C';
// Imagen por defecto de los previews (logo sobre sand, 1200×630). Se genera con scripts/og-image.mjs
export const DEFAULT_IMAGE = '/og-flow.jpg';
export const DEFAULT_IMAGE_SIZE = { width: 1200, height: 630 };
export const LOGO_IMAGE = '/flow-logo.png';
// Parámetros de filtro de los listados: el canonical nunca los lleva
export const FILTER_PARAMS = ['capsula', 'color', 'talla', 'orden', 'q'];

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const SCHEMA = 'https://schema.org';

// Corta en el último espacio antes del límite y cierra con "…"
export function truncate(text, max = 155) {
  const t = clean(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const i = cut.lastIndexOf(' ');
  return `${(i > max * 0.6 ? cut.slice(0, i) : cut).replace(/[\s,.;:—–-]+$/, '')}…`;
}

// "Set Aria Negro | FLOW" con el total en ≤ 60 caracteres
export function withSite(main, max = 60) {
  const suffix = ` | ${SITE_NAME}`;
  const m = clean(main);
  return m ? `${truncate(m, max - suffix.length)}${suffix}` : SITE_NAME;
}

export function absoluteUrl(origin, value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('//')) return `https:${v}`;
  return `${String(origin || '').replace(/\/+$/, '')}${v.startsWith('/') ? '' : '/'}${v}`;
}

// Quita null, '', [] y {} (recursivo) para que el JSON-LD no lleve campos vacíos
export function compact(value) {
  if (Array.isArray(value)) {
    const out = value.map(compact).filter((v) => v !== undefined);
    return out.length ? out : undefined;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const c = compact(v);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
  return value;
}

// ctx = { origin: 'https://dominio', base: '' | '/tienda/flow' }
export const storeUrl = (ctx, path = '/') => absoluteUrl(ctx.origin, `${ctx.base || ''}${path === '/' ? '' : path}` || '/');
const categoryUrl = (ctx, category) => `${storeUrl(ctx, '/coleccion')}?categoria=${encodeURIComponent(category)}`;

// Descripción de marca: primera frase del último párrafo de "Sobre FLOW" + intro de la colección activa
function brandSentence() {
  const paras = String(flowContent.about || '').split(/\n\s*\n/).map(clean).filter(Boolean);
  return (paras[paras.length - 1] || '').split(/(?<=\.)\s/)[0] || '';
}

export function brandDescription() {
  const intro = getActiveCollection()?.intro;
  return truncate([brandSentence(), intro].filter(Boolean).join(' ') || flowContent.brand.slogan);
}

function socialLinks(store) {
  const ig = store?.social?.instagram || flowContent.brand.instagram;
  return [ig, store?.social?.tiktok].filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
}

function breadcrumbLd(items) {
  const list = items.filter((i) => i && clean(i.name));
  if (list.length < 2) return null;
  return {
    '@context': SCHEMA,
    '@type': 'BreadcrumbList',
    itemListElement: list.map((i, n) => compact({ '@type': 'ListItem', position: n + 1, name: clean(i.name), item: i.url })),
  };
}

function filtersOf(search) {
  const params = new URLSearchParams(search || '');
  const active = FILTER_PARAMS.filter((k) => clean(params.get(k)));
  return { params, active };
}

const finish = (seo) => ({
  type: 'website',
  noindex: false,
  image: null,
  imageAlt: null,
  meta: [],
  ...seo,
  jsonLd: (seo.jsonLd || []).map(compact).filter(Boolean),
});

// ── Páginas ──────────────────────────────────────────────────────────────────

export function homeSeo(ctx, { store } = {}) {
  const collection = getActiveCollection();
  const home = storeUrl(ctx, '/');
  return finish({
    title: flowContent.seo?.homeTitle || withSite(collection?.label || flowContent.brand.slogan),
    description: brandDescription(),
    canonical: home,
    h1: collection?.hero?.title || SITE_NAME,
    jsonLd: [
      {
        '@context': SCHEMA,
        '@type': 'Organization',
        name: SITE_NAME,
        url: home,
        logo: absoluteUrl(ctx.origin, LOGO_IMAGE),
        sameAs: socialLinks(store),
      },
      {
        '@context': SCHEMA,
        '@type': 'WebSite',
        name: SITE_NAME,
        url: home,
        inLanguage: 'es-CO',
        // El listado acepta ?q= (búsqueda con URL propia)
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${storeUrl(ctx, '/coleccion')}?q={search_term_string}` },
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  });
}

// /coleccion (tienda completa) y /coleccion?categoria=X (página de categoría)
export function listingSeo(ctx, { search } = {}) {
  const { params, active } = filtersOf(search);
  const category = clean(params.get('categoria'));
  const archive = category && isArchiveCategory(category);
  const name = archive ? flowContent.archive.title : category || 'Tienda';
  const canonical = category ? categoryUrl(ctx, category) : storeUrl(ctx, '/coleccion');
  const total = active.length + (category ? 1 : 0);
  return finish({
    title: withSite(name),
    description: archive ? truncate(flowContent.archive.text)
      : category ? truncate(`${category} de ${SITE_NAME}. ${brandSentence()}`) : brandDescription(),
    canonical,
    h1: name,
    category: category || null,
    noindex: active.includes('q') || total >= 2,
    jsonLd: category ? [breadcrumbLd([
      { name: 'Inicio', url: storeUrl(ctx, '/') },
      { name: 'Tienda', url: storeUrl(ctx, '/coleccion') },
      { name, url: canonical },
    ])] : [],
  });
}

// /coleccion/:collectionSlug
export function collectionSeo(ctx, { collection, search } = {}) {
  if (!collection) return notFoundSeo();
  const { active } = filtersOf(search);
  const canonical = storeUrl(ctx, `/coleccion/${collection.slug}`);
  return finish({
    title: withSite(collection.label || collection.name),
    description: truncate([collection.intro, collection.hero?.subtitle].filter(Boolean).join(' ') || brandDescription()),
    canonical,
    h1: collection.name,
    image: collection.hero?.image || null,
    noindex: active.includes('q') || active.length >= 2,
    jsonLd: [breadcrumbLd([
      { name: 'Inicio', url: storeUrl(ctx, '/') },
      { name: collection.label || collection.name, url: canonical },
    ])],
  });
}

// /colores: `drops` = los que se muestran (con productos)
export function colorsSeo(ctx, { drops = [] } = {}) {
  const collection = getActiveCollection();
  const names = drops.map((d) => d.name).filter(Boolean);
  return finish({
    title: withSite('Comprar por color'),
    description: truncate(names.length
      ? `Comprar por color en la ${collection?.label || SITE_NAME}: ${names.join(', ')}.`
      : `Comprar por color en la ${collection?.label || SITE_NAME}.`),
    canonical: storeUrl(ctx, '/colores'),
    h1: 'Comprar por color',
  });
}

// /colores/:dropSlug
export function dropSeo(ctx, { drop } = {}) {
  if (!drop) return notFoundSeo();
  const collection = getActiveCollection();
  const canonical = storeUrl(ctx, `/colores/${drop.slug}`);
  return finish({
    title: withSite(drop.name),
    description: truncate([drop.description, collection?.label ? `${collection.label}.` : ''].filter(Boolean).join(' ')),
    canonical,
    h1: drop.name,
    jsonLd: [breadcrumbLd([
      { name: 'Inicio', url: storeUrl(ctx, '/') },
      { name: 'Comprar por color', url: storeUrl(ctx, '/colores') },
      { name: drop.name, url: canonical },
    ])],
  });
}

// Color pedido en la URL (?color=) si el producto lo tiene
export function productColor(product, colorParam) {
  const want = normalize(colorParam);
  if (!want) return null;
  const colors = Array.isArray(product?.colors) ? product.colors : [];
  const c = colors.find((x) => x && x.key && (normalize(x.key) === want || normalize(x.name) === want));
  return c ? { key: c.key, name: clean(String(c.name ?? c.key)) } : null;
}

const urls = (v) => (Array.isArray(v) ? v : []).filter((u) => typeof u === 'string' && u.trim());

// Fotos en el mismo orden que la galería: las del color elegido y, si no hay, las generales
export function productImages(product, colorKey) {
  const byColor = colorKey && product?.images_by_color && typeof product.images_by_color === 'object'
    ? urls(product.images_by_color[colorKey]) : [];
  return [...new Set(byColor.length ? byColor : urls(product?.images))];
}

// Mismo criterio que la página de producto: con variantes, agotado si ninguna está disponible
export function productSoldOut(product) {
  const variants = (Array.isArray(product?.variants) ? product.variants : []).filter((v) => v && v.id);
  return variants.length ? !variants.some((v) => v.available) : !product?.in_stock;
}

export function productDescription(product) {
  const { rest } = parseSpecs(product?.description);
  return clean(rest) || clean(product?.description);
}

// /producto/:id[?color=]
export function productSeo(ctx, { product, store, colorParam } = {}) {
  if (!product || !product.id || !clean(product.name)) return notFoundSeo();
  const name = clean(product.name);
  const color = productColor(product, colorParam);
  const fullName = color ? `${name} ${color.name}` : name;
  const canonical = storeUrl(ctx, `/producto/${encodeURIComponent(product.id)}`);
  const images = productImages(product, color?.key).map((u) => absoluteUrl(ctx.origin, u)).filter(Boolean);
  const text = productDescription(product);
  const price = Number(product.price);
  const currency = clean(store?.currency) || 'COP';
  const soldOut = productSoldOut(product);
  const category = clean(product.category);
  return finish({
    title: withSite(fullName),
    description: truncate(text || `${fullName}. ${SITE_NAME}.`),
    canonical,
    type: 'product',
    h1: name,
    image: images[0] || null,
    imageAlt: color ? `${name} en color ${color.name}` : name,
    price: price > 0 ? price : null,
    currency,
    soldOut,
    colorName: color?.name || null,
    meta: price > 0 ? [
      ['property', 'product:price:amount', String(price)],
      ['property', 'product:price:currency', currency],
      ['property', 'product:availability', soldOut ? 'out of stock' : 'in stock'],
    ] : [],
    jsonLd: [
      {
        '@context': SCHEMA,
        '@type': 'Product',
        name: fullName,
        image: images.slice(0, 10),
        description: truncate(text, 5000),
        sku: String(product.id),
        category,
        color: color?.name,
        brand: { '@type': 'Brand', name: SITE_NAME },
        offers: price > 0 ? {
          '@type': 'Offer',
          price,
          priceCurrency: currency,
          availability: soldOut ? `${SCHEMA}/OutOfStock` : `${SCHEMA}/InStock`,
          itemCondition: `${SCHEMA}/NewCondition`,
          url: canonical,
        } : null,
      },
      breadcrumbLd([
        { name: 'Tienda', url: storeUrl(ctx, '/coleccion') },
        category ? { name: category, url: categoryUrl(ctx, category) } : null,
        { name, url: canonical },
      ]),
    ],
  });
}

// /ayuda: la descripción nombra solo los bloques que existen
export function helpSeo(ctx, { store } = {}) {
  const hasContact = !!(store?.whatsapp_number || store?.social?.instagram || flowContent.brand.instagram
    || flowContent.brand.email || flowContent.brand.city);
  const parts = [
    faqItems().length > 0 && 'preguntas frecuentes',
    policyText('envios', store) && 'envíos',
    policyText('cambios', store) && 'cambios y devoluciones',
    sizeGuide() && 'guía de tallas',
    hasContact && 'contacto',
  ].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0] || '';
  return finish({
    title: withSite('Ayuda'),
    description: list ? truncate(`${list.charAt(0).toUpperCase()}${list.slice(1)} de ${SITE_NAME}.`) : `Ayuda de ${SITE_NAME}.`,
    canonical: storeUrl(ctx, '/ayuda'),
    h1: 'Ayuda',
    noindex: parts.length === 0,
  });
}

export function aboutText() {
  return typeof flowContent.about === 'string' && flowContent.about.trim() ? flowContent.about.trim() : null;
}

// /sobre-flow
export function aboutSeo(ctx) {
  const about = aboutText();
  const collection = getActiveCollection();
  if (!about && !(collection?.storytelling || []).length) return notFoundSeo();
  const first = about ? about.split(/\n\s*\n/)[0] : '';
  return finish({
    title: withSite('Sobre FLOW'),
    description: truncate(first || collection?.intro || flowContent.brand.slogan),
    canonical: storeUrl(ctx, '/sobre-flow'),
    h1: SITE_NAME,
  });
}

// /envios, /cambios, /privacidad, /terminos (sin texto: noindex, la página avisa que no está publicada)
export function policySeo(ctx, { kind, store } = {}) {
  const title = POLICIES[kind]?.title || 'Información';
  const text = policyText(kind, store);
  return finish({
    title: withSite(title),
    description: truncate(text || `${title} de ${SITE_NAME}.`),
    canonical: storeUrl(ctx, `/${kind}`),
    h1: title,
    noindex: !text,
  });
}

// Bolsa, checkout, confirmación de pedido: nunca se indexan
export function privateSeo(title) {
  return finish({ title: withSite(title), description: brandDescription(), canonical: null, h1: title, noindex: true });
}

export function notFoundSeo() {
  return finish({ title: withSite('Página no encontrada'), description: brandDescription(), canonical: null, h1: 'Esta página no existe', noindex: true, notFound: true });
}

// Ruta interna de la tienda (sin el prefijo /tienda/:slug) → tipo de página. Lo usa el prerender.
export function routeOf(path) {
  const p = `/${String(path || '').split(/[?#]/)[0].split('/').filter(Boolean).join('/')}`;
  const seg = p.split('/').filter(Boolean);
  if (seg.length === 0) return { kind: 'home' };
  const [a, b, ...more] = seg;
  if (more.length) return { kind: 'notFound' };
  if (a === 'coleccion') return b ? { kind: 'collection', slug: decodeURIComponent(b) } : { kind: 'listing' };
  if (a === 'colores') return b ? { kind: 'drop', slug: decodeURIComponent(b) } : { kind: 'colors' };
  if (a === 'producto' && b) return { kind: 'product', id: decodeURIComponent(b) };
  if (b) return { kind: a === 'pedido' ? 'private' : 'notFound', title: 'Pedido recibido' };
  if (a === 'ayuda') return { kind: 'help' };
  if (a === 'sobre-flow' || a === 'nosotros') return { kind: 'about' };
  if (POLICIES[a]) return { kind: 'policy', policy: a };
  if (a === 'bolsa') return { kind: 'private', title: 'Tu bolsa' };
  if (a === 'checkout') return { kind: 'private', title: 'Finalizar pedido' };
  if (a === 'productos') return { kind: 'listing' };
  return { kind: 'notFound' };
}
