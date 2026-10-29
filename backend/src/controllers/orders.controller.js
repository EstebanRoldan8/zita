const { createUserClient } = require('../config/supabase');
const logger = require('../utils/logger');
const { parseCustomer, parseDiscount, computeTotals } = require('../utils/orderTotals');
const { restoreOrderStock, undoRestoredItems } = require('../utils/orderStock');
const { recordOrderAccounting, removeOrderAccounting } = require('../utils/orderAccounting');
const {
  loadBundles, deriveBundle, bundleSnapshot, simpleComponents, snapshotMoves, applyMoves, variantLabel: bundleVariantLabel,
} = require('../utils/bundles');

// Líneas de set de un pedido manual. El precio sale del set (nunca del body); el set y sus componentes
// se buscan SOLO en el negocio del JWT. Devuelve { byIndex: { [i]: { snapshot, moves, price, description, short } } }
// o { error } con un mensaje claro.
async function resolveSetItems(supabaseAdmin, businessId, items) {
  const ids = [...new Set(items.map((i) => i.product_id).filter(Boolean))];
  if (ids.length === 0) return { byIndex: {} };
  const { data: sets, error } = await supabaseAdmin
    .from('products')
    .select('id, name, price, stock, has_variants, is_bundle, is_active')
    .eq('business_id', businessId)
    .eq('is_bundle', true)
    .in('id', ids);
  if (error) throw error;
  if (!sets || sets.length === 0) return { byIndex: {} };
  const { componentsByBundle, variantsByProduct } = await loadBundles(supabaseAdmin, businessId, sets.map((p) => p.id));
  const byIndex = {};
  for (const [idx, item] of items.entries()) {
    const set = sets.find((p) => p.id === item.product_id);
    if (!set) continue;
    if (set.is_active === false) return { error: `El set ${set.name} está inactivo.` };
    const components = componentsByBundle[set.id] || [];
    const d = deriveBundle(set, components, variantsByProduct);
    if (d.error) return { error: `${set.name}: ${d.error}` };
    let dv = null;
    if (d.hasVariants) {
      dv = d.variants.find((v) => v.id === item.variant_id) || null;
      if (!dv) return { error: `El set ${set.name} tiene variantes, debes especificar cuál (talla/color).` };
    } else if (item.variant_id) {
      return { error: `El set ${set.name} no tiene variantes.` };
    }
    const snapshot = bundleSnapshot(set, dv, components);
    const parts = dv ? dv.components : simpleComponents(components);
    const short = parts.find((c) => (Number(c.stock) || 0) < c.quantity * item.quantity);
    byIndex[idx] = {
      snapshot,
      moves: snapshotMoves(snapshot, item.quantity),
      price: Number(set.price) || 0,
      description: dv ? `${set.name} (${bundleVariantLabel(dv.attributes)})` : set.name,
      short: short ? [short.name, short.label].filter(Boolean).join(' ') : null,
    };
  }
  return { byIndex };
}
const { isTiendaBusiness } = require('../utils/businessType');

// Best-effort: vuelve a registrar la caja de un pedido pagado cuando una operación se revierte
async function reRecordIfPaid(sb, order, country) {
  if (order?.payment_status !== 'pagado') return;
  try {
    await recordOrderAccounting(sb, order, country);
  } catch (err) {
    logger.error(`orders.reRecordIfPaid order=${order.id}: ${err.message}`);
  }
}

