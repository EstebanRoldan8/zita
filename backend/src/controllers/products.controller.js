const { createUserClient } = require('../config/supabase');
const logger = require('../utils/logger');

async function getAll(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { includeInactive } = req.query;

    let query = sb
      .from('products')
      .select('*')
      .eq('business_id', req.businessId);

    if (includeInactive !== 'true') {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query.order('name', { ascending: true, nullsFirst: false });
    if (error) {
      logger.error('products.getAll query error: ' + error.message);
      throw error;
    }
    return res.json({ success: true, data: data || [] });
  } catch (err) {
    logger.error('products.getAll: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al obtener productos.' });
  }
}

async function getLowStock(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { data, error } = await sb
      .from('products')
      .select('*')
      .eq('business_id', req.businessId)
      .eq('is_active', true)
      .order('stock');
    if (error) throw error;
    const lowStock = (data || []).filter((p) => p.stock <= p.min_stock);
    return res.json({ success: true, data: lowStock });
  } catch (err) {
    logger.error('products.getLowStock: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al obtener productos con stock bajo.' });
  }
}

async function getSales(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const now = new Date();
    const todayCol = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const [cy, cm] = todayCol.slice(0, 7).split('-').map(Number);
    const monthStart = `${todayCol.slice(0, 7)}-01`;
    const monthEnd   = `${todayCol.slice(0, 7)}-${String(new Date(cy, cm, 0).getDate()).padStart(2, '0')}`;

    const { data, error } = await sb
      .from('product_sales')
      .select('*, products(name, category)')
      .gte('created_at', `${monthStart}T00:00:00`)
      .lte('created_at', `${monthEnd}T23:59:59`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('products.getSales: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al obtener ventas de productos.' });
  }
}

async function create(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { name, description, price, stock, min_stock, category, has_variants } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'El nombre del producto es obligatorio.' });
    if (price === undefined || Number(price) < 0) return res.status(400).json({ success: false, error: 'El precio debe ser mayor o igual a 0.' });

    const payload = {
      business_id: req.businessId,
      name:        name.trim(),
      price:       Number(price),
      stock:       has_variants ? 0 : (Number(stock) || 0),
      has_variants: Boolean(has_variants) || false,
    };
    if (description !== undefined) payload.description = description?.trim() || null;
    if (min_stock  !== undefined) payload.min_stock  = Number(min_stock);
    if (category   !== undefined) payload.category   = category?.trim() || null;

    const { data, error } = await sb
      .from('products')
      .insert(payload)
      .select()
      .single();

    if (error) {
      logger.error('products.create supabase error: ' + JSON.stringify(error));
      return res.status(400).json({ success: false, error: error.message || 'Error al crear el producto.' });
    }
    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error('products.create: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al crear el producto.' });
  }
}

async function update(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;
    const { name, description, price, stock, min_stock, category, has_variants } = req.body;

    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (price !== undefined) updates.price = Number(price);
    if (stock !== undefined) updates.stock = has_variants ? 0 : Number(stock);
    if (min_stock !== undefined) updates.min_stock = Number(min_stock);
    if (category !== undefined) updates.category = category?.trim() || null;
    if (has_variants !== undefined) updates.has_variants = Boolean(has_variants);

    const { data, error } = await sb
      .from('products')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('products.update: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al actualizar el producto.' });
  }
}

async function toggleProduct(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;

    const { data: product, error: getErr } = await sb
      .from('products')
      .select('id, is_active')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (getErr || !product) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    }

    const { data, error } = await sb
      .from('products')
      .update({ is_active: !product.is_active, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('products.toggleProduct: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al cambiar estado del producto.' });
  }
}

async function deactivate(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;
    const { error } = await sb
      .from('products')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    return res.json({ success: true, data: { id } });
  } catch (err) {
    logger.error('products.deactivate: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al desactivar el producto.' });
  }
}

