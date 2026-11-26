// Modal "Editar pedido": lista de cambios que se manda al servidor y render en español.
// Ejecutar desde frontend/:  node --test tests/order-edit.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rolldown } from 'rolldown';
import { buildChanges, formatEditValue, groupEdits, toDateInput, orderCode } from '../src/components/orders/orderEditUtils.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// El modal se empaqueta con rolldown; lib/api se reemplaza por un doble (el render en servidor no hace requests)
async function loadComponent(rel) {
  const outDir = path.join(root, 'node_modules', '.cache', 'zita-tests');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${path.basename(rel, '.jsx')}-${Date.now()}.mjs`);
  const bundle = await rolldown({
    input: path.join(root, rel),
    external: (id) => /^(react|react-dom|react\/jsx-runtime|lucide-react)(\/|$)/.test(id),
    transform: { jsx: 'react-jsx' },
    plugins: [{
      name: 'api-stub',
      resolveId(id) { return /\/lib\/api$/.test(id) ? '\0api-stub' : null; },
      load(id) { return id === '\0api-stub' ? 'export default { get: async () => ({ data: {} }), post: async () => ({ data: {} }) };' : null; },
    }],
    logLevel: 'silent',
  });
  await bundle.write({ file: outFile, format: 'esm' });
  await bundle.close();
  return (await import(pathToFileURL(outFile).href)).default;
}

const base = {
  client_name: 'Ana', client_phone: '', customer_email: '', delivery_type: 'retiro', delivery_address: '', shipping_city: 'Cali',
  shipping_carrier: '', tracking_code: '', notes: '', status: 'entregado', payment_status: 'pagado', payment_method: 'nequi',
  created_at: '2026-10-10', discount_amount: '0', shipping_cost: '0', shipping_zone: '',
  items: [{ key: 'a', id: 'a', product_id: 'p1', variant_id: 'v1', description: 'Top Jana (S)', quantity: '1', unit_price: '60000', is_set: false }],
};

test('sin cambios no manda nada; solo manda lo que cambió', () => {
  assert.deepEqual(buildChanges(base, { ...base }), {});
  assert.deepEqual(buildChanges(base, { ...base, notes: '  hola  ', discount_amount: '10000' }), { notes: 'hola', discount_amount: 10000 });
  assert.deepEqual(buildChanges(base, { ...base, discount_amount: '' }), {});
});

test('artículos: agregar, cambiar cantidad y quitar arman la lista final (precios como números)', () => {
  const form = {
    ...base,
    items: [
      { ...base.items[0], quantity: '2' },
      { key: 'n', id: null, product_id: 'p2', variant_id: '', description: 'Licra Aria', quantity: '1', unit_price: '80000', is_set: false },
    ],
  };
  assert.deepEqual(buildChanges(base, form).items, [
    { id: 'a', quantity: 2, unit_price: 60000, variant_id: 'v1' },
    { product_id: 'p2', variant_id: null, quantity: 1, unit_price: 80000 },
  ]);
  assert.deepEqual(buildChanges(base, { ...base, items: [] }).items, []);
  // Un valor inválido se manda tal cual: el servidor responde con el error
  assert.equal(buildChanges(base, { ...base, items: [{ ...base.items[0], quantity: 'dos' }] }).items[0].quantity, 'dos');
});

test('formatos del historial y utilidades', () => {
  assert.equal(formatEditValue('discount_amount', 10000).replace(/\s/g, ' '), '$ 10.000');
  assert.equal(formatEditValue('status', 'entregado'), 'Entregado');
  assert.equal(formatEditValue('notes', null), '—');
  assert.match(formatEditValue('items', [{ quantity: 2, description: 'Top', unit_price: 1000 }]), /^2× Top/);
  assert.match(formatEditValue('caja', { ingreso: 1000, costo: 500 }), /ingreso .*1\.000 · costo .*500/);
  const g = groupEdits([{ id: 1, edit_group: 'g1', created_at: 'x', source: 'panel' }, { id: 2, edit_group: 'g1' }, { id: 3, edit_group: 'g2', source: 'asistente' }]);
  assert.deepEqual(g.map((x) => [x.id, x.rows.length]), [['g1', 2], ['g2', 1]]);
  assert.equal(toDateInput('2026-10-10T03:00:00Z'), '2026-10-09', 'fecha en hora de Colombia');
  assert.equal(orderCode('1a2b3c4d-0000-4000-8000-000000000000'), 'P-1A2B3C4D');
});

const EditOrderModal = await loadComponent('src/components/orders/EditOrderModal.jsx');
const order = {
  id: '1a2b3c4d-0000-4000-8000-000000000000', status: 'entregado', payment_status: 'pagado', payment_method: 'nequi',
  created_at: '2026-10-10T17:00:00Z', total_amount: 60000, discount_amount: 0, shipping_cost: 0, client_name: '<b>Ana</b>',
  order_items: [{ id: 'a', product_id: 'p1', variant_id: 'v1', description: 'Top Jana (S)', quantity: 1, unit_price: 60000 }],
};
const products = [{ id: 'p1', name: 'Top Jana', price: 60000, has_variants: true, is_active: true }];

test('el modal se renderiza en español con todas las secciones y escapa los datos', () => {
  const html = renderToStaticMarkup(createElement(EditOrderModal, { order, products, isTienda: true, onClose() {} }));
  for (const t of ['Editar pedido P-1A2B3C4D', 'Cliente', 'Entrega', 'Artículos', 'Agregar producto o set', 'Descuento ($)',
    'Recalcular descuento por set', 'Recalcular por zona', 'Estado de pago', 'Fecha del pedido', 'Notas', 'Historial de cambios', 'Revisar cambios']) {
    assert.ok(html.includes(t), `falta «${t}»`);
  }
  assert.equal(html.includes('<b>Ana</b>'), false);
  assert.match(html, /value="2026-10-10"/);
});

test('pedido cancelado: ofrece reabrir y bloquea artículos y dinero', () => {
  const html = renderToStaticMarkup(createElement(EditOrderModal, { order: { ...order, status: 'cancelado' }, products, isTienda: true, onClose() {} }));
  assert.match(html, /primero reábrelo/);
  assert.match(html, /Reabrir como/);
  assert.equal(html.includes('Recalcular descuento por set'), false);
  assert.equal(html.includes('Agregar producto o set'), false);
});
