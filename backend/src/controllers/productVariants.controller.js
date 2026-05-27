const { createUserClient } = require('../config/supabase');
const logger = require('../utils/logger');

async function getAll(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { productId } = req.params;

    const { data, error } = await sb
      .from('product_variants')
      .select('*')
      .eq('product_id', productId)
      .eq('business_id', req.businessId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return res.json({ success: true, data: data || [] });
  } catch (err) {
    logger.error('productVariants.getAll: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al obtener variantes.' });
  }
}

async function create(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { productId } = req.params;
    const { attributes, stock } = req.body;

    if (!attributes || typeof attributes !== 'object') {
      return res.status(400).json({ success: false, error: 'Los atributos deben ser un objeto válido.' });
    }

    if (stock === undefined || Number(stock) < 0) {
      return res.status(400).json({ success: false, error: 'El stock debe ser mayor o igual a 0.' });
    }

    const { data: product, error: productErr } = await sb
      .from('products')
      .select('id')
      .eq('id', productId)
      .eq('business_id', req.businessId)
      .single();

    if (productErr || !product) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    }

    const payload = {
      product_id: productId,
      business_id: req.businessId,
      attributes,
      stock: Number(stock),
    };

    const { data, error } = await sb
      .from('product_variants')
      .insert(payload)
      .select()
      .single();

    if (error) {
      logger.error('productVariants.create supabase error: ' + JSON.stringify(error));
      return res.status(400).json({ success: false, error: error.message || 'Error al crear la variante.' });
    }

    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error('productVariants.create: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al crear la variante.' });
  }
}

async function update(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { productId, variantId } = req.params;
    const { attributes, stock, is_active } = req.body;

    const { data: variant, error: getErr } = await sb
      .from('product_variants')
      .select('id')
      .eq('id', variantId)
      .eq('product_id', productId)
      .eq('business_id', req.businessId)
      .single();

    if (getErr || !variant) {
      return res.status(404).json({ success: false, error: 'Variante no encontrada.' });
    }

    const updates = {};
    if (attributes !== undefined && typeof attributes === 'object') {
      updates.attributes = attributes;
    }
    if (stock !== undefined) {
      if (Number(stock) < 0) {
        return res.status(400).json({ success: false, error: 'El stock debe ser mayor o igual a 0.' });
      }
      updates.stock = Number(stock);
    }
    if (is_active !== undefined) {
      updates.is_active = Boolean(is_active);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No hay cambios para actualizar.' });
    }

    const { data, error } = await sb
      .from('product_variants')
      .update(updates)
      .eq('id', variantId)
      .select()
      .single();

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (err) {
    logger.error('productVariants.update: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al actualizar la variante.' });
  }
}

async function deactivate(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { productId, variantId } = req.params;

    const { data: variant, error: getErr } = await sb
      .from('product_variants')
      .select('id')
      .eq('id', variantId)
      .eq('product_id', productId)
      .eq('business_id', req.businessId)
      .single();

    if (getErr || !variant) {
      return res.status(404).json({ success: false, error: 'Variante no encontrada.' });
    }

    const { error } = await sb
      .from('product_variants')
      .update({ is_active: false })
      .eq('id', variantId);

    if (error) throw error;

    return res.json({ success: true, data: { id: variantId } });
  } catch (err) {
    logger.error('productVariants.deactivate: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al desactivar la variante.' });
  }
}

module.exports = {
  getAll,
  create,
  update,
  deactivate,
};
