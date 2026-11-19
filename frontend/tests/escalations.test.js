// Escalaciones del bot en el dashboard del dueño. Ejecutar desde frontend/:  node --test tests/escalations.test.js
// El componente se empaqueta con rolldown (viene con Vite 8; transforma el JSX) y se renderiza con react-dom/server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rolldown } from 'rolldown';
import { timeAgo, sortEscalations, displayPhone } from '../src/lib/escalations.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// Bundle ESM del componente en node_modules/.cache (resuelve react desde frontend/node_modules)
async function loadComponent(rel) {
  const outDir = path.join(root, 'node_modules', '.cache', 'zita-tests');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${path.basename(rel, '.jsx')}-${process.pid}.mjs`);
  const bundle = await rolldown({
    input: path.join(root, rel),
    external: (id) => /^(react|react-dom|react\/jsx-runtime|lucide-react)(\/|$)/.test(id),
    transform: { jsx: 'react-jsx' },
    logLevel: 'silent',
  });
  await bundle.write({ file: outFile, format: 'esm' });
  await bundle.close();
  return (await import(pathToFileURL(outFile).href)).default;
}

const NOW = new Date('2026-11-19T15:00:00Z').getTime();
const item = (over = {}) => ({
  id: 'e1', created_at: new Date(NOW - 5 * 60000).toISOString(), motivo: 'Quiero hablar con el dueño',
  client_name: 'Carlos Ruiz', client_phone: '573001112233', client_phone_masked: null,
  whatsapp_url: 'https://wa.me/573001112233', attended_at: null, bot_paused: true, can_resume_bot: true, ...over,
});

const EscalationsList = await loadComponent('src/components/escalations/EscalationsList.jsx');
const render = (props) => renderToStaticMarkup(createElement(EscalationsList, { now: NOW, ...props }));

test('renderiza la lista: cliente, teléfono, motivo, hace cuánto y los tres botones', () => {
  const html = render({ items: [item()] });
  assert.match(html, /Carlos Ruiz/);
  assert.match(html, /\+573001112233/);
  assert.match(html, /Quiero hablar con el dueño/);
  assert.match(html, /hace 5 min/);
  assert.match(html, /href="https:\/\/wa\.me\/573001112233"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /Abrir WhatsApp/);
  assert.match(html, /Marcar atendida/);
  assert.match(html, /Reactivar bot/);
  assert.match(html, /Bot pausado/);
});

test('el motivo con HTML se muestra como TEXTO (escapado), nunca como etiquetas', () => {
  const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script><b>hola</b>';
  const html = render({ items: [item({ motivo: evil, client_name: '<i>Carlos</i>' })] });
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<b>hola</b>'), false);
  assert.equal(html.includes('<i>Carlos</i>'), false);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;&lt;b&gt;hola&lt;\/b&gt;/);
  assert.match(html, /&lt;i&gt;Carlos&lt;\/i&gt;/);
});

test('atendida y sin pausa: sin "Marcar atendida" ni "Reactivar bot"; sin cliente identificado: sin WhatsApp', () => {
  const html = render({ items: [
    item({ id: 'a', attended_at: new Date(NOW).toISOString(), bot_paused: false }),
    item({ id: 'b', client_name: null, client_phone: null, client_phone_masked: '57311***4455', whatsapp_url: null, can_resume_bot: false }),
  ] });
  assert.equal(html.match(/Marcar atendida/g).length, 1, 'solo la no atendida');
  assert.equal((html.match(/Reactivar bot/g) || []).length, 0, 'la b no se puede reactivar (sin cliente)');
  assert.equal((html.match(/Abrir WhatsApp/g) || []).length, 1);
  assert.match(html, /Cliente sin identificar/);
  assert.match(html, /\+57311\*\*\*4455/);
  assert.match(html, /Atendida/);
});

test('lista vacía: mensaje neutro', () => {
  assert.match(render({ items: [] }), /Sin escalaciones por ahora/);
});

test('el componente no usa dangerouslySetInnerHTML', () => {
  for (const f of ['EscalationsList.jsx', 'EscalationsPanel.jsx']) {
    const src = readFileSync(path.join(root, 'src', 'components', 'escalations', f), 'utf8');
    assert.equal(src.includes('dangerouslySetInnerHTML'), false, f);
  }
});

test('helpers: hace cuánto, orden (sin atender primero) y teléfono a mostrar', () => {
  assert.equal(timeAgo(new Date(NOW - 20000).toISOString(), NOW), 'recién');
  assert.equal(timeAgo(new Date(NOW - 3 * 3600000).toISOString(), NOW), 'hace 3 h');
  assert.equal(timeAgo(new Date(NOW - 86400000).toISOString(), NOW), 'hace 1 día');
  assert.equal(timeAgo(new Date(NOW - 5 * 86400000).toISOString(), NOW), 'hace 5 días');
  assert.equal(timeAgo('no-es-fecha', NOW), '');
  const sorted = sortEscalations([
    { id: 'viejo', created_at: '2026-11-01T00:00:00Z', attended_at: null },
    { id: 'atendida', created_at: '2026-11-19T00:00:00Z', attended_at: '2026-11-19T01:00:00Z' },
    { id: 'nuevo', created_at: '2026-11-18T00:00:00Z', attended_at: null },
  ]);
  assert.deepEqual(sorted.map((s) => s.id), ['nuevo', 'viejo', 'atendida']);
  assert.equal(displayPhone({ client_phone: '573001112233' }), '+573001112233');
  assert.equal(displayPhone({ client_phone_masked: '57311***4455' }), '+57311***4455');
  assert.equal(displayPhone({}), '');
});