const PAYMENT_STATUSES = ['pendiente', 'pagado', 'fallido', 'reembolsado'];
const PAYMENT_METHODS = ['efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'wompi', 'otro'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// status <> 'cancelado' excluiría filas con status NULL (pedidos viejos): se incluyen explícitamente
const NOT_CANCELLED = 'status.is.null,status.neq.cancelado';

// undefined = no viene (no se toca); null o '' = se limpia; texto = se valida y recorta
function parseOptionalText(value, max, label) {
  if (value === undefined) return { skip: true };
  if (value === null || value === '') return { value: null };
  if (typeof value !== 'string') return { error: `${label} debe ser texto.` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `${label} no puede superar ${max} caracteres.` };
  return { value: trimmed || null };
}

function parsePaymentMethod(value) {
  if (value === undefined) return { skip: true };
  if (value === null || value === '') return { value: null };
  const method = String(value).trim().toLowerCase();
  if (!PAYMENT_METHODS.includes(method)) {
    return { error: `Método de pago inválido. Usa: ${PAYMENT_METHODS.join(', ')}.` };
  }
  return { value: method };
}

async function getAll(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { status, date, month } = req.query;

    let query = sb
      .from('orders')
      .select('*, order_items(*)')
      .eq('business_id', req.businessId);

    if (status) {
      query = query.eq('status', status);
    }

    if (date) {
      const dateObj = new Date(date);
      const nextDate = new Date(dateObj);
      nextDate.setDate(nextDate.getDate() + 1);
      query = query
        .gte('created_at', date + 'T00:00:00-05:00')
        .lt('created_at', nextDate.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) + 'T00:00:00-05:00');
    }

    if (month) {
      const [year, mon] = month.split('-');
      const startDate = new Date(year, parseInt(mon) - 1, 1);
      const endDate = new Date(year, parseInt(mon), 1);
      query = query
        .gte('created_at', startDate.toISOString())
        .lt('created_at', endDate.toISOString());
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      logger.error('orders.getAll query error: ' + error.message);
      throw error;
    }
    return res.json({ success: true, data: data || [] });
  } catch (err) {
    logger.error('orders.getAll: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al obtener pedidos.' });
  }
}

async function getById(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;

    const { data, error } = await sb
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .maybeSingle();

    // 22P02: el id no es un UUID válido, así que el pedido no existe
    if (error && error.code !== '22P02') {
      logger.error('orders.getById query error: ' + error.message);
      throw error;
    }

    if (!data) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado.' });
    }

    return res.json({ success: true, data });
  } catch (err) {
    logger.error('orders.getById: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al obtener el pedido.' });
  }
}

