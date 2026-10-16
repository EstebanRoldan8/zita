// /robots.txt (vercel.json). Reemplaza a public/robots.txt, que tenía prioridad sobre cualquier rewrite.
// - Dominio propio de la tienda (VITE_STORE_HOST): reglas de la tienda en la raíz.
// - Cualquier otro host (ZITA): las reglas que ya tenía ZITA, igual que antes, más las de /tienda/*.
import { config, isStoreHost, requestOrigin, servesCanonical, sitemapStore, send, CACHE } from './_lib/store.js';

// Mismas reglas que public/robots.txt de ZITA + /onboarding (ruta protegida del panel)
const ZITA_RULES = [
  'Allow: /login',
  'Allow: /register',
  'Allow: /privacidad',
  'Allow: /terminos',
  'Disallow: /dashboard',
  'Disallow: /admin',
  'Disallow: /onboarding',
];

// Bolsa, checkout y pedidos nunca; listados con parámetros tampoco, salvo la categoría (es una página)
const storeRules = (base) => [
  `Disallow: ${base}/checkout`,
  `Disallow: ${base}/bolsa`,
  `Disallow: ${base}/pedido`,
  `Allow: ${base}/coleccion?categoria=`,
  `Disallow: ${base || ''}/*?*`,
];

export function renderRobots(req, cfg = config()) {
  const storeHost = isStoreHost(req, cfg);
  const lines = ['User-agent: *', 'Allow: /'];
  if (storeHost) lines.push(...storeRules(''));
  else lines.push(...ZITA_RULES, ...storeRules('/tienda/*'));
  if (servesCanonical(req, cfg) && sitemapStore(req, cfg)) lines.push('', `Sitemap: ${requestOrigin(req)}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

export default function handler(req, res) {
  send(res, 200, 'text/plain; charset=utf-8', renderRobots(req), CACHE.sitemap);
}
