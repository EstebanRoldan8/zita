const logger = require('./logger');
const { getTimezone } = require('./timezone');

// Ingreso y costo en caja de un pedido de tienda pagado. Mismo patrón que products.sell():
// ingreso category 'productos'; egreso "Costo de venta: ..." solo si hay cost_price.
// Ambos llevan order_id: los índices únicos parciales (migración 053) impiden duplicados.

const isUniqueViolation = (err) => err?.code === '23505';

// Suma quantity × cost_price de los items con producto que tengan costo definido.
// Usa el cost_price vigente del producto al momento de registrar el pago.
// Líneas de set (bundle_snapshot): suma de los costos de sus componentes GUARDADOS en el snapshot,
// nunca el cost_price del set; un pedido viejo no cambia si después se edita el set.
async function computeOrderCost(client, order) {
  const { data: items, error } = await client
    .from('order_items')
    .select('product_id, quantity, bundle_snapshot')
    .eq('order_id', order.id)
    .eq('business_id', order.business_id);
  if (error) throw error;

  let cost = 0;
  let hasCost = false;
  const { snapshotCost } = require('./bundles');
  for (const item of items || []) {
    if (!item.bundle_snapshot) continue;
    const c = snapshotCost(item.bundle_snapshot, item.quantity);
    if (c.hasCost) { hasCost = true; cost += c.cost; }
  }
  const plain = (items || []).filter((i) => !i.bundle_snapshot);
  const productIds = [...new Set(plain.map((i) => i.product_id).filter(Boolean))];
  if (productIds.length === 0) return { cost, hasCost };

  const { data: products, error: pErr } = await client
    .from('products')
    .select('id, cost_price')
    .eq('business_id', order.business_id)
    .in('id', productIds);
  if (pErr) throw pErr;

  const costById = Object.fromEntries((products || []).map((p) => [p.id, p.cost_price]));
  for (const item of plain) {
    const unitCost = costById[item.product_id];
    if (item.product_id && unitCost != null) {
      hasCost = true;
      cost += Number(item.quantity || 0) * Number(unitCost);
    }
  }
  return { cost, hasCost };
}

// Registra el ingreso (y el egreso de costo, si aplica). Idempotente: si ya existen, no duplica.
// Todo o nada: si el egreso falla, borra el ingreso que se acaba de crear y relanza.
// order necesita { id, business_id, total_amount, client_name, client_id }.
async function recordOrderAccounting(client, order, country) {
  const date = new Date().toLocaleDateString('en-CA', { timeZone: getTimezone(country) });
  const name = order.client_name || 'sin nombre';

  let createdIncomeId = null;
  const amount = Number(order.total_amount) || 0;
  // income.amount tiene CHECK (amount > 0): un pedido en $0 no genera ingreso
  if (amount > 0) {
    const { data, error } = await client
      .from('income')
      .insert({
        business_id: order.business_id,
        amount,
        category: 'productos',
        source: 'order',
        description: `Pedido: ${name}`,
        date,
        client_id: order.client_id || null,
        order_id: order.id,
      })
      .select('id');
    if (error && !isUniqueViolation(error)) throw error;
    if (!error) createdIncomeId = data?.[0]?.id || null;
  }

  try {
    const { cost, hasCost } = await computeOrderCost(client, order);
    if (hasCost && cost > 0) {
      const { error } = await client
        .from('expenses')
        .insert({
          business_id: order.business_id,
          amount: cost,
          category: 'productos',
          description: `Costo de venta: Pedido ${name}`,
          date,
          order_id: order.id,
        });
      if (error && !isUniqueViolation(error)) throw error;
    }
  } catch (err) {
    if (createdIncomeId) {
      const { error: undoErr } = await client.from('income').delete().eq('id', createdIncomeId);
      if (undoErr) logger.error(`orderAccounting.record undo income failed order=${order.id}: ${undoErr.message}`);
    }
    throw err;
  }
}

// Borra el ingreso y el egreso ligados al pedido (no falla si no existen).
async function removeOrderAccounting(client, order) {
  const { error: incomeErr } = await client
    .from('income')
    .delete()
    .eq('order_id', order.id)
    .eq('business_id', order.business_id);
  if (incomeErr) throw incomeErr;

  const { error: expenseErr } = await client
    .from('expenses')
    .delete()
    .eq('order_id', order.id)
    .eq('business_id', order.business_id);
  if (expenseErr) throw expenseErr;
}

module.exports = { recordOrderAccounting, removeOrderAccounting };