async function create(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { supabaseAdmin } = require('../config/supabase');
    const { PLANS } = require('../config/plans');
    const {
      client_id, delivery_type, delivery_address, notes, items,
      payment_status, payment_method, customer_email, shipping_carrier, tracking_code,
    } = req.body;

    if (!delivery_type || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Datos incompletos.' });
    }

    // Nombre y teléfono son opcionales (venta en persona sin cliente)
    const cust = parseCustomer(req.body);
    if (cust.error) return res.status(400).json({ success: false, error: cust.error });
    const { client_name, client_phone } = cust.customer;

    // client_id del body solo vale si es un cliente de ESTE negocio (el negocio sale del JWT)
    let linkedClientId = null;
    if (client_id) {
      const { data: linked } = await supabaseAdmin
        .from('clients').select('id').eq('id', String(client_id)).eq('business_id', req.businessId).maybeSingle();
      if (!linked) return res.status(400).json({ success: false, error: 'Cliente no encontrado.' });
      linkedClientId = linked.id;
    }

    // Campos opcionales de pago y envío: solo se incluyen en el insert si vienen,
    // así sin ellos el pedido se crea exactamente igual que antes.
    const extraFields = {};
    if (payment_status !== undefined && payment_status !== null && payment_status !== '') {
      const ps = String(payment_status).trim().toLowerCase();
      if (!['pendiente', 'pagado'].includes(ps)) {
        return res.status(400).json({ success: false, error: 'Estado de pago inválido al crear el pedido (pendiente o pagado).' });
      }
      extraFields.payment_status = ps;
      if (ps === 'pagado') extraFields.paid_at = new Date().toISOString();
    }
    const pm = parsePaymentMethod(payment_method);
    if (pm.error) return res.status(400).json({ success: false, error: pm.error });
    if (!pm.skip) extraFields.payment_method = pm.value;

    if (customer_email !== undefined && customer_email !== null && customer_email !== '') {
      const email = String(customer_email).trim().toLowerCase();
      if (email.length > 254 || !EMAIL_RE.test(email)) {
        return res.status(400).json({ success: false, error: 'El correo del cliente no es válido.' });
      }
      extraFields.customer_email = email;
    }
    const carrier = parseOptionalText(shipping_carrier, 100, 'La transportadora');
    if (carrier.error) return res.status(400).json({ success: false, error: carrier.error });
    if (!carrier.skip) extraFields.shipping_carrier = carrier.value;
    const tracking = parseOptionalText(tracking_code, 100, 'La guía de seguimiento');
    if (tracking.error) return res.status(400).json({ success: false, error: tracking.error });
    if (!tracking.skip) extraFields.tracking_code = tracking.value;

    // Validar límite de órdenes del mes
    const { data: bizord } = await supabaseAdmin
      .from('businesses')
      .select('plan')
      .eq('id', req.businessId)
      .single();

    const planord = bizord.plan || 'estandar';
    const limiteord = PLANS[planord].max_orders_month;

    if (limiteord !== -1) {
      const { getTimezone, getOffsetForTz } = require('../utils/timezone');
      const _tzord = getTimezone(req.business?.country);
      const _offzord = getOffsetForTz(_tzord);
      const mesActualord = new Date().toLocaleDateString('en-CA', { timeZone: _tzord }).slice(0, 7);
      const inicioMesord = `${mesActualord}-01T00:00:00${_offzord}`;
      const [yrord, moord] = mesActualord.split('-').map(Number);
      const ultimoDiaord = new Date(yrord, moord, 0).getDate();
      const finMesord = `${mesActualord}-${String(ultimoDiaord).padStart(2, '0')}T23:59:59${_offzord}`;

      const { count: countord } = await supabaseAdmin
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', req.businessId)
        .gte('created_at', inicioMesord)
        .lte('created_at', finMesord)
        .neq('status', 'cancelado');

      if (countord >= limiteord) {
        return res.status(403).json({
          success: false,
          error: 'Has alcanzado el límite de pedidos este mes de tu plan.',
          code: 'ORDERS_LIMIT_REACHED'
        });
      }
    }

    for (const item of items) {
      if (!item.quantity || item.quantity <= 0) {
        return res.status(400).json({ success: false, error: `Cantidad inválida para el artículo: ${item.name || 'sin nombre'}.` });
      }
      if (item.unit_price == null || item.unit_price < 0) {
        return res.status(400).json({ success: false, error: `Precio inválido para el artículo: ${item.name || 'sin nombre'}.` });
      }
    }

    // Sets: precio, descripción y snapshot salen del set; su variant_id derivado no se guarda (FK)
    const setInfo = await resolveSetItems(supabaseAdmin, req.businessId, items);
    if (setInfo.error) return res.status(400).json({ success: false, error: setInfo.error });
    items.forEach((item, idx) => {
      const info = setInfo.byIndex[idx];
      if (!info) return;
      item.__set = info;
      item.unit_price = info.price;
      item.description = info.description;
    });

    const validStatuses = ['recibido', 'en_proceso', 'listo', 'enviado', 'entregado', 'cancelado'];
    // El total lo calcula el servidor: subtotal + envío (los manuales no llevan) − descuento. Nunca el del cliente.
    const subtotalAmount = computeTotals(items).subtotal;
    const disc = parseDiscount(req.body.discount_amount, subtotalAmount);
    if (disc.error) return res.status(400).json({ success: false, error: disc.error });
    const totalAmount = computeTotals(items, { discount: disc.discount }).total;

    const { data: orderData, error: orderError } = await sb
      .from('orders')
      .insert([{
        business_id: req.businessId,
        client_id: linkedClientId,
        client_name,
        client_phone,
        delivery_type,
        delivery_address: delivery_address || null,
        notes: notes || null,
        status: 'recibido',
        total_amount: totalAmount,
        discount_amount: disc.discount,
        source: 'manual',
        ...extraFields,
      }])
      .select()
      .single();

    if (orderError) {
      logger.error('orders.create insert error: ' + orderError.message);
      throw orderError;
    }

    const itemsWithStock = [];
    for (const item of items) {
      if (item.__set) {
        if (item.__set.short) {
          await sb.from('orders').delete().eq('id', orderData.id);
          return res.status(400).json({
            success: false,
            error: `Stock insuficiente para ${item.description}: falta ${item.__set.short}.`
          });
        }
        itemsWithStock.push(item);
        continue;
      }
      let stockAvailable = 0;
      if (item.product_id) {
        const { data: product } = await sb
          .from('products')
          .select('stock, name, has_variants')
          .eq('id', item.product_id)
          .eq('business_id', req.businessId)
          .single();

        if (product?.has_variants && !item.variant_id) {
          await sb.from('orders').delete().eq('id', orderData.id);
          return res.status(400).json({
            success: false,
            error: `El producto ${product.name || item.description || 'sin nombre'} tiene variantes, debes especificar cuál (talla/color).`
          });
        }

        if (item.variant_id) {
          const { data: variant } = await sb
            .from('product_variants')
            .select('stock')
            .eq('id', item.variant_id)
            .eq('business_id', req.businessId)
            .single();
          stockAvailable = variant?.stock || 0;
        } else {
          stockAvailable = product?.stock || 0;
        }

        if (item.quantity > stockAvailable) {
          await sb.from('orders').delete().eq('id', orderData.id);
          return res.status(400).json({
            success: false,
            error: `Stock insuficiente para ${item.description || 'sin nombre'}. Disponible: ${stockAvailable}.`
          });
        }
      }
      itemsWithStock.push(item);
    }

    // Movimientos ya aplicados en este pedido (para revertir si algo falla)
    const processedMoves = [];
    for (const item of itemsWithStock) {
      const { error: itemError } = await sb
        .from('order_items')
        .insert({
          order_id: orderData.id,
          business_id: req.businessId,
          product_id: item.product_id || null,
          variant_id: item.__set ? null : (item.variant_id || null),
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.quantity * item.unit_price,
          ...(item.__set ? { bundle_snapshot: item.__set.snapshot } : {}),
        });

      if (itemError) {
        logger.error('orders.create item insert error: ' + itemError.message);
        await sb.from('order_items').delete().eq('order_id', orderData.id);
        await sb.from('orders').delete().eq('id', orderData.id);
        throw itemError;
      }

      if (item.product_id) {
        try {
          if (item.__set) {
            // Set: un movimiento por componente; applyMoves revierte los suyos si uno falla
            await applyMoves(item.__set.moves, {
              businessId: req.businessId, type: 'venta', refType: 'order', refId: orderData.id,
              revertReason: 'Reversión por error en creación de orden',
            }, undefined, (done, revErr) => logger.error('orders.create revert adjust_stock failed: ' + revErr.message));
            processedMoves.push(...item.__set.moves);
            continue;
          }
          // rpc() no lanza: hay que revisar error para que el rollback de abajo se ejecute
          const { error: rpcErr } = await supabaseAdmin.rpc('adjust_stock', {
            p_business_id: req.businessId,
            p_product_id: item.product_id,
            p_variant_id: item.variant_id || null,
            p_change: -item.quantity,
            p_type: 'venta',
            p_reason: null,
            p_ref_type: 'order',
            p_ref_id: orderData.id,
            p_user: null
          });
          if (rpcErr) throw rpcErr;
          processedMoves.push({ product_id: item.product_id, variant_id: item.variant_id || null, quantity: item.quantity });
        } catch (err) {
          logger.error('orders.create adjust_stock error: ' + err.message);
          for (const pItem of processedMoves) {
            if (pItem.product_id) {
              try {
                const { error: revRpcErr } = await supabaseAdmin.rpc('adjust_stock', {
                  p_business_id: req.businessId,
                  p_product_id: pItem.product_id,
                  p_variant_id: pItem.variant_id || null,
                  p_change: pItem.quantity,
                  p_type: 'ajuste',
                  p_reason: 'Reversión por error en creación de orden',
                  p_ref_type: 'order',
                  p_ref_id: orderData.id,
                  p_user: null
                });
                if (revRpcErr) throw revRpcErr;
              } catch (revErr) {
                logger.error('orders.create revert adjust_stock failed: ' + revErr.message);
              }
            }
          }
          await sb.from('order_items').delete().eq('order_id', orderData.id);
          await sb.from('orders').delete().eq('id', orderData.id);
          if (err.message?.includes('STOCK_INSUFICIENTE_O_NO_ENCONTRADO')) {
            const piece = item.__set && err.failedMove?.label ? `: falta ${err.failedMove.label}` : '';
            return res.status(400).json({
              success: false,
              error: `Stock insuficiente para ${item.description || 'sin nombre'}${piece}.`
            });
          }
          throw err;
        }
      }
    }

    const { data: fullOrder, error: fullError } = await sb
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderData.id)
      .single();

    if (fullError) throw fullError;

    // Solo tienda: un pedido que nace pagado registra su ingreso y costo en caja.
    // Si la caja falla, el pago se deshace (queda pendiente) y se avisa sin perder el pedido.
    if (extraFields.payment_status === 'pagado' && isTiendaBusiness(req.business)) {
      try {
        await recordOrderAccounting(sb, fullOrder, req.business?.country);
      } catch (accErr) {
        logger.error(`orders.create accounting order=${fullOrder.id}: ${accErr.message}`);
        const { data: reverted, error: revertErr } = await sb
          .from('orders')
          .update({ payment_status: 'pendiente', paid_at: null })
          .eq('id', fullOrder.id)
          .select('payment_status, paid_at');
        if (revertErr) logger.error('orders.create revert payment: ' + revertErr.message);
        return res.status(201).json({
          success: true,
          data: { ...fullOrder, ...(reverted?.[0] || {}) },
          warning: 'El pedido se creó, pero no se pudo registrar el ingreso en caja: quedó con pago pendiente. Márcalo como pagado de nuevo.',
        });
      }
    }

    return res.status(201).json({ success: true, data: fullOrder });
  } catch (err) {
    logger.error('orders.create: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al crear pedido.' });
  }
}

