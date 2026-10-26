// Dominio propio de la tienda (www.flowactivewear.co): contexto SEO y reglas de vercel.json.
// Ejecutar desde frontend/:  npm run test:domain   (no necesita red ni build)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { seoContext, storeHostOrigin, isStoreHost, resolveStorePath } from '../api/_lib/store.js';

const NEW = 'www.flowactivewear.co';
const cfgNew = { apiUrl: '', siteUrl: `https://${NEW}`, slug: 'flow', storeHost: NEW };
const cfgNone = { apiUrl: '', siteUrl: '', slug: 'flow', storeHost: '' };
const req = (host) => ({ headers: { host, 'x-forwarded-proto': 'https' } });

test('storeHostOrigin: https con el dominio propio; sin dominio → null; localhost → http', () => {
  assert.equal(storeHostOrigin(cfgNew), `https://${NEW}`);
  assert.equal(storeHostOrigin(cfgNone), null);
  assert.equal(storeHostOrigin({ ...cfgNew, storeHost: 'localhost' }), 'http://localhost');
});

test('seoContext: en el dominio propio el canonical no lleva /tienda/flow', () => {
  assert.deepEqual(seoContext(req(NEW), { slug: 'flow', base: '' }, cfgNew), { origin: `https://${NEW}`, base: '' });
});

test('seoContext: pedida desde el host viejo (/tienda/flow) también apunta al dominio propio', () => {
  assert.deepEqual(
    seoContext(req('zita-alpha.vercel.app'), { slug: 'flow', base: '/tienda/flow' }, cfgNew),
    { origin: `https://${NEW}`, base: '' },
  );
});

test('seoContext: otra tienda (otro slug) conserva su propio origen y prefijo', () => {
  assert.deepEqual(
    seoContext(req('zita-alpha.vercel.app'), { slug: 'tienda-test', base: '/tienda/tienda-test' }, cfgNew),
    { origin: `https://${NEW}`, base: '/tienda/tienda-test' },
  );
});

test('seoContext: sin dominio propio configurado queda como antes (origen de la petición + prefijo)', () => {
  assert.deepEqual(
    seoContext(req('zita-alpha.vercel.app'), { slug: 'flow', base: '/tienda/flow' }, cfgNone),
    { origin: 'https://zita-alpha.vercel.app', base: '/tienda/flow' },
  );
});

test('resolveStorePath: el dominio propio sirve la raíz sin prefijo; el host viejo solo con /tienda/flow', () => {
  assert.deepEqual(resolveStorePath(req(NEW), '/terminos', cfgNew), { slug: 'flow', base: '', rest: '/terminos' });
  assert.equal(resolveStorePath(req('zita-alpha.vercel.app'), '/terminos', cfgNew), null); // /terminos de ZITA
  assert.deepEqual(resolveStorePath(req('zita-alpha.vercel.app'), '/tienda/flow/terminos', cfgNew), { slug: 'flow', base: '/tienda/flow', rest: '/terminos' });
  assert.equal(isStoreHost(req(NEW), cfgNew), true);
  assert.equal(isStoreHost(req('zita-alpha.vercel.app'), cfgNew), false);
});

// ── vercel.json ──
const conf = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const hostRule = (r) => (r.has || []).some((h) => h.type === 'host' && h.value === NEW);

test('vercel.json: las rutas nuevas de bots (políticas y ayuda en la raíz) solo aplican al dominio propio', () => {
  const rule = conf.rewrites.find((r) => /terminos/.test(r.source));
  assert.ok(rule && hostRule(rule), 'la regla de /terminos debe llevar la condición de host');
  for (const p of ['terminos', 'privacidad', 'preguntas-frecuentes', 'promociones', 'formatos', 'guia-de-tallas']) assert.match(rule.source, new RegExp(p));
  assert.equal(rule.destination, '/api/store-prerender?path=/:section/:rest*');
  assert.ok(rule.has.some((h) => h.type === 'header' && h.key === 'user-agent'), 'solo para user-agents de bots');
});

test('vercel.json: la regla de bots que ya existía (todos los hosts) no cambió', () => {
  const rule = conf.rewrites.find((r) => r.source === '/:section(producto|coleccion|colores|ayuda|sobre-flow|envios|cambios)/:rest*');
  assert.ok(rule && !hostRule(rule));
});

test('vercel.json: /tienda/flow/... en el dominio propio redirige (308) a la raíz; el catch-all sigue de último', () => {
  const r = conf.redirects.find((x) => x.source === '/tienda/flow/:path*');
  assert.ok(r && hostRule(r) && r.permanent === true && r.destination === '/:path*');
  assert.deepEqual(conf.rewrites.at(-1), { source: '/(.*)', destination: '/' });
});
