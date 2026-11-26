// Edición completa de un pedido ya creado (panel y asistente de tienda usan ESTE servicio; no hay otra lógica).
//
// buildEditPlan lee el pedido y el catálogo SOLO del negocio de la sesión, valida y sanitiza cada campo, resuelve
// precios, variantes y sets en el servidor y arma un plan:
//   - diferencia de stock por variante (lo que vuelve: 'devolucion'; lo que sale: 'venta'), enlazada al pedido;
//   - líneas finales, subtotal, envío, descuento y total (nunca se toma un total del cliente);
//   - Caja del pedido pagado: su ingreso pasa al nuevo total neto y su egreso de costo se mueve por la diferencia de
//     costo, ambos EN SU FILA (conservan su fecha original; los índices únicos de 053 impiden duplicar);
//   - historial (campo, antes → después).
// applyEdit manda el plan a la función edit_order (migración 068), que lo aplica en UNA transacción: o todo o nada.
// La vista previa (previewEdit) arma el mismo plan sin escribir nada.

const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { parseCustomer, parseDiscount, computeTotals } = require('../utils/orderTotals');
const { itemMoves } = require('../utils/orderStock');
const { loadBundles, deriveBundle, bundleSnapshot, snapshotCost, variantLabel } = require('../utils/bundles');
const { calculateShipping, ZONE_LOCAL, ZONE_NATIONAL } = require('../config/shipping');
const { setDiscount, promoGroup, SET_PROMO } = require('../utils/setPromo');
const { getTimezone, getOffsetForTz } = require('../utils/timezone');
const { isTiendaBusiness } = require('../utils/businessType');

