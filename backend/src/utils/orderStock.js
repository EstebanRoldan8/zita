const { supabaseAdmin } = require('../config/supabase');
const logger = require('./logger');

// supabase.rpc() no lanza: devuelve { error }. Este wrapper lo convierte en excepción.
async function callAdjustStock(params) {
  const { data, error } = await supabaseAdmin.rpc('adjust_stock', params);
  if (error) throw error;
  return data;
}

// Deshace devoluciones ya aplicadas (adjust_stock negativo, type 'ajuste').
// Best-effort: si una reversión falla se registra en el log y se sigue con las demás.
async function undoRestoredItems(order, refType, restored, userId) {
  for (const item of restored) {
    try {
      await callAdjustStock({
        p_business_id: order.business_id,
        p_product_id: item.product_id,
        p_variant_id: item.variant_id || null,
        p_change: -item.quantity,
        p_type: 'ajuste',
        p_reason: 'Reversión de devolución fallida',
        p_ref_type: refType,
        p_ref_id: order.id,
        p_user: userId || null,
      });
    } catch (err) {
      logger.error(`orderStock.undo failed order=${order.id} product=${item.product_id}: ${err.message}`);
    }
  }
}

// Devuelve al inventario las unidades de cada order_item con product_id (type 'devolucion').
// Si falla un item, deshace los ya devueltos y relanza el error: o se devuelve todo o nada.
// order necesita { id, business_id }. Retorna los items devueltos (para poder deshacerlos después).
async function restoreOrderStock(order, refType, userId) {
  const { data: items, error } = await supabaseAdmin
    .from('order_items')
    .select('product_id, variant_id, quantity, description')
    .eq('order_id', order.id)
    .eq('business_id', order.business_id);
  if (error) throw error;

  const restored = [];
  for (const item of items || []) {
    if (!item.product_id || !(item.quantity > 0)) continue;
    try {
      await callAdjustStock({
        p_business_id: order.business_id,
        p_product_id: item.product_id,
        p_variant_id: item.variant_id || null,
        p_change: item.quantity,
        p_type: 'devolucion',
        p_reason: null,
        p_ref_type: refType,
        p_ref_id: order.id,
        p_user: userId || null,
      });
      restored.push(item);
    } catch (err) {
      logger.error(`orderStock.restore failed order=${order.id} product=${item.product_id}: ${err.message}`);
      await undoRestoredItems(order, refType, restored, userId);
      const wrapped = new Error(`No se pudo devolver el stock de "${item.description || 'un artículo'}".`);
      wrapped.cause = err;
      throw wrapped;
    }
  }
  return restored;
}

module.exports = { restoreOrderStock, undoRestoredItems, callAdjustStock };