async function deleteProduct(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;

    const { data: product, error: getErr } = await sb
      .from('products')
      .select('id, name')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (getErr || !product) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    }

    const { error } = await sb
      .from('products')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return res.json({ success: true, message: 'Producto eliminado' });
  } catch (err) {
    logger.error('products.deleteProduct: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al eliminar el producto.' });
  }
}

async function sell(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;
    const { quantity, client_id, appointment_id, sold_via = 'presencial', variant_id } = req.body;

    const qty = Number(quantity);
    if (!qty || qty <= 0 || !Number.isInteger(qty)) {
      return res.status(400).json({ success: false, error: 'La cantidad debe ser un número entero positivo.' });
    }

    const { data: product, error: pErr } = await sb
      .from('products').select('*').eq('id', id).single();
    if (pErr || !product) return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    if (!product.is_active) return res.status(400).json({ success: false, error: 'El producto no está activo.' });

    let availableStock = product.stock;
    let variantRecord = null;

    if (product.has_variants && variant_id) {
      const { data: variant, error: varErr } = await sb
        .from('product_variants')
        .select('*')
        .eq('id', variant_id)
        .eq('product_id', id)
        .eq('business_id', req.businessId)
        .single();
      if (varErr || !variant) {
        return res.status(404).json({ success: false, error: 'Variante no encontrada.' });
      }
      variantRecord = variant;
      availableStock = variant.stock;
    }

    if (availableStock < qty) {
      return res.status(400).json({ success: false, error: `Stock insuficiente. Disponible: ${availableStock}.` });
    }

    const totalAmount = Number(product.price) * qty;
    const newStock = availableStock - qty;

    if (variantRecord) {
      const { error: varUpdateErr } = await sb
        .from('product_variants')
        .update({ stock: newStock })
        .eq('id', variant_id);
      if (varUpdateErr) throw varUpdateErr;
    } else {
      const { error: updateErr } = await sb
        .from('products')
        .update({ stock: newStock, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (updateErr) throw updateErr;
    }

    const { error: saleErr } = await sb
      .from('product_sales')
      .insert({
        business_id:    req.businessId,
        product_id:     id,
        variant_id:     variant_id || null,
        quantity:       qty,
        total_amount:   totalAmount,
        client_id:      client_id || null,
        appointment_id: appointment_id || null,
        sold_via,
      });
    if (saleErr) throw saleErr;

    const { error: incomeErr } = await sb
      .from('income')
      .insert({
        business_id: req.businessId,
        amount:      totalAmount,
        category:    'productos',
        description: `Venta: ${product.name}${qty > 1 ? ` ×${qty}` : ''}`,
        date:        new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }),
      });
    if (incomeErr) logger.warn('products.sell income: ' + incomeErr.message);

    return res.json({ success: true, data: { stock: newStock, total_amount: totalAmount } });
  } catch (err) {
    logger.error('products.sell: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al registrar la venta.' });
  }
}

async function uploadImage(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se adjuntó ninguna imagen.' });
    }

    const { data: product, error: pErr } = await sb
      .from('products')
      .select('id, business_id')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (pErr || !product) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    }

    const timestamp = Date.now();
    const fileName = `${id}-${timestamp}`;
    const filePath = `products/${req.businessId}/${fileName}`;

    const { error: uploadErr } = await sb.storage
      .from('product-images')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadErr) {
      logger.error('products.uploadImage storage error: ' + uploadErr.message);
      return res.status(400).json({ success: false, error: 'Error al subir la imagen.' });
    }

    const { data: { publicUrl } } = sb.storage
      .from('product-images')
      .getPublicUrl(filePath);

    const { error: updateErr } = await sb
      .from('products')
      .update({ image_url: publicUrl })
      .eq('id', id);

    if (updateErr) throw updateErr;

    return res.json({ success: true, data: { image_url: publicUrl } });
  } catch (err) {
    logger.error('products.uploadImage: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al subir la imagen.' });
  }
}

module.exports = { getAll, getLowStock, getSales, create, update, toggleProduct, deactivate, deleteProduct, sell, uploadImage };
