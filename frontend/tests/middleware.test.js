// Routing Middleware (frontend/middleware.js) e identidad de FLOW en el <head> del prerender.
// Ejecutar desde frontend/:  npm run test:middleware   (no necesita red ni build)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import middleware, { shouldServeStoreHead, BOT_UA, STORE_HOST, config } from '../middleware.js';
import { headTags, compose } from '../api/_lib/html.js';

const WHATSAPP = 'WhatsApp/2.23.20.0';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const FACEBOOK = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const HUMAN = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

const mk = ({ host = STORE_HOST, path = '/', method = 'GET', ua = WHATSAPP, accept, extra = {} } = {}) => {
  const headers = new Headers({ host, 'user-agent': ua, ...extra });
  if (accept) headers.set('accept', accept);
  return new Request(`https://${host}${path}`, { method, headers });
};
const isRewrite = (res) => res.headers.get('x-middleware-rewrite');
const isNext = (res) => res.headers.get('x-middleware-next') === '1' && !res.headers.get('x-middleware-rewrite');

test('host de la tienda + bot/previsualizador + GET "/" → reescribe al prerender de la tienda', () => {
  for (const ua of [WHATSAPP, GOOGLEBOT, FACEBOOK]) {
    const res = middleware(mk({ ua }));
    assert.equal(isRewrite(res), `https://${STORE_HOST}/api/store-prerender?path=/`, ua);
  }
});

test('HEAD también y Accept de navegador/previsualizador (text/html, */*) o vacío', () => {
  assert.ok(isRewrite(middleware(mk({ method: 'HEAD' }))));
  assert.ok(isRewrite(middleware(mk({ accept: 'text/html,application/xhtml+xml' }))));
  assert.ok(isRewrite(middleware(mk({ accept: '*/*' }))));
});

test('host de la tienda con una persona (navegador) → no-op: pasa la petición', () => {
  assert.ok(isNext(middleware(mk({ ua: HUMAN }))));
  assert.ok(isNext(middleware(mk({ ua: '' }))));
});

test('cualquier otro host → no-op total, aunque sea un bot', () => {
  for (const host of ['zita-alpha.vercel.app', 'zita-git-feat-x-user.vercel.app', 'localhost', 'flowactivewear.co', 'www.flowactivewear.co.evil.com', 'evilwww.flowactivewear.co', 'app.zita.co']) {
    assert.ok(isNext(middleware(mk({ host, ua: GOOGLEBOT }))), host);
    assert.ok(isNext(middleware(mk({ host, ua: WHATSAPP }))), host);
  }
});

test('x-forwarded-host manda sobre host (así llega el dominio propio detrás de Vercel)', () => {
  assert.ok(isRewrite(middleware(mk({ host: 'zita-alpha.vercel.app', extra: { 'x-forwarded-host': STORE_HOST } }))));
  assert.ok(isNext(middleware(mk({ host: STORE_HOST, extra: { 'x-forwarded-host': 'zita-alpha.vercel.app' } }))));
});

test('otras rutas, métodos y tipos de contenido → no-op', () => {
  for (const p of ['/api/store/flow', '/api/store-prerender', '/assets/index-abc.js', '/terminos', '/tienda/flow', '/dashboard', '/login', '/favicon.ico', '/flow/favicon.ico', '/sitemap.xml', '/robots.txt']) {
    assert.ok(isNext(middleware(mk({ path: p }))), p);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.ok(isNext(middleware(mk({ method, ua: GOOGLEBOT }))), method);
  assert.ok(isNext(middleware(mk({ accept: 'application/json' }))));
  assert.ok(isNext(middleware(mk({ accept: 'image/png' }))));
});

test('el matcher solo cubre la raíz', () => {
  assert.deepEqual(config, { matcher: '/' });
});

test('ante cualquier error deja pasar la petición (nunca lanza)', () => {
  for (const bad of [null, undefined, {}, { url: 'no-es-url', method: 'GET', headers: new Headers() }, { method: 'GET', url: 'https://x/', headers: null }]) {
    let res;
    assert.doesNotThrow(() => { res = middleware(bad); });
    assert.ok(isNext(res));
  }
  assert.equal(shouldServeStoreHead(null), false);
});

test('los user-agents del middleware son los mismos que las reglas de bots de vercel.json', () => {
  const conf = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const values = conf.rewrites.flatMap((r) => (r.has || []).filter((h) => h.type === 'header' && h.key === 'user-agent').map((h) => h.value));
  assert.ok(values.length >= 2);
  for (const v of values) assert.equal(BOT_UA.source, new RegExp(v).source);
});

// ── <head> de FLOW en el prerender ──
const ZITA_BASE = `<!doctype html><html lang="es"><head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/icons/favicon-256.png" />
    <link rel="apple-touch-icon" href="/logo.png" />
    <title>ZITA — Gestión Inteligente</title>
    <meta name="theme-color" content="#0d1117" />
    <meta name="apple-mobile-web-app-title" content="ZITA" />
    <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
  <link rel="manifest" href="/manifest.webmanifest"></head><body><div id="root"></div></body></html>`;

test('prerender: el <head> trae favicon, apple-touch-icon, manifest y theme-color de FLOW y ninguno de ZITA', () => {
  const seo = { title: 'FLOW | Ropa deportiva', description: 'Descripción', canonical: 'https://www.flowactivewear.co/', image: null };
  const html = compose(ZITA_BASE, headTags(seo, { origin: 'https://www.flowactivewear.co', url: 'https://www.flowactivewear.co/' }), '<main>x</main>');
  assert.match(html, /<link rel="icon" href="\/flow\/favicon\.ico" sizes="any">/);
  assert.match(html, /<link rel="icon" type="image\/png" sizes="32x32" href="\/flow\/favicon-32\.png">/);
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/flow\/apple-touch-icon\.png">/);
  assert.match(html, /<link rel="manifest" href="\/flow\/manifest\.webmanifest">/);
  assert.match(html, /<meta name="theme-color" content="#1C1C1C">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="FLOW">/);
  assert.match(html, /<meta property="og:title" content="FLOW \| Ropa deportiva">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/www\.flowactivewear\.co\/og-flow\.jpg">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.flowactivewear\.co\/">/);
  for (const zita of ['/icons/favicon-256.png', '/logo.png', '/icons/icon-192x192.png', 'href="/manifest.webmanifest"', '#0d1117', 'ZITA —', 'content="ZITA"']) {
    assert.equal(html.includes(zita), false, `quedó algo de ZITA: ${zita}`);
  }
  assert.equal((html.match(/<link rel="manifest"/g) || []).length, 1);
  assert.equal((html.match(/<title>/g) || []).length, 1);
});

test('los archivos de identidad de FLOW existen en public/flow y el manifest apunta a ellos', () => {
  const dir = new URL('../public/flow/', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.webmanifest', dir), 'utf8'));
  assert.equal(manifest.name, 'FLOW');
  assert.equal(manifest.theme_color, '#1C1C1C');
  assert.equal(manifest.background_color, '#1C1C1C');
  for (const f of ['favicon.ico', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', ...manifest.icons.map((i) => i.src.replace('/flow/', ''))]) {
    assert.ok(fs.existsSync(new URL(f, dir)), f);
  }
});