async function updateStatus(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['recibido', 'en_proceso', 'listo', 'enviado', 'entregado', 'cancelado'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Estado inválido.' });
    }

    const { data: order, error: getError } = await sb
      .from('orders')
      .select('id, status, business_id')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (getError || !order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado.' });
    }

    // 'cancelado' es terminal: cancelar de nuevo no hace nada, cualquier otro cambio se rechaza
    if (order.status === 'cancelado') {
      if (status === 'cancelado') {
        const { data: current, error: curErr } = await sb.from('orders').select('*').eq('id', id).single();
        if (curErr) throw curErr;
        return res.json({ success: true, data: current });
      }
      return res.status(400).json({ success: false, error: 'El pedido está cancelado y ya no se puede cambiar de estado.' });
    }

    if (status === 'cancelado') {
      // Reclamo atómico: solo una petición logra pasar el pedido a cancelado y devolver el stock
      const { data: claimed, error: claimErr } = await sb
        .from('orders')
        .update({ status: 'cancelado' })
        .eq('id', id)
        .eq('business_id', req.businessId)
        .or(NOT_CANCELLED)
        .select();
      if (claimErr) throw claimErr;

      if (!claimed || claimed.length === 0) {
        // Otra petición lo canceló primero: no se devuelve stock dos veces
        const { data: current, error: curErr } = await sb.from('orders').select('*').eq('id', id).single();
        if (curErr) throw curErr;
        return res.json({ success: true, data: current });
      }

      const revertCancel = async () => {
        const { error: revertErr } = await sb
          .from('orders')
          .update({ status: order.status })
          .eq('id', id)
          .eq('status', 'cancelado');
        if (revertErr) logger.error('orders.updateStatus revert status: ' + revertErr.message);
      };

      let restored;
      try {
        restored = await restoreOrderStock(order, 'order_cancel', req.user?.id);
      } catch (restoreErr) {
        logger.error('orders.updateStatus restore: ' + restoreErr.message + ' / ' + (restoreErr.cause?.message || ''));
        await revertCancel();
        return res.status(409).json({
          success: false,
          error: `No se pudo cancelar el pedido: ${restoreErr.message} El pedido y el inventario quedaron como estaban.`,
        });
      }

      // Solo tienda: un pedido cancelado deja de contar en caja
      if (isTiendaBusiness(req.business)) {
        try {
          await removeOrderAccounting(sb, order);
        } catch (accErr) {
          logger.error(`orders.updateStatus accounting order=${id}: ${accErr.message}`);
          await undoRestoredItems(order, 'order_cancel', restored, req.user?.id);
          await revertCancel();
          await reRecordIfPaid(sb, claimed[0], req.business?.country);
          return res.status(409).json({
            success: false,
            error: 'No se pudo cancelar el pedido: no se pudo quitar el ingreso de caja. El pedido y el inventario quedaron como estaban.',
          });
        }
      }

      return res.json({ success: true, data: claimed[0] });
    }

    const { data, error } = await sb
      .from('orders')
      .update({ status })
      .eq('id', id)
      .or(NOT_CANCELLED)
      .select();

    if (error) {
      logger.error('orders.updateStatus error: ' + error.message);
      throw error;
    }
    if (!data || data.length === 0) {
      return res.status(400).json({ success: false, error: 'El pedido está cancelado y ya no se puede cambiar de estado.' });
    }

    return res.json({ success: true, data: data[0] });
  } catch (err) {
    logger.error('orders.updateStatus: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al actualizar pedido.' });
  }
}

