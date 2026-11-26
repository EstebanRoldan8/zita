// Utilidades puras del modal "Editar pedido" (sin React, para poder probarlas con node:test).
// El panel solo arma la lista de cambios; el servidor valida, recalcula totales, stock y Caja.

export const ORDER_STATUS_LABELS = {
  recibido: 'Recibido', en_proceso: 'En proceso', listo: 'Listo', enviado: 'Enviado', entregado: 'Entregado', cancelado: 'Cancelado',
};
export const PAYMENT_STATUS_LABELS = { pendiente: 'Pendiente', pagado: 'Pagado', fallido: 'Fallido', reembolsado: 'Reembolsado' };
export const PAYMENT_METHOD_LABELS = {
  efectivo: 'Efectivo', transferencia: 'Transferencia', nequi: 'Nequi', daviplata: 'Daviplata', tarjeta: 'Tarjeta', wompi: 'Wompi', otro: 'Otro',
};
export const DELIVERY_LABELS = { retiro: 'Retiro en tienda', envio: 'Envío', domicilio: 'Domicilio' };

const MONEY_FIELDS = ['discount_amount', 'shipping_cost', 'total_amount'];
const SCALARS = [
  'client_name', 'client_phone', 'customer_email', 'delivery_type', 'delivery_address', 'shipping_city', 'shipping_carrier',
  'tracking_code', 'notes', 'status', 'payment_status', 'payment_method', 'created_at', 'shipping_zone',
];

export function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(v) || 0);
}

export const orderCode = (id) => `P-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export function toDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

// "12" → 12; lo demás se manda tal cual para que el servidor responda con un error claro
const toNum = (v) => (/^\s*\d+\s*$/.test(String(v ?? '')) ? Number(v) : v);
const clean = (v) => String(v ?? '').trim();

const lineSig = (i) => [i.id || null, i.product_id || null, i.variant_id || null, String(toNum(i.quantity)), String(toNum(i.unit_price)), clean(i.description)].join('|');

// Solo lo que cambió respecto del pedido guardado
export function buildChanges(original, form) {
  const changes = {};
  for (const key of SCALARS) {
    if (clean(form[key]) !== clean(original[key])) changes[key] = clean(form[key]);
  }
  for (const key of ['discount_amount', 'shipping_cost']) {
    const money = (v) => (clean(v) === '' ? 0 : toNum(v)); // vacío = $0
    if (String(money(form[key])) !== String(money(original[key]))) changes[key] = money(form[key]);
  }
  const before = (original.items || []).map(lineSig).join('\n');
  const after = (form.items || []).map(lineSig).join('\n');
  if (before !== after) {
    changes.items = (form.items || []).map((i) => {
      if (i.id) {
        const out = { id: i.id, quantity: toNum(i.quantity), unit_price: toNum(i.unit_price) };
        if (i.product_id && !i.is_set) out.variant_id = i.variant_id || null;
        if (!i.product_id) out.description = clean(i.description);
        return out;
      }
      return i.product_id
        ? { product_id: i.product_id, variant_id: i.variant_id || null, quantity: toNum(i.quantity), unit_price: toNum(i.unit_price) }
        : { description: clean(i.description), quantity: toNum(i.quantity), unit_price: toNum(i.unit_price) };
    });
  }
  return changes;
}

// Valor de un campo del historial o de la vista previa, legible
export function formatEditValue(field, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (MONEY_FIELDS.includes(field)) return formatCOP(v);
  if (field === 'status') return ORDER_STATUS_LABELS[v] || v;
  if (field === 'payment_status') return PAYMENT_STATUS_LABELS[v] || v;
  if (field === 'payment_method') return PAYMENT_METHOD_LABELS[v] || v;
  if (field === 'delivery_type') return DELIVERY_LABELS[v] || v;
  if (field === 'created_at') return new Date(v).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });
  if (field === 'items' && Array.isArray(v)) return v.map((i) => `${i.quantity}× ${i.description || 'artículo'} ${formatCOP(i.unit_price)}`).join(', ') || '—';
  if (field === 'caja' && typeof v === 'object') return `ingreso ${formatCOP(v.ingreso)} · costo ${formatCOP(v.costo)}`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Filas del historial → un grupo por guardado (más reciente primero)
export function groupEdits(edits) {
  const groups = [];
  const byId = {};
  for (const e of edits || []) {
    const id = e.edit_group || e.id;
    if (!byId[id]) {
      byId[id] = { id, created_at: e.created_at, source: e.source, rows: [] };
      groups.push(byId[id]);
    }
    byId[id].rows.push(e);
  }
  return groups;
}
