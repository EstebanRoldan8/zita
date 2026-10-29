// Historial de inventario (inventory_movements): filtros, paginación y descripción legible de cada movimiento.
// Reglas puras (sin base de datos), probadas en tests/inventory-history.test.js.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNDO_REASON = 'deshacer asistente';

// Tipo de filtro del panel → tipos de movimiento en la base
const FILTER_TYPES = {
  venta: ['venta'],
  ajuste: ['ajuste', 'entrada', 'inicial'],
  devolucion: ['devolucion'],
  deshacer: ['ajuste'],
};

const orderCode = (id) => `P-${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;

// Query del panel → filtros validados. Lo inválido se ignora (nunca llega a la consulta).
function parseFilters(query = {}) {
  const q = query || {};
  const tipo = Object.prototype.hasOwnProperty.call(FILTER_TYPES, q.tipo) ? q.tipo : null;
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 25, 5), 100);
  const desde = DATE_RE.test(String(q.desde || '')) ? q.desde : null;
  const hasta = DATE_RE.test(String(q.hasta || '')) ? q.hasta : null;
  return {
    tipo,
    product_id: UUID_RE.test(String(q.product_id || '')) ? q.product_id : null,
    variant_id: UUID_RE.test(String(q.variant_id || '')) ? q.variant_id : null,
    desde, hasta, page, limit, from: (page - 1) * limit, to: page * limit - 1,
  };
}

// Aplica los filtros a un query builder de supabase sobre inventory_movements (ya acotado por negocio)
function applyFilters(query, f) {
  let q = query;
  if (f.tipo) q = q.in('type', FILTER_TYPES[f.tipo]);
  if (f.tipo === 'deshacer') q = q.eq('reason', UNDO_REASON);
  if (f.tipo === 'ajuste') q = q.or(`reason.is.null,reason.neq."${UNDO_REASON}"`);
  if (f.product_id) q = q.eq('product_id', f.product_id);
  if (f.variant_id) q = q.eq('variant_id', f.variant_id);
  if (f.desde) q = q.gte('created_at', `${f.desde}T00:00:00-05:00`);
  if (f.hasta) q = q.lte('created_at', `${f.hasta}T23:59:59-05:00`);
  return q;
}

// Quién o qué hizo el movimiento y a qué pedido pertenece
function describeSource(m, ordersById = {}) {
  const o = m.reference_id ? ordersById[m.reference_id] : null;
  const pedido = (m.reference_type === 'order' || m.reference_type === 'order_cancel' || m.reference_type === 'order_delete') && m.reference_id
    ? orderCode(m.reference_id) : null;
  const canal = o ? (o.source === 'web' ? 'tienda web' : 'pedido manual') : null;
  let origen;
  if (m.reason === UNDO_REASON) origen = 'Asistente (deshacer)';
  else if (m.reference_type === 'assistant_action') origen = 'Asistente';
  else if (m.reference_type === 'order') origen = canal ? `Venta (${canal})` : 'Venta por pedido';
  else if (m.reference_type === 'order_cancel') origen = 'Devolución por cancelación';
  else if (m.reference_type === 'order_delete') origen = 'Devolución por pedido eliminado';
  else if (m.reference_type === 'product_sale') origen = 'Venta rápida';
  else if (m.reference_type === 'restock') origen = 'Entrada de mercancía';
  else if (m.reference_type === 'product_create' || m.reference_type === 'variant_create') origen = 'Stock inicial';
  else if (m.reference_type === 'variant_update' || m.reference_type === 'product_update' || m.reference_type === 'manual') origen = 'Ajuste en el panel';
  else origen = m.type === 'venta' ? 'Venta' : 'Ajuste';
  return { origen, pedido, cliente: o ? o.client_name || null : null };
}

// Activar una variante cuando el producto no tiene otras activas y guarda stock propio: el total pasaría a ser la
// suma de las variantes y esas unidades se perderían. Devuelve el mensaje de bloqueo o null.
function ownStockLossMessage({ productStock, otherActiveVariants, variantLabel }) {
  if (otherActiveVariants > 0 || !(Number(productStock) > 0)) return null;
  const n = Number(productStock);
  return `Este producto tiene ${n} unidad${n === 1 ? '' : 'es'} guardada${n === 1 ? '' : 's'} sin variante. Si activas ${variantLabel || 'esta variante'}, el total pasaría a ser solo el de las variantes y esas ${n} se perderían. Primero lleva ese stock a 0 (Ajustar stock) y luego activa o crea las variantes con su stock real.`;
}

module.exports = { FILTER_TYPES, UNDO_REASON, parseFilters, applyFilters, describeSource, ownStockLossMessage, orderCode };
