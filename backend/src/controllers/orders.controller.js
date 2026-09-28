const { createUserClient } = require('../config/supabase');
const logger = require('../utils/logger');

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
      .single();

    if (error) {
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
    const { client_id, client_name, client_phone, delivery_type, delivery_address, notes, items } = req.body;

    if (!client_name || !client_phone || !delivery_type || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Datos incompletos.' });
    }

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

    const validStatuses = ['recibido', 'en_proceso', 'listo', 'enviado', 'entregado', 'cancelado'];
    const totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);

    const { data: orderData, error: orderError } = await sb
      .from('orders')
      .insert([{
        business_id: req.businessId,
        client_id: client_id || null,
        client_name,
        client_phone,
        delivery_type,
        delivery_address: delivery_address || null,
        notes: notes || null,
        status: 'recibido',
        total_amount: totalAmount,
        source: 'manual',
      }])
      .select()
      .single();

    if (orderError) {
      logger.error('orders.create insert error: ' + orderError.message);
      throw orderError;
    }

    const itemsWithStock = [];
    for (const item of items) {
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

    const processedItems = [];
    for (const item of itemsWithStock) {
      const { error: itemError } = await sb
        .from('order_items')
        .insert({
          order_id: orderData.id,
          business_id: req.businessId,
          product_id: item.product_id || null,
          variant_id: item.variant_id || null,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.quantity * item.unit_price,
        });

      if (itemError) {
        logger.error('orders.create item insert error: ' + itemError.message);
        await sb.from('order_items').delete().eq('order_id', orderData.id);
        await sb.from('orders').delete().eq('id', orderData.id);
        throw itemError;
      }

      if (item.product_id) {
        try {
          await supabaseAdmin.rpc('adjust_stock', {
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
          processedItems.push(item);
        } catch (err) {
          logger.error('orders.create adjust_stock error: ' + err.message);
          for (const pItem of processedItems) {
            if (pItem.product_id) {
              try {
                await supabaseAdmin.rpc('adjust_stock', {
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
              } catch (revErr) {
                logger.error('orders.create revert adjust_stock failed: ' + revErr.message);
              }
            }
          }
          await sb.from('order_items').delete().eq('order_id', orderData.id);
          await sb.from('orders').delete().eq('id', orderData.id);
          if (err.message?.includes('STOCK_INSUFICIENTE_O_NO_ENCONTRADO')) {
            return res.status(400).json({
              success: false,
              error: `Stock insuficiente para ${item.description || 'sin nombre'}.`
            });
          }
          throw err;
        }
      } else {
        processedItems.push(item);
      }
    }

    const { data: fullOrder, error: fullError } = await sb
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderData.id)
      .single();

    if (fullError) throw fullError;

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
      .select('id')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (getError || !order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado.' });
    }

    const { data, error } = await sb
      .from('orders')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('orders.updateStatus error: ' + error.message);
      throw error;
    }

    return res.json({ success: true, data });
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
      .select('status')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (getError || !order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado.' });
    }

    if (order.status !== 'recibido') {
      return res.status(400).json({ success: false, error: 'Solo se pueden eliminar pedidos con estado recibido.' });
    }

    const { error: deleteError } = await sb
      .from('order_items')
      .delete()
      .eq('order_id', id);

    if (deleteError) {
      logger.error('orders.deleteOrder items error: ' + deleteError.message);
      throw deleteError;
    }

    const { data, error } = await sb
      .from('orders')
      .delete()
      .eq('id', id)
      .select('id');

    if (error) {
      logger.error('orders.deleteOrder error: ' + error.message);
      throw error;
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado.' });
    }

    return res.json({ success: true, data: { id } });
  } catch (err) {
    logger.error('orders.deleteOrder: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al eliminar pedido.' });
  }
}

module.exports = {
  getAll, getById, create, updateStatus, deleteOrder,
};
