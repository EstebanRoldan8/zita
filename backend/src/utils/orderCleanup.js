// Limpieza de un pedido web que no pudo completarse. Los helpers reciben el cliente de Supabase y el
// logger para poder probarlos sin base de datos. Los logs llevan solo el id del pedido y el mensaje
// del error (nunca nombre, teléfono, dirección ni correo).

// Borra el pedido y sus ítems. Revisa el {error} de cada borrado (supabase-js no lanza). Devuelve true si
// ambos se borraron; si no, deja un log con el id del pedido y el mensaje.
async function discardOrder(db, log, { orderId, businessId }) {
  let ok = true;
  const items = await db.from('order_items').delete().eq('order_id', orderId);
  if (items?.error) {
    ok = false;
    log.error(`store.createOrder cleanup order_items failed order=${orderId}: ${items.error.message}`);
  }
  const order = await db.from('orders').delete().eq('id', orderId).eq('business_id', businessId);
  if (order?.error) {
    ok = false;
    log.error(`store.createOrder cleanup orders failed order=${orderId}: ${order.error.message}`);
  }
  return ok;
}

// Si un revert de stock falló, el inventario ya no coincide con el pedido: NO se borra (se perdería el
// rastro). Se pasa a 'cancelado' (estado terminal que ya existe: el panel no lo vuelve a tocar), se
// libera la idempotency_key para que un reintento cree un pedido nuevo y se deja una marca en notes
// para que alguien revise el inventario. Devuelve true si la marca quedó guardada.
async function flagForReview(db, log, { orderId, businessId }) {
  const { error } = await db
    .from('orders')
    .update({ status: 'cancelado', idempotency_key: null, notes: '[REVISAR STOCK] Falló la reversión de inventario de este pedido web.' })
    .eq('id', orderId)
    .eq('business_id', businessId);
  if (error) {
    log.error(`store.createOrder flag-for-review failed order=${orderId}: ${error.message}`);
    return false;
  }
  log.error(`store.createOrder order=${orderId} cancelado y marcado [REVISAR STOCK]: revert de inventario incompleto`);
  return true;
}

module.exports = { discardOrder, flagForReview };