async function deleteOrder(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;

    const { data: order, error: getError } = await sb
      .from('orders')
      .select('id, status, business_id, payment_status, total_amount, client_name, client_id')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (getError || !order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado.' });
    }

    if (order.status !== 'recibido') {
      return res.status(400).json({ success: false, error: 'Solo se pueden eliminar pedidos con estado recibido.' });
    }

    // Reclamo atómico: pasa de recibido a cancelado antes de tocar el stock
    const { data: claimed, error: claimErr } = await sb
      .from('orders')
      .update({ status: 'cancelado' })
      .eq('id', id)
      .eq('business_id', req.businessId)
      .eq('status', 'recibido')
      .select('id');
    if (claimErr) throw claimErr;
    if (!claimed || claimed.length === 0) {
      return res.status(400).json({ success: false, error: 'Solo se pueden eliminar pedidos con estado recibido.' });
    }

    const revertStatus = async () => {
      const { error: revertErr } = await sb
        .from('orders')
        .update({ status: 'recibido' })
        .eq('id', id)
        .eq('status', 'cancelado');
      if (revertErr) logger.error('orders.deleteOrder revert status: ' + revertErr.message);
    };

    let restored;
    try {
      restored = await restoreOrderStock(order, 'order_delete', req.user?.id);
    } catch (restoreErr) {
      logger.error('orders.deleteOrder restore: ' + restoreErr.message + ' / ' + (restoreErr.cause?.message || ''));
      await revertStatus();
      return res.status(409).json({
        success: false,
        error: `No se pudo eliminar el pedido: ${restoreErr.message} El pedido y el inventario quedaron como estaban.`,
      });
    }

    // Solo tienda: se borra la caja del pedido de forma explícita antes de borrarlo
    // (el ON DELETE CASCADE de order_id también lo haría al borrar el pedido; así no se pisan)
    const isTienda = isTiendaBusiness(req.business);
    if (isTienda) {
      try {
        await removeOrderAccounting(sb, order);
      } catch (accErr) {
        logger.error(`orders.deleteOrder accounting order=${id}: ${accErr.message}`);
        await undoRestoredItems(order, 'order_delete', restored, req.user?.id);
        await revertStatus();
        await reRecordIfPaid(sb, order, req.business?.country);
        return res.status(500).json({
          success: false,
          error: 'No se pudo eliminar el pedido: no se pudo quitar el ingreso de caja. El pedido y el inventario quedaron como estaban.',
        });
      }
    }

    const { error: deleteError } = await sb
      .from('order_items')
      .delete()
      .eq('order_id', id);

    if (deleteError) {
      logger.error('orders.deleteOrder items error: ' + deleteError.message);
      await undoRestoredItems(order, 'order_delete', restored, req.user?.id);
      await revertStatus();
      if (isTienda) await reRecordIfPaid(sb, order, req.business?.country);
      return res.status(500).json({ success: false, error: 'Error al eliminar pedido. El pedido y el inventario quedaron como estaban.' });
    }

    const { data, error } = await sb
      .from('orders')
      .delete()
      .eq('id', id)
      .select('id');

    if (error || !data || data.length === 0) {
      // Los items ya se borraron y el stock ya volvió: queda como pedido cancelado (estado consistente)
      logger.error('orders.deleteOrder error: ' + (error?.message || 'no row deleted'));
      return res.status(500).json({
        success: false,
        error: 'El stock se devolvió y el pedido quedó cancelado, pero no se pudo eliminar. Intenta de nuevo más tarde.',
      });
    }

    return res.json({ success: true, data: { id } });
  } catch (err) {
    logger.error('orders.deleteOrder: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al eliminar pedido.' });
  }
}

