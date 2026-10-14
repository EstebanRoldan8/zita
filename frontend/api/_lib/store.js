// Helpers de las funciones serverless de la tienda (Vercel). Solo leen la API pública
// /api/store/:slug/... con variables de servidor; nunca llevan llaves ni secretos.
// Los archivos con "_" adelante no se publican como funciones.
const env = () => globalThis.process?.env || {};

export const TIMEOUT_MS = 3000;
const PAGE = 48; // máximo que acepta la API
const MAX_PAGES = 10; // mismo tope que la SPA (useCatalog)
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

export function config() {
  const e = env();
  return {
    apiUrl: String(e.STORE_API_URL || '').trim().replace(/\/+$/, ''),
    siteUrl: String(e.SITE_URL || '').trim().replace(/\/+$/, ''),
    slug: String(e.STORE_SLUG || e.VITE_STORE_HOST_SLUG || '').trim().toLowerCase(),
    // Dominio propio de la tienda: el mismo valor que usa la SPA para servir la tienda en la raíz
    storeHost: String(e.VITE_STORE_HOST || '').trim().toLowerCase(),
  };
}

const header = (req, name) => String(req?.headers?.[name] || '').split(',')[0].trim();

// host con puerto (para armar URLs) y sin puerto (para comparar)
export function requestHost(req) {
  return (header(req, 'x-forwarded-host') || header(req, 'host')).toLowerCase();
}
const bareHost = (h) => String(h || '').replace(/:\d+$/, '');

export function requestOrigin(req) {
  const proto = header(req, 'x-forwarded-proto') || (/^(localhost|127\.)/.test(requestHost(req)) ? 'http' : 'https');
  return `${proto}://${requestHost(req)}`;
}

export function isStoreHost(req, cfg = config()) {
  return !!cfg.storeHost && bareHost(requestHost(req)) === bareHost(cfg.storeHost);
}

// Origen canónico: SITE_URL si está definido; si no, el host de la petición
export function canonicalOrigin(req, cfg = config()) {
  return cfg.siteUrl || requestOrigin(req);
}

// ¿Este host es el dominio canónico? El sitemap y el robots solo listan URLs del propio host.
export function servesCanonical(req, cfg = config()) {
  if (!cfg.siteUrl) return true;
  try { return bareHost(new URL(cfg.siteUrl).host) === bareHost(requestHost(req)); } catch { return false; }
}

export function queryOf(req) {
  if (req?.query && typeof req.query === 'object') return req.query;
  try { return Object.fromEntries(new URL(req?.url || '/', 'http://x').searchParams); } catch { return {}; }
}

// Ruta original → { slug, base, rest }. null si no es una ruta de la tienda.
// Con prefijo: /tienda/:slug/... en cualquier host. Sin prefijo: solo en el dominio propio.
export function resolveStorePath(req, rawPath, cfg = config()) {
  const path = `/${String(rawPath || '/').split(/[?#]/)[0].split('/').filter(Boolean).join('/')}`;
  const m = path.match(/^\/tienda\/([^/]+)(\/.*)?$/);
  if (m) {
    let slug;
    try { slug = decodeURIComponent(m[1]).toLowerCase(); } catch { return null; }
    return SLUG_RE.test(slug) ? { slug, base: `/tienda/${slug}`, rest: m[2] || '/' } : null;
  }
  if (path === '/tienda') return null;
  if (isStoreHost(req, cfg) && SLUG_RE.test(cfg.slug)) return { slug: cfg.slug, base: '', rest: path };
  return null;
}

// Tienda cuyo catálogo va en el sitemap de este host
export function sitemapStore(req, cfg = config()) {
  if (!SLUG_RE.test(cfg.slug) || !servesCanonical(req, cfg)) return null;
  if (isStoreHost(req, cfg)) return { slug: cfg.slug, base: '' };
  // Con dominio propio configurado, el catálogo canónico vive allá, no en este host
  if (cfg.storeHost) return null;
  return { slug: cfg.slug, base: `/tienda/${cfg.slug}` };
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// GET a la API pública con timeout corto. 404 → ApiError(404); red/timeout/5xx → ApiError(0|5xx)
export async function apiGet(path, cfg = config()) {
  if (!cfg.apiUrl) throw new ApiError(0, 'STORE_API_URL no está definido');
  let res;
  try {
    res = await fetch(`${cfg.apiUrl}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new ApiError(0, err?.name === 'TimeoutError' ? 'timeout' : String(err?.message || err));
  }
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  const body = await res.json().catch(() => null);
  if (!body || body.success === false) throw new ApiError(502, 'respuesta inválida');
  return body.data;
}

const enc = encodeURIComponent;

export const storeApi = {
  store: (slug, cfg) => apiGet(`/api/store/${enc(slug)}`, cfg),
  product: (slug, id, cfg) => apiGet(`/api/store/${enc(slug)}/products/${enc(id)}`, cfg),
  categories: async (slug, cfg) => {
    const d = await apiGet(`/api/store/${enc(slug)}/categories`, cfg);
    return Array.isArray(d?.categories) ? d.categories : [];
  },
  // Catálogo completo, igual que useCatalog en la SPA
  catalog: async (slug, cfg) => {
    const all = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const d = await apiGet(`/api/store/${enc(slug)}/products?page=${page}&limit=${PAGE}`, cfg);
      const items = Array.isArray(d?.products) ? d.products.filter((p) => p && p.id) : [];
      all.push(...items);
      if (items.length < PAGE || all.length >= (Number(d?.total) || 0)) break;
    }
    return all;
  },
};

// Respuesta con el API estándar de Node (sirve en Vercel y en las pruebas locales)
export function send(res, status, type, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
}

export const CACHE = {
  sitemap: 'public, s-maxage=3600, stale-while-revalidate=86400',
  page: 'public, s-maxage=300, stale-while-revalidate=3600',
  fallback: 'public, s-maxage=60',
  none: 'no-store',
};