const ORDER_STATUSES = ['recibido', 'en_proceso', 'listo', 'enviado', 'entregado', 'cancelado'];
const PAYMENT_STATUSES = ['pendiente', 'pagado', 'fallido', 'reembolsado'];
const PAYMENT_METHODS = ['efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'wompi', 'otro'];
const DELIVERY_TYPES = ['retiro', 'envio', 'domicilio'];
const SHIPPING_ZONES = [ZONE_LOCAL, ZONE_NATIONAL];
// Un pedido cancelado solo admite datos del cliente y notas; para lo demás hay que reabrirlo
const CANCELLED_EDITABLE = ['client_name', 'client_phone', 'customer_email', 'delivery_address', 'shipping_city', 'notes', 'shipping_carrier', 'tracking_code'];
const OLD_ORDER_DAYS = 30;
const MAX_LINES = 50;
const MAX_QTY = 999;
const MAX_PRICE = 10000000;
const MAX_MONEY = 99999999; // order_items.total_price y orders.total_amount son NUMERIC(10,2)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

// Campos del pedido que se pueden enviar; cualquier otro (business_id, id, source, total_amount…) se rechaza
const TEXT_FIELDS = {
  delivery_address: [300, 'La dirección'],
  shipping_city: [80, 'La ciudad'],
  notes: [1000, 'Las notas'],
  shipping_carrier: [100, 'La transportadora'],
  tracking_code: [100, 'La guía de seguimiento'],
};
const ALLOWED_KEYS = new Set([
  'client_name', 'client_phone', 'customer_email', 'delivery_type', ...Object.keys(TEXT_FIELDS),
  'status', 'payment_status', 'payment_method', 'created_at', 'discount_amount', 'shipping_cost', 'shipping_zone', 'items',
]);
const FIELD_LABELS = {
  client_name: 'Cliente', client_phone: 'Teléfono', customer_email: 'Correo', delivery_type: 'Tipo de entrega',
  delivery_address: 'Dirección', shipping_city: 'Ciudad', notes: 'Notas', shipping_carrier: 'Transportadora',
  tracking_code: 'Guía', status: 'Estado', payment_status: 'Estado de pago', payment_method: 'Método de pago',
  created_at: 'Fecha', discount_amount: 'Descuento', shipping_cost: 'Costo de envío', shipping_zone: 'Zona de envío',
  items: 'Artículos', total_amount: 'Total', caja: 'Caja',
};

const orderCode = (id) => `P-${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const num = (v) => Number(v) || 0;

class EditError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const bad = (message, extra) => new EditError(400, message, extra);

function cleanText(value, max, label, { multiline = false } = {}) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw bad(`${label} debe ser texto.`);
  let t = value.replace(CONTROL_CHARS, ' ');
  t = multiline ? t.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim() : t.replace(/\s+/g, ' ').trim();
  if (t.length > max) throw bad(`${label} no puede superar ${max} caracteres.`);
  return t || null;
}

function intIn(value, min, max, label) {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\s*-?\d+\s*$/.test(value) ? Number(value) : NaN);
  if (!Number.isInteger(n)) throw bad(`${label} debe ser un número entero.`);
  if (n < min || n > max) throw bad(`${label} debe estar entre ${min.toLocaleString('es-CO')} y ${max.toLocaleString('es-CO')}.`);
  return n;
}

const moveKey = (m) => `${m.product_id}|${m.variant_id || ''}`;
const lineView = (i) => ({ description: i.description || null, quantity: num(i.quantity), unit_price: num(i.unit_price) });
const itemsSignature = (items) => JSON.stringify((items || []).map((i) => [i.id || null, i.product_id || null, i.variant_id || null, num(i.quantity), num(i.unit_price), i.description || null]));

// Lo que el plan supone del pedido: edit_order lo vuelve a comprobar dentro de la transacción
function expectedOf(order) {
  const items = order.order_items || [];
  return {
    status: order.status ?? null,
    payment_status: order.payment_status || 'pendiente',
    total_amount: num(order.total_amount),
    items_count: items.length,
    items_qty: items.reduce((s, i) => s + num(i.quantity), 0),
    items_sum: round2(items.reduce((s, i) => s + num(i.total_price), 0)),
  };
}
const sameExpected = (a, b) => !!a && !!b && ['status', 'payment_status', 'total_amount', 'items_count', 'items_qty', 'items_sum']
  .every((k) => String(a[k] ?? '') === String(b[k] ?? ''));

function localDate(iso, tz) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
}
function localTime(iso, tz) {
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: tz, hour12: false });
}

async function must(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

// ── Lecturas (siempre filtradas por el negocio de la sesión) ────────────────────
async function loadOrder(db, businessId, orderId) {
  if (!UUID_RE.test(String(orderId || ''))) return null;
  return must(db.from('orders').select('*, order_items(*)').eq('id', orderId).eq('business_id', businessId).maybeSingle());
}

async function loadProductsById(db, businessId, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  const rows = await must(db.from('products')
    .select('id, name, price, cost_price, stock, has_variants, is_bundle, is_active, category')
    .eq('business_id', businessId).in('id', list));
  return Object.fromEntries((rows || []).map((p) => [p.id, p]));
}

async function loadVariantsById(db, businessId, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  const rows = await must(db.from('product_variants')
    .select('id, product_id, attributes, stock, is_active')
    .eq('business_id', businessId).in('id', list));
  return Object.fromEntries((rows || []).map((v) => [v.id, v]));
}

// Stock actual de cada clave producto|variante (para avisar antes de guardar; adjust_stock sigue siendo la verdad)
async function currentStock(db, businessId, moves) {
  const variantIds = moves.filter((m) => m.variant_id).map((m) => m.variant_id);
  const productIds = moves.filter((m) => !m.variant_id).map((m) => m.product_id);
  const [variants, products] = await Promise.all([
    loadVariantsById(db, businessId, variantIds),
    loadProductsById(db, businessId, productIds),
  ]);
  const out = {};
  for (const m of moves) {
    const row = m.variant_id ? variants[m.variant_id] : products[m.product_id];
    out[moveKey(m)] = row ? num(row.stock) : null;
  }
  return out;
}

// Costo de unas líneas: sets con el costo de su snapshot, productos con su cost_price vigente (igual que orderAccounting)
function linesCost(items, productsById) {
  let cost = 0;
  let hasCost = false;
  for (const i of items) {
    if (i.bundle_snapshot) {
      const c = snapshotCost(i.bundle_snapshot, i.quantity);
      if (c.hasCost) { hasCost = true; cost += c.cost; }
      continue;
    }
    const unit = i.product_id ? productsById[i.product_id]?.cost_price : null;
    if (unit != null) { hasCost = true; cost += num(i.quantity) * Number(unit); }
  }
  return { cost: round2(cost), hasCost };
}

// ── Validación de campos simples ────────────────────────────────────────────────
function parseScalarChanges(changes, order, tz) {
  const next = {};
  const set = (key, value) => { if ((order[key] ?? null) !== value) next[key] = value; };

  for (const key of ['client_name', 'client_phone']) {
    if (changes[key] === undefined) continue;
    const r = parseCustomer({ [key]: changes[key] });
    if (r.error) throw bad(r.error);
    set(key, r.customer[key]);
  }
  if (changes.customer_email !== undefined) {
    const raw = cleanText(changes.customer_email, 254, 'El correo');
    const email = raw ? raw.toLowerCase() : null;
    if (email && !EMAIL_RE.test(email)) throw bad('El correo del cliente no es válido.');
    set('customer_email', email);
  }
  for (const [key, [max, label]] of Object.entries(TEXT_FIELDS)) {
    if (changes[key] === undefined) continue;
    set(key, cleanText(changes[key], max, label, { multiline: key === 'notes' }));
  }
  if (changes.delivery_type !== undefined) {
    const v = String(changes.delivery_type || '').trim().toLowerCase();
    if (!DELIVERY_TYPES.includes(v)) throw bad(`Tipo de entrega inválido. Usa: ${DELIVERY_TYPES.join(', ')}.`);
    set('delivery_type', v);
  }
  if (changes.status !== undefined) {
    const v = String(changes.status || '').trim();
    if (!ORDER_STATUSES.includes(v)) throw bad('Estado inválido.');
    set('status', v);
  }
  if (changes.payment_status !== undefined) {
    const v = String(changes.payment_status || '').trim().toLowerCase();
    if (!PAYMENT_STATUSES.includes(v)) throw bad(`Estado de pago inválido. Usa: ${PAYMENT_STATUSES.join(', ')}.`);
    if (v !== (order.payment_status || 'pendiente')) next.payment_status = v;
  }
  if (changes.payment_method !== undefined) {
    const v = changes.payment_method === null || changes.payment_method === '' ? null : String(changes.payment_method).trim().toLowerCase();
    if (v !== null && !PAYMENT_METHODS.includes(v)) throw bad(`Método de pago inválido. Usa: ${PAYMENT_METHODS.join(', ')}.`);
    set('payment_method', v);
  }
  if (changes.created_at !== undefined) {
    const d = String(changes.created_at || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(new Date(`${d}T12:00:00Z`).getTime())) throw bad('La fecha debe tener el formato AAAA-MM-DD.');
    const today = localDate(new Date().toISOString(), tz);
    if (d > today) throw bad('La fecha del pedido no puede ser futura.');
    if (d < '2020-01-01') throw bad('La fecha del pedido no es válida.');
    // Se conserva la hora local original; solo cambia el día
    if (!order.created_at || d !== localDate(order.created_at, tz)) {
      const hms = order.created_at ? localTime(order.created_at, tz) : '12:00:00';
      next.created_at = new Date(`${d}T${hms}${getOffsetForTz(tz)}`).toISOString();
    }
  }
  if (changes.discount_amount !== undefined) {
    const v = changes.discount_amount === '' || changes.discount_amount === null ? 0 : intIn(changes.discount_amount, 0, MAX_MONEY, 'El descuento');
    if (v !== num(order.discount_amount)) next.discount_amount = v;
  }
  if (changes.shipping_cost !== undefined) {
    const v = changes.shipping_cost === '' || changes.shipping_cost === null ? 0 : intIn(changes.shipping_cost, 0, MAX_PRICE, 'El costo de envío');
    if (v !== num(order.shipping_cost)) next.shipping_cost = v;
  }
  if (changes.shipping_zone !== undefined) {
    const v = changes.shipping_zone === null || changes.shipping_zone === '' ? null : String(changes.shipping_zone).trim().toLowerCase();
    if (v !== null && !SHIPPING_ZONES.includes(v)) throw bad('Zona de envío inválida.');
    set('shipping_zone', v);
  }
  return next;
}

// ── Líneas ──────────────────────────────────────────────────────────────────────
// Devuelve las líneas FINALES ({ id?, product_id, variant_id, description, quantity, unit_price, bundle_snapshot })
async function resolveItems(db, businessId, order, rawItems) {
  if (!Array.isArray(rawItems)) throw bad('Los artículos deben ser una lista.');
  if (rawItems.length === 0) throw bad('El pedido necesita al menos un artículo. Si quieres anularlo, cancélalo.');
  if (rawItems.length > MAX_LINES) throw bad(`Un pedido puede tener máximo ${MAX_LINES} artículos.`);
  const current = Object.fromEntries((order.order_items || []).map((i) => [i.id, i]));
  const seen = new Set();

  const productIds = [];
  const variantIds = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('Artículo inválido.');
    if (raw.product_id) productIds.push(String(raw.product_id));
    if (raw.variant_id) variantIds.push(String(raw.variant_id));
    if (raw.id && current[raw.id]?.product_id) productIds.push(current[raw.id].product_id);
  }
  if ([...productIds, ...variantIds].some((id) => !UUID_RE.test(id))) throw bad('Producto o variante inválidos.');
  const [products, variants] = await Promise.all([
    loadProductsById(db, businessId, productIds),
    loadVariantsById(db, businessId, variantIds),
  ]);
  const setIds = Object.values(products).filter((p) => p.is_bundle).map((p) => p.id);
  const bundles = setIds.length ? await loadBundles(db, businessId, setIds) : { componentsByBundle: {}, variantsByProduct: {} };

  const out = [];
  for (const [idx, raw] of rawItems.entries()) {
    const n = idx + 1;
    const qty = intIn(raw.quantity, 1, MAX_QTY, `La cantidad del artículo ${n}`);
    const price = raw.unit_price === undefined || raw.unit_price === null || raw.unit_price === ''
      ? null : intIn(raw.unit_price, 0, MAX_PRICE, `El precio del artículo ${n}`);

    // Línea existente
    if (raw.id !== undefined && raw.id !== null && raw.id !== '') {
      const cur = current[raw.id];
      if (!cur) throw bad(`El artículo ${n} no pertenece a este pedido.`);
      if (seen.has(cur.id)) throw bad('Un artículo del pedido está repetido.');
      seen.add(cur.id);
      if (raw.product_id && raw.product_id !== cur.product_id) throw bad(`El artículo ${n} no puede cambiar de producto: quítalo y agrega el nuevo.`);
      const line = {
        id: cur.id, product_id: cur.product_id || null, variant_id: cur.variant_id || null, description: cur.description,
        quantity: qty, unit_price: price ?? num(cur.unit_price), bundle_snapshot: cur.bundle_snapshot || null,
      };
      const wantVariant = raw.variant_id === undefined ? line.variant_id : (raw.variant_id || null);
      if (cur.bundle_snapshot) {
        if (wantVariant) throw bad(`${cur.description || 'El set'}: para cambiar la talla o el color de un set, quítalo y agrégalo de nuevo.`);
      } else if (!cur.product_id) {
        if (raw.description !== undefined) line.description = cleanText(raw.description, 200, `La descripción del artículo ${n}`);
        if (!line.description) throw bad(`El artículo ${n} necesita una descripción.`);
      } else if (wantVariant !== line.variant_id) {
        const p = products[cur.product_id];
        if (!p) throw bad(`El producto de "${cur.description || `artículo ${n}`}" ya no existe: no se puede cambiar su variante.`);
        const v = wantVariant ? variants[wantVariant] : null;
        if (p.has_variants && (!v || v.product_id !== p.id)) throw bad(`Elige una variante válida de ${p.name}.`);
        if (!p.has_variants && wantVariant) throw bad(`${p.name} no tiene variantes.`);
        line.variant_id = v ? v.id : null;
        line.description = v ? `${p.name} (${variantLabel(v.attributes)})` : p.name;
      }
      if (line.quantity * line.unit_price > MAX_MONEY) throw bad(`El artículo ${n} supera el valor máximo de una línea.`);
      out.push(line);
      continue;
    }

    // Línea nueva sin producto (texto libre, no mueve stock)
    if (!raw.product_id) {
      const description = cleanText(raw.description ?? '', 200, `La descripción del artículo ${n}`);
      if (!description) throw bad(`El artículo ${n} necesita un producto o una descripción.`);
      if (price === null) throw bad(`El artículo ${n} necesita un precio.`);
      out.push({ product_id: null, variant_id: null, description, quantity: qty, unit_price: price, bundle_snapshot: null });
      continue;
    }

    const p = products[raw.product_id];
    if (!p) throw bad(`El producto del artículo ${n} no existe en tu tienda.`);
    if (p.is_bundle) {
      const components = bundles.componentsByBundle[p.id] || [];
      const d = deriveBundle(p, components, bundles.variantsByProduct);
      if (d.error) throw bad(`${p.name}: ${d.error}`);
      let dv = null;
      if (d.hasVariants) {
        dv = d.variants.find((v) => v.id === raw.variant_id) || null;
        if (!dv) throw bad(`El set ${p.name} tiene variantes: elige talla y color.`);
      } else if (raw.variant_id) throw bad(`El set ${p.name} no tiene variantes.`);
      out.push({
        product_id: p.id, variant_id: null, description: dv ? `${p.name} (${variantLabel(dv.attributes)})` : p.name,
        quantity: qty, unit_price: price ?? num(p.price), bundle_snapshot: bundleSnapshot(p, dv, components),
      });
    } else {
      const v = raw.variant_id ? variants[raw.variant_id] : null;
      if (p.has_variants && (!v || v.product_id !== p.id)) throw bad(`${p.name} tiene variantes: elige talla y color.`);
      if (!p.has_variants && raw.variant_id) throw bad(`${p.name} no tiene variantes.`);
      out.push({
        product_id: p.id, variant_id: v ? v.id : null, description: v ? `${p.name} (${variantLabel(v.attributes)})` : p.name,
        quantity: qty, unit_price: price ?? num(p.price), bundle_snapshot: null,
      });
    }
    const last = out[out.length - 1];
    if (last.quantity * last.unit_price > MAX_MONEY) throw bad(`El artículo ${n} supera el valor máximo de una línea.`);
  }
  return out;
}

// Diferencia de stock: lo que el pedido tenía descontado vs. lo que debe tener descontado ahora
function stockDiff(oldItems, newItems) {
  const net = new Map();
  const add = (m, sign) => {
    const k = moveKey(m);
    const prev = net.get(k) || { product_id: m.product_id, variant_id: m.variant_id || null, delta: 0, label: m.label || m.description || null };
    prev.delta += sign * m.quantity;
    if (!prev.label) prev.label = m.label || m.description || null;
    net.set(k, prev);
  };
  for (const m of oldItems.flatMap(itemMoves)) add(m, +1); // vuelve al inventario
  for (const m of newItems.flatMap(itemMoves)) add(m, -1); // sale del inventario
  const moves = [...net.values()].filter((m) => m.delta !== 0).map((m) => ({
    product_id: m.product_id, variant_id: m.variant_id, change: m.delta, type: m.delta > 0 ? 'devolucion' : 'venta', label: m.label || 'un artículo',
  }));
  // Primero lo que vuelve (cambiar la variante de un mismo producto nunca falla por el orden)
  return moves.sort((a, b) => b.change - a.change);
}

// ── Plan ────────────────────────────────────────────────────────────────────────
// ctx: { businessId, business, userId, source }  ·  opts.reopen: { status } para reabrir un cancelado
async function buildEditPlan(ctx, orderId, changes, { db = supabaseAdmin, now = new Date(), reopen = null } = {}) {
  if (!ctx?.businessId) throw new EditError(401, 'Sesión inválida.');
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw bad('Cambios inválidos.');
  const unknown = Object.keys(changes).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknown.length) throw bad(`Campo no editable: ${unknown.slice(0, 3).join(', ')}.`);

  const order = await loadOrder(db, ctx.businessId, orderId);
  if (!order) throw new EditError(404, 'Pedido no encontrado.');
  const tz = getTimezone(ctx.business?.country);
  const isTienda = isTiendaBusiness(ctx.business);
  const curStatus = order.status ?? 'recibido';
  const wasCancelled = curStatus === 'cancelado';
  const oldItems = order.order_items || [];

  const next = parseScalarChanges(changes, order, tz);
  let newItems = oldItems;
  let itemsChanged = false;
  if (changes.items !== undefined) {
    newItems = await resolveItems(db, ctx.businessId, order, changes.items);
    itemsChanged = itemsSignature(newItems) !== itemsSignature(oldItems);
    if (!itemsChanged) newItems = oldItems;
  }

  // Reglas de estado
  if (reopen) {
    if (!wasCancelled) throw bad('Solo se puede reabrir un pedido cancelado.');
    const st = String(reopen.status || '');
    if (!ORDER_STATUSES.includes(st) || st === 'cancelado') throw bad('Elige el estado al que vuelve el pedido.');
    if (Object.keys(next).length || itemsChanged) throw bad('Reabre el pedido primero; luego podrás editarlo.');
    next.status = st;
  } else if (wasCancelled) {
    const blocked = [...Object.keys(next).filter((k) => !CANCELLED_EDITABLE.includes(k)), ...(itemsChanged ? ['items'] : [])];
    if (blocked.length) {
      throw new EditError(400, 'El pedido está cancelado: solo puedes cambiar los datos del cliente y las notas. Para cambiar lo demás, reábrelo.', { code: 'CANCELADO' });
    }
  }
  const newStatus = next.status ?? curStatus;
  const cancelling = !wasCancelled && newStatus === 'cancelado';
  if (cancelling && (itemsChanged || 'discount_amount' in next || 'shipping_cost' in next || 'payment_status' in next)) {
    throw bad('Para cancelar el pedido no cambies a la vez sus artículos, descuento, envío o pago: guarda esos cambios antes.');
  }

  // Stock: un pedido cancelado no tiene nada descontado
  const before = wasCancelled ? [] : oldItems;
  const after = newStatus === 'cancelado' ? [] : newItems;
  const stock = stockDiff(before, after);

  // Totales (los recalcula el servidor; si no cambian ni las líneas ni el envío ni el descuento, el total se respeta)
  const subtotal = round2(computeTotals(newItems).subtotal);
  const shipping = next.shipping_cost ?? num(order.shipping_cost);
  const discount = next.discount_amount ?? num(order.discount_amount);
  const totalsChanged = itemsChanged || 'shipping_cost' in next || 'discount_amount' in next;
  if (totalsChanged) {
    const d = parseDiscount(discount, subtotal + shipping, 'el subtotal más el envío');
    if (d.error) throw bad(d.error);
  }
  const oldTotal = num(order.total_amount);
  const newTotal = totalsChanged ? round2(subtotal + shipping - discount) : oldTotal;
  if (newTotal > MAX_MONEY) throw bad('El total del pedido supera el máximo permitido.');
  const oldSubtotal = round2(computeTotals(oldItems).subtotal);

  // Pago
  const curPay = order.payment_status || 'pendiente';
  const newPay = next.payment_status ?? curPay;
  if (next.payment_status) {
    if (newPay === 'pagado' && !order.paid_at) next.paid_at = now.toISOString();
    if (newPay === 'pendiente' && order.paid_at) next.paid_at = null;
  }

  // Caja (solo tienda): una fila de ingreso y una de costo por pedido, ajustadas en su fecha original
  const cash = { income: { op: 'none' }, expense: { op: 'none' } };
  const cashView = { applies: false, income: { before: 0, after: 0 }, expense: { before: 0, after: 0 } };
  if (isTienda) {
    const wasPaid = curPay === 'pagado' && !wasCancelled;
    const willPaid = newPay === 'pagado' && newStatus !== 'cancelado';
    const [incRows, expRows] = await Promise.all([
      must(db.from('income').select('id, amount, date').eq('order_id', order.id).eq('business_id', ctx.businessId)),
      must(db.from('expenses').select('id, amount, date').eq('order_id', order.id).eq('business_id', ctx.businessId)),
    ]);
    const inc = incRows?.[0] || null;
    const exp = expRows?.[0] || null;
    cashView.income.before = inc ? num(inc.amount) : 0;
    cashView.expense.before = exp ? num(exp.amount) : 0;
    const date = inc?.date || exp?.date || localDate(order.paid_at || next.paid_at || now.toISOString(), tz);
    const name = (next.client_name !== undefined ? next.client_name : order.client_name) || 'sin nombre';

    if (willPaid) {
      // Ingreso = total neto (CHECK amount > 0: un pedido en $0 no tiene ingreso)
      if (newTotal > 0) {
        if (!inc || num(inc.amount) !== newTotal) cash.income = { op: 'set', amount: newTotal, date, description: `Pedido: ${name}`, client_id: order.client_id || null };
      } else if (inc) cash.income = { op: 'delete' };
      cashView.income.after = newTotal > 0 ? newTotal : 0;

      // Costo: si ya estaba pagado, el egreso se mueve por la diferencia de costo; si no, se registra el costo completo
      const pids = [...oldItems, ...newItems].map((i) => i.product_id).filter(Boolean);
      const productsById = await loadProductsById(db, ctx.businessId, pids);
      const costNew = linesCost(after, productsById);
      let target;
      if (wasPaid && exp) target = round2(Math.max(0, num(exp.amount) + costNew.cost - linesCost(before, productsById).cost));
      else target = costNew.hasCost ? costNew.cost : 0;
      if (target > 0) {
        if (!exp || num(exp.amount) !== target) cash.expense = { op: 'set', amount: target, date, description: `Costo de venta: Pedido ${name}` };
      } else if (exp) cash.expense = { op: 'delete' };
      cashView.expense.after = target > 0 ? target : 0;
    } else {
      if (inc) cash.income = { op: 'delete' };
      if (exp) cash.expense = { op: 'delete' };
    }
    cashView.applies = wasPaid || willPaid || !!inc || !!exp;
  }

  // Lo que va a la tabla orders
  const orderPatch = { ...next };
  if (totalsChanged && newTotal !== oldTotal) orderPatch.total_amount = newTotal;

  // Historial: un registro por campo
  const edits = Object.entries(next)
    .filter(([k]) => k !== 'paid_at')
    .map(([field, value]) => ({ field, before: field === 'payment_status' ? curPay : (order[field] ?? null), after: value }));
  if (itemsChanged) edits.push({ field: 'items', before: oldItems.map(lineView), after: newItems.map(lineView) });
  if (orderPatch.total_amount !== undefined) edits.push({ field: 'total_amount', before: oldTotal, after: newTotal });
  if (cash.income.op !== 'none' || cash.expense.op !== 'none') {
    edits.push({ field: 'caja', before: { ingreso: cashView.income.before, costo: cashView.expense.before }, after: { ingreso: cashView.income.after, costo: cashView.expense.after } });
  }

  // Vista previa del stock
  const available = stock.length ? await currentStock(db, ctx.businessId, stock) : {};
  const stockView = stock.map((m) => {
    const av = available[moveKey(m)];
    return { label: m.label, change: m.change, available: av, after: av === null ? null : av + m.change, short: m.change < 0 && (av === null || av + m.change < 0) };
  });
  const short = stockView.filter((s) => s.short).map((s) => `${s.label} (hay ${s.available ?? 0}, faltan ${Math.abs(s.change) - (s.available ?? 0)})`);

  // Sugerencias para los botones del panel: el valor escrito a mano siempre manda (no se aplican solas)
  const promoProducts = await loadProductsById(db, ctx.businessId, newItems.map((i) => i.product_id));
  const setPromo = setDiscount(newItems.map((i) => ({ group: i.bundle_snapshot ? null : promoGroup(promoProducts[i.product_id]), price: num(i.unit_price), quantity: num(i.quantity) })));
  let shippingSuggestion = null;
  if (isTienda) {
    const { data: biz } = await db.from('businesses').select('store_settings').eq('id', ctx.businessId).maybeSingle();
    const city = next.shipping_city !== undefined ? next.shipping_city : order.shipping_city;
    shippingSuggestion = { ...calculateShipping({ subtotal: round2(subtotal - discount), city, settings: biz?.store_settings || {} }), city: city || null };
  }

  const ageDays = order.created_at ? Math.floor((now.getTime() - new Date(order.created_at).getTime()) / 86400000) : 0;
  const isOld = ageDays > OLD_ORDER_DAYS;
  const isPaid = curPay === 'pagado' || newPay === 'pagado';
  const changesView = edits.filter((e) => !['caja'].includes(e.field)).map((e) => ({ ...e, label: FIELD_LABELS[e.field] || e.field }));

  return {
    order,
    noop: edits.length === 0 && stock.length === 0,
    expected: expectedOf(order),
    orderPatch,
    items: itemsChanged ? newItems.map((i) => ({
      id: i.id || null, product_id: i.product_id || null, variant_id: i.variant_id || null, description: i.description,
      quantity: i.quantity, unit_price: i.unit_price, bundle_snapshot: i.id ? null : (i.bundle_snapshot || null),
    })) : null,
    stock,
    cash,
    edits,
    statusChange: next.status ? { from: curStatus, to: next.status } : null,
    preview: {
      code: orderCode(order.id),
      before: { subtotal: oldSubtotal, shipping: num(order.shipping_cost), discount: num(order.discount_amount), total: oldTotal },
      after: { subtotal, shipping, discount, total: newTotal },
      items: newItems.map((i) => ({ ...lineView(i), id: i.id || null, is_set: !!i.bundle_snapshot })),
      stock: stockView,
      short,
      cash: cashView,
      changes: changesView,
      is_old: isOld,
      age_days: ageDays,
      is_paid: isPaid,
      strong_confirm: isOld || isPaid,
      set_discount: { amount: setPromo.amount, pairs: setPromo.pairs, label: SET_PROMO.label },
      shipping_suggestion: shippingSuggestion,
    },
  };
}

// ── Escritura ───────────────────────────────────────────────────────────────────
function rpcError(error) {
  const msg = String(error?.message || '');
  if (/STOCK_INSUFICIENTE:/.test(msg)) return new EditError(409, `Stock insuficiente para ${msg.split('STOCK_INSUFICIENTE:')[1].trim()}. No se guardó nada.`, { code: 'SIN_STOCK' });
  if (msg.includes('PEDIDO_MODIFICADO')) return new EditError(409, 'El pedido cambió mientras lo editabas. Ciérralo y vuelve a abrirlo. No se guardó nada.', { code: 'MODIFICADO' });
  if (msg.includes('PEDIDO_NO_ENCONTRADO')) return new EditError(404, 'Pedido no encontrado.');
  if (msg.includes('PEDIDO_NO_CANCELADO')) return new EditError(409, 'El pedido ya no está cancelado.', { code: 'MODIFICADO' });
  if (error?.code === 'PGRST202' || /could not find the function|edit_order|reopen_order/i.test(msg)) {
    return new EditError(503, 'La edición completa de pedidos aún no está activada (falta la migración 068).', { code: 'SIN_MIGRACION' });
  }
  return new EditError(500, 'No se pudo guardar el pedido. No se cambió nada.');
}

function checkConfirm(plan, { confirm, confirm_strong: strong }) {
  if (confirm !== true) throw bad('Falta confirmar los cambios.', { code: 'CONFIRMAR', preview: plan.preview });
  if (plan.preview.strong_confirm && strong !== true) {
    throw bad('Este pedido está pagado o tiene más de 30 días: confirma de nuevo que quieres ajustarlo.', { code: 'CONFIRMAR_REFORZADO', preview: plan.preview });
  }
}

async function previewEdit(ctx, orderId, changes, opts = {}) {
  const plan = await buildEditPlan(ctx, orderId, changes, opts);
  return { ...plan.preview, noop: plan.noop, expected: plan.expected };
}

async function applyEdit(ctx, orderId, changes, confirmation = {}, opts = {}) {
  const db = opts.db || supabaseAdmin;
  const plan = await buildEditPlan(ctx, orderId, changes, { ...opts, db });
  if (confirmation.expected && !sameExpected(confirmation.expected, plan.expected)) {
    throw new EditError(409, 'El pedido cambió desde la vista previa. Revisa los cambios de nuevo.', { code: 'MODIFICADO' });
  }
  if (plan.noop) return { order: plan.order, preview: plan.preview, noop: true };
  checkConfirm(plan, confirmation);
  if (plan.preview.short.length) {
    throw new EditError(409, `Stock insuficiente: ${plan.preview.short.join('; ')}. No se guardó nada.`, { code: 'SIN_STOCK', preview: plan.preview });
  }

  const { error } = await db.rpc('edit_order', {
    p_business_id: ctx.businessId, p_order_id: plan.order.id, p_expected: plan.expected,
    p_order: plan.orderPatch, p_items: plan.items, p_stock: plan.stock, p_cash: plan.cash, p_edits: plan.edits,
    p_user: ctx.userId || null, p_source: ctx.source === 'asistente' ? 'asistente' : 'panel', p_ref_type: 'order_edit',
  });
  if (error) {
    logger.error(`orderEdit.apply order=${plan.order.id}: ${error.message}`);
    throw rpcError(error);
  }
  logger.info(`[orders] edición order=${plan.order.id} user=${ctx.userId || 'desconocido'} origen=${ctx.source || 'panel'} campos=${plan.edits.map((e) => e.field).join(',')}`);
  const order = await loadOrder(db, ctx.businessId, plan.order.id);
  return { order, preview: plan.preview, statusChange: plan.statusChange };
}

async function reopenOrder(ctx, orderId, { status, confirm, confirm_strong: strong } = {}, opts = {}) {
  const db = opts.db || supabaseAdmin;
  const plan = await buildEditPlan(ctx, orderId, {}, { ...opts, db, reopen: { status } });
  checkConfirm(plan, { confirm, confirm_strong: strong });
  if (plan.preview.short.length) {
    throw new EditError(409, `No se puede reabrir: stock insuficiente para ${plan.preview.short.join('; ')}.`, { code: 'SIN_STOCK', preview: plan.preview });
  }
  const { error } = await db.rpc('reopen_order', {
    p_business_id: ctx.businessId, p_order_id: plan.order.id, p_new_status: plan.orderPatch.status, p_expected: plan.expected,
    p_stock: plan.stock, p_cash: plan.cash, p_edits: plan.edits,
    p_user: ctx.userId || null, p_source: ctx.source === 'asistente' ? 'asistente' : 'panel',
  });
  if (error) {
    logger.error(`orderEdit.reopen order=${plan.order.id}: ${error.message}`);
    throw rpcError(error);
  }
  const order = await loadOrder(db, ctx.businessId, plan.order.id);
  return { order, preview: plan.preview, statusChange: plan.statusChange };
}

async function listEdits(ctx, orderId, { db = supabaseAdmin } = {}) {
  if (!UUID_RE.test(String(orderId || ''))) throw new EditError(404, 'Pedido no encontrado.');
  const order = await must(db.from('orders').select('id').eq('id', orderId).eq('business_id', ctx.businessId).maybeSingle());
  if (!order) throw new EditError(404, 'Pedido no encontrado.');
  const { data, error } = await db.from('order_edits')
    .select('id, edit_group, user_id, source, field, before_value, after_value, created_at')
    .eq('business_id', ctx.businessId).eq('order_id', orderId)
    .order('created_at', { ascending: false }).limit(200);
  if (error) {
    // Sin la migración 068 no hay historial todavía: no es un error para el panel
    if (error.code === '42P01' || error.code === 'PGRST205' || /order_edits/.test(error.message || '')) return { edits: [], available: false };
    throw error;
  }
  return { edits: (data || []).map((e) => ({ ...e, label: FIELD_LABELS[e.field] || e.field })), available: true };
}

module.exports = {
  ORDER_STATUSES, PAYMENT_STATUSES, PAYMENT_METHODS, CANCELLED_EDITABLE, OLD_ORDER_DAYS, FIELD_LABELS,
  EditError, buildEditPlan, previewEdit, applyEdit, reopenOrder, listEdits, stockDiff, expectedOf, orderCode,
};