// PATCH /:id/payment — no toca el stock
async function updatePayment(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;
    const { payment_status, payment_method } = req.body || {};

    const ps = typeof payment_status === 'string' ? payment_status.trim().toLowerCase() : '';
    if (!PAYMENT_STATUSES.includes(ps)) {
      return res.status(400).json({ success: false, error: `Estado de pago inválido. Usa: ${PAYMENT_STATUSES.join(', ')}.` });
    }
    const pm = parsePaymentMethod(payment_method);
    if (pm.error) return res.status(400).json({ success: false, error: pm.error });

    const { data: order, error: getError } = await sb
      .from('orders')
      .select('id, business_id, status, paid_at, payment_status, payment_method, total_amount, client_name, client_id')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .maybeSingle();
    if (getError || !order) return res.status(404).json({ success: false, error: 'Pedido no encontrado.' });
    if (order.status === 'cancelado') {
      return res.status(400).json({ success: false, error: 'No se puede cambiar el pago de un pedido cancelado.' });
    }

    const updates = { payment_status: ps, updated_at: new Date().toISOString() };
    if (ps === 'pagado' && !order.paid_at) updates.paid_at = new Date().toISOString();
    if (ps === 'pendiente') updates.paid_at = null;
    if (!pm.skip) updates.payment_method = pm.value;

    const { data, error } = await sb
      .from('orders')
      .update(updates)
      .eq('id', id)
      .eq('business_id', req.businessId)
      .or(NOT_CANCELLED)
      .select();
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(400).json({ success: false, error: 'No se puede cambiar el pago de un pedido cancelado.' });
    }

    // Solo tienda: pagado registra ingreso y costo en caja; salir de pagado los borra.
    // Todo o nada: si la caja falla, el pago vuelve a como estaba.
    if (isTiendaBusiness(req.business)) {
      const wasPaid = order.payment_status === 'pagado';
      try {
        if (ps === 'pagado') await recordOrderAccounting(sb, data[0], req.business?.country);
        else if (wasPaid) await removeOrderAccounting(sb, order);
      } catch (accErr) {
        logger.error(`orders.updatePayment accounting order=${id}: ${accErr.message}`);
        const { error: revertErr } = await sb
          .from('orders')
          .update({ payment_status: order.payment_status, paid_at: order.paid_at, payment_method: order.payment_method })
          .eq('id', id)
          .eq('business_id', req.businessId);
        if (revertErr) logger.error('orders.updatePayment revert payment: ' + revertErr.message);
        // Si se alcanzó a borrar el ingreso pero no el egreso, se vuelve a registrar
        if (ps !== 'pagado' && wasPaid) await reRecordIfPaid(sb, order, req.business?.country);
        return res.status(500).json({
          success: false,
          error: ps === 'pagado'
            ? 'No se pudo registrar el ingreso en caja. El pago no se guardó; intenta de nuevo.'
            : 'No se pudo quitar el ingreso de caja. El pago no se cambió; intenta de nuevo.',
        });
      }
    }

    return res.json({ success: true, data: data[0] });
  } catch (err) {
    logger.error('orders.updatePayment: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al actualizar el pago del pedido.' });
  }
}

