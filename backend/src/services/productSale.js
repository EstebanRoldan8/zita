// Venta presencial de un producto (compartida por el dueño y el panel del empleado):
// descuenta stock con el RPC adjust_stock, registra product_sales, el ingreso (productos) y,
// si el producto tiene costo, el egreso del costo. `db` es el cliente del dueño (RLS) o el admin.
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { getTimezone } = require('../utils/timezone');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOLD_VIA = ['presencial', 'whatsapp'];

const fail = (status, error) => ({ status, body: { success: false, error } });

// input: { quantity, client_id, appointment_id, sold_via, variant_id }
// ctx:   { db, businessId, productId, country, userId, soldByEmployeeId? }
// Devuelve { status, body } listo para responder.
async function sellProduct(ctx, input) {
  const { db, businessId, productId, country, userId, soldByEmployeeId } = ctx;
  const { quantity, client_id, appointment_id, sold_via = 'presencial', variant_id } = input || {};

  const qty = Number(quantity);
  if (!qty || qty <= 0 || !Number.isInteger(qty)) {
    return fail(400, 'La cantidad debe ser un número entero positivo.');
  }
  if (!SOLD_VIA.includes(sold_via)) return fail(400, 'Canal de venta inválido.');
  for (const [v, label] of [[client_id, 'Cliente'], [appointment_id, 'Cita'], [variant_id, 'Variante']]) {
    if (v != null && v !== '' && (typeof v !== 'string' || !UUID_RE.test(v))) return fail(400, `${label} inválido.`);
  }

  const { data: product, error: pErr } = await db
    .from('products').select('*').eq('id', productId).eq('business_id', businessId).single();
  if (pErr || !product) return fail(404, 'Producto no encontrado.');
  if (!product.is_active) return fail(400, 'El producto no está activo.');
  if (product.is_bundle) {
    return fail(400, 'Los sets no se venden desde caja: registra la venta como pedido, que descuenta cada producto del set.');
  }
  if (product.has_variants && !variant_id) {
    return fail(400, 'Este producto tiene variantes, debes especificar cuál (talla/color).');
  }

  // Cliente y cita referenciados deben ser de este negocio (y la cita, del empleado si vende un empleado)
  if (client_id) {
    const { data: c } = await db.from('clients').select('id').eq('id', client_id).eq('business_id', businessId).maybeSingle();
    if (!c) return fail(400, 'Cliente no encontrado.');
  }
  if (appointment_id) {
    let q = db.from('appointments').select('id').eq('id', appointment_id).eq('business_id', businessId);
    if (soldByEmployeeId) q = q.eq('employee_id', soldByEmployeeId);
    const { data: a } = await q.maybeSingle();
    if (!a) return fail(400, 'Cita no encontrada.');
  }

  if (product.has_variants && variant_id) {
    const { data: variant, error: varErr } = await db
      .from('product_variants')
      .select('*')
      .eq('id', variant_id)
      .eq('product_id', productId)
      .eq('business_id', businessId)
      .single();
    if (varErr || !variant) return fail(404, 'Variante no encontrada.');
  }

  const totalAmount = Number(product.price) * qty;
  let newStock;
  // El movimiento de inventario queda enlazado al registro de la venta (product_sales.id)
  const saleId = crypto.randomUUID();

  try {
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('adjust_stock', {
      p_business_id: businessId,
      p_product_id: productId,
      p_variant_id: variant_id || null,
      p_change: -qty,
      p_type: 'venta',
      p_reason: null,
      p_ref_type: 'product_sale',
      p_ref_id: saleId,
      p_user: userId || null,
    });
    if (rpcError) throw rpcError;
    newStock = rpcData;
  } catch (err) {
    if (err.message?.includes('STOCK_INSUFICIENTE_O_NO_ENCONTRADO')) {
      // Se consulta después del fallo (sin pre-chequeo) para no reabrir la condición de carrera
      const { data: current } = variant_id
        ? await db.from('product_variants').select('stock').eq('id', variant_id).eq('business_id', businessId).maybeSingle()
        : await db.from('products').select('stock').eq('id', productId).eq('business_id', businessId).maybeSingle();
      if (current && current.stock != null) return fail(400, `Stock insuficiente. Disponible: ${current.stock}.`);
      return fail(400, 'Ya no hay stock suficiente de este producto.');
    }
    throw err;
  }

  const sale = {
    id:             saleId,
    business_id:    businessId,
    product_id:     productId,
    variant_id:     variant_id || null,
    quantity:       qty,
    total_amount:   totalAmount,
    client_id:      client_id || null,
    appointment_id: appointment_id || null,
    sold_via,
  };
  // Solo cuando vende un empleado (requiere la migración 066); la venta del dueño no toca la columna
  if (soldByEmployeeId) sale.sold_by_employee_id = soldByEmployeeId;

  const { error: saleErr } = await db.from('product_sales').insert(sale);
  if (saleErr) throw saleErr;

  const saleDate = new Date().toLocaleDateString('en-CA', { timeZone: getTimezone(country) });

  const { data: incomeData, error: incomeErr } = await db
    .from('income')
    .insert({
      business_id: businessId,
      amount:      totalAmount,
      category:    'productos',
      description: `Venta: ${product.name}${qty > 1 ? ` ×${qty}` : ''}`,
      date:        saleDate,
      client_id:   client_id || null,
      source:      'product_sale',
    })
    .select('id');
  if (incomeErr || !incomeData || incomeData.length === 0) {
    logger.warn('products.sell income: ' + (incomeErr?.message || 'no row inserted'));
  }

  if (product.cost_price != null) {
    const costoTotal = Number(product.cost_price) * qty;
    const { data: expData, error: expErr } = await db
      .from('expenses')
      .insert({
        business_id: businessId,
        amount:      costoTotal,
        category:    'productos',
        description: `Costo de venta: ${product.name} (${qty} unidades)`,
        date:        saleDate,
      })
      .select('id');
    if (expErr || !expData || expData.length === 0) {
      logger.warn('products.sell expense: ' + (expErr?.message || 'no row inserted'));
    }
  }

  return { status: 200, body: { success: true, data: { stock: newStock, total_amount: totalAmount } } };
}

module.exports = { sellProduct };
