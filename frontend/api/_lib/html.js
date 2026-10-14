// HTML del prerender: escape, <head> SEO y carga del index.html de la build.
// Todo texto dinámico pasa por esc() (contenido y atributos) o por jsonLd() (dentro de <script>).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SITE_NAME, LOCALE, THEME_COLOR, DEFAULT_IMAGE, DEFAULT_IMAGE_SIZE, absoluteUrl } from '../../src/store/lib/seo.js';
import { requestOrigin, TIMEOUT_MS } from './store.js';

export function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Texto con saltos de línea → párrafos/líneas escapados
export const escLines = (text) => esc(text).replace(/\r?\n/g, '<br>');

// JSON seguro dentro de <script>: sin "<", ">" ni "&" literales (no puede cerrar la etiqueta)
export function jsonLd(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const meta = (attr, name, content) => (content === null || content === undefined || content === ''
  ? '' : `<meta ${attr}="${esc(name)}" content="${esc(content)}">`);

// Mismas etiquetas que pone useSeo en la SPA
export function headTags(seo, { origin, url }) {
  const image = absoluteUrl(origin, seo.image || DEFAULT_IMAGE);
  const tags = [
    `<title>${esc(seo.title)}</title>`,
    meta('name', 'description', seo.description),
    meta('name', 'robots', seo.noindex ? 'noindex,nofollow' : 'index,follow'),
    meta('name', 'theme-color', THEME_COLOR),
    seo.canonical ? `<link rel="canonical" href="${esc(seo.canonical)}">` : '',
    meta('property', 'og:title', seo.title),
    meta('property', 'og:description', seo.description),
    meta('property', 'og:type', seo.type || 'website'),
    meta('property', 'og:site_name', SITE_NAME),
    meta('property', 'og:locale', LOCALE),
    meta('property', 'og:url', seo.canonical || url),
    meta('property', 'og:image', image),
    meta('property', 'og:image:alt', seo.imageAlt || seo.title),
    seo.image ? '' : meta('property', 'og:image:width', DEFAULT_IMAGE_SIZE.width),
    seo.image ? '' : meta('property', 'og:image:height', DEFAULT_IMAGE_SIZE.height),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', seo.title),
    meta('name', 'twitter:description', seo.description),
    meta('name', 'twitter:image', image),
    ...(seo.meta || []).map(([attr, name, content]) => meta(attr, name, content)),
  ];
  const ld = Array.isArray(seo.jsonLd) ? seo.jsonLd : [];
  if (ld.length) tags.push(`<script type="application/ld+json">${jsonLd(ld.length === 1 ? ld[0] : ld)}</script>`);
  return tags.filter(Boolean).join('\n    ');
}

// Quita del index.html base lo que el prerender reemplaza (título y metas de ZITA)
const STRIP = [
  /<title>[\s\S]*?<\/title>\s*/gi,
  /<meta\s+name=["'](?:description|robots|theme-color|twitter:[^"']*)["'][^>]*>\s*/gi,
  /<meta\s+property=["'](?:og:[^"']*|product:[^"']*)["'][^>]*>\s*/gi,
  /<link\s+rel=["']canonical["'][^>]*>\s*/gi,
  /<script\s+type=["']application\/ld\+json["'][\s\S]*?<\/script>\s*/gi,
];

export function compose(baseHtml, head, content) {
  let html = baseHtml;
  for (const re of STRIP) html = html.replace(re, '');
  html = html.replace(/<\/head>/i, `    ${head}\n  </head>`);
  // React (createRoot) reemplaza este contenido al montar la SPA
  const root = /<div id="root">\s*<\/div>/i;
  return root.test(html) ? html.replace(root, () => `<div id="root">${content}</div>`) : html;
}

// index.html de la build (el mismo que recibe una persona). Se lee del bundle de la función
// (vercel.json → includeFiles) y, si no está, se pide al propio sitio. Queda en memoria.
const MINIMAL = '<!doctype html>\n<html lang="es">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  </head>\n  <body>\n    <div id="root"></div>\n  </body>\n</html>\n';
let cached = null;

export async function loadBaseHtml(req) {
  if (cached) return cached;
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const file of [path.join(here, '..', '..', 'dist', 'index.html'), path.join(globalThis.process?.cwd?.() || '.', 'dist', 'index.html')]) {
    try {
      const html = await readFile(file, 'utf8');
      if (html.includes('id="root"')) { cached = html; return html; }
    } catch { /* siguiente opción */ }
  }
  try {
    const r = await fetch(`${requestOrigin(req)}/index.html`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const html = r.ok ? await r.text() : '';
    if (html.includes('id="root"')) { cached = html; return html; }
  } catch { /* sin red: HTML mínimo */ }
  return MINIMAL;
}