// PATCH /:id/shipping
async function updateShipping(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;
    const { shipping_carrier, tracking_code } = req.body || {};

    const carrier = parseOptionalText(shipping_carrier, 100, 'La transportadora');
    if (carrier.error) return res.status(400).json({ success: false, error: carrier.error });
    const tracking = parseOptionalText(tracking_code, 100, 'La guía de seguimiento');
    if (tracking.error) return res.status(400).json({ success: false, error: tracking.error });
    if (carrier.skip && tracking.skip) {
      return res.status(400).json({ success: false, error: 'Envía la transportadora o la guía de seguimiento.' });
    }

    const { data: order, error: getError } = await sb
      .from('orders')
      .select('id, status')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .maybeSingle();
    if (getError || !order) return res.status(404).json({ success: false, error: 'Pedido no encontrado.' });
    if (order.status === 'cancelado') {
      return res.status(400).json({ success: false, error: 'No se puede cambiar el envío de un pedido cancelado.' });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (!carrier.skip) updates.shipping_carrier = carrier.value;
    if (!tracking.skip) updates.tracking_code = tracking.value;

    const { data, error } = await sb
      .from('orders')
      .update(updates)
      .eq('id', id)
      .eq('business_id', req.businessId)
      .or(NOT_CANCELLED)
      .select();
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(400).json({ success: false, error: 'No se puede cambiar el envío de un pedido cancelado.' });
    }
    return res.json({ success: true, data: data[0] });
  } catch (err) {
    logger.error('orders.updateShipping: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al actualizar el envío del pedido.' });
  }
}

module.exports = {
  getAll, getById, create, updateStatus, deleteOrder, updatePayment, updateShipping,
};
