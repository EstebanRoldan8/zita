const { createUserClient, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { generarSku } = require('../utils/sku');

// Misma fórmula que adjust_stock: products.stock = suma de variantes activas.
// Se usa cuando cambia el conjunto de variantes activas sin mover unidades (activar/desactivar).
async function recalcProductStock(productId, businessId) {
  const { data: rows, error } = await supabaseAdmin
    .from('product_variants')
    .select('stock')
    .eq('product_id', productId)
    .eq('business_id', businessId)
    .eq('is_active', true);
  if (error) throw error;
  const total = (rows || []).reduce((s, r) => s + (r.stock || 0), 0);
  const { error: upErr } = await supabaseAdmin
    .from('products')
    .update({ stock: total, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .eq('business_id', businessId);
  if (upErr) throw upErr;
  return total;
}

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
    const admin = supabaseAdmin;
    const { productId } = req.params;
    const { attributes, stock, sku } = req.body;

    if (!attributes || typeof attributes !== 'object') {
      return res.status(400).json({ success: false, error: 'Los atributos deben ser un objeto válido.' });
    }

    if (stock === undefined || Number(stock) < 0) {
      return res.status(400).json({ success: false, error: 'El stock debe ser mayor o igual a 0.' });
    }

    const { data: product, error: productErr } = await sb
      .from('products')
      .select('id, category, name, stock, has_variants, is_bundle')
      .eq('id', productId)
      .eq('business_id', req.businessId)
      .single();

    if (productErr || !product) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    }
    // Un set no tiene variantes propias: se derivan de sus productos (la base también lo impide)
    if (product.is_bundle) {
      return res.status(400).json({ success: false, error: 'Un set no tiene variantes propias: sus tallas y colores salen de los productos que lo forman.' });
    }

    // adjust_stock recalcula products.stock como suma de variantes: si el producto aún no
    // tenía variantes y tiene stock propio, esas unidades se perderían sin movimiento.
    if (!product.has_variants && product.stock > 0) {
      const n = product.stock;
      return res.status(400).json({
        success: false,
        error: `Este producto tiene ${n} unidad${n === 1 ? '' : 'es'} en stock. Ajusta el stock a 0 antes de activar variantes, para no perder esas unidades.`,
      });
    }

    let finalSku = sku?.trim() || null;
    if (!finalSku) {
      finalSku = generarSku(product.category, product.name, attributes);
    }

    if (finalSku) {
      let skuCandidate = finalSku;
      let counter = 2;
      let skuExists = true;
      while (skuExists) {
        const { data: existing } = await sb
          .from('product_variants')
          .select('id')
          .eq('business_id', req.businessId)
          .eq('sku', skuCandidate)
          .single();
        if (!existing) {
          skuExists = false;
          finalSku = skuCandidate;
        } else {
          skuCandidate = `${finalSku}-${counter}`;
          counter++;
        }
      }
    }

    const payload = {
      product_id: productId,
      business_id: req.businessId,
      attributes,
      stock: 0,
    };
    if (finalSku) payload.sku = finalSku;

    const { data, error } = await sb
      .from('product_variants')
      .insert(payload)
      .select()
      .single();

    if (error) {
      logger.error('productVariants.create supabase error: ' + JSON.stringify(error));
      return res.status(400).json({ success: false, error: error.message || 'Error al crear la variante.' });
    }

    let finalData = data;

    if (Number(stock) > 0) {
      try {
        const { data: rpcData, error: rpcError } = await admin.rpc('adjust_stock', {
          p_business_id: req.businessId,
          p_product_id: productId,
          p_variant_id: data.id,
          p_change: Number(stock),
          p_type: 'inicial',
          p_reason: null,
          p_ref_type: 'variant_create',
          p_ref_id: null,
          p_user: null,
        });
        if (rpcError) throw rpcError;
        finalData = { ...data, stock: rpcData };
      } catch (rpcErr) {
        logger.error('productVariants.create adjust_stock error: ' + JSON.stringify(rpcErr));
        await sb.from('product_variants').delete().eq('id', data.id);
        throw rpcErr;
      }
    }

    // Con una variante activa el producto pasa a tener variantes, aunque el modal no se guarde
    if (!product.has_variants) {
      const { error: hvErr } = await sb
        .from('products')
        .update({ has_variants: true, updated_at: new Date().toISOString() })
        .eq('id', productId);
      if (hvErr) logger.warn('productVariants.create has_variants: ' + hvErr.message);
    }

    return res.status(201).json({ success: true, data: finalData });
  } catch (err) {
    logger.error('productVariants.create: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al crear la variante.' });
  }
}

async function update(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { productId, variantId } = req.params;
    const { attributes, stock, is_active, sku } = req.body;

    const { data: variant, error: getErr } = await sb
      .from('product_variants')
      .select('id, stock')
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
    let stockChange = 0;
    if (stock !== undefined) {
      const newStock = Number(stock);
      if (!Number.isInteger(newStock) || newStock < 0) {
        return res.status(400).json({ success: false, error: 'El stock debe ser un entero mayor o igual a 0.' });
      }
      stockChange = newStock - variant.stock;
    }
    if (is_active !== undefined) {
      updates.is_active = Boolean(is_active);
    }

    // Edición explícita del SKU: si choca con otra variante se rechaza (no se agrega sufijo)
    const newSku = typeof sku === 'string' ? sku.trim() : '';
    if (newSku) {
      const { data: clash, error: sErr } = await sb
        .from('product_variants')
        .select('id')
        .eq('business_id', req.businessId)
        .eq('sku', newSku)
        .neq('id', variantId)
        .maybeSingle();
      if (sErr) throw sErr;
      if (clash) return res.status(400).json({ success: false, error: `El SKU "${newSku}" ya está en uso por otra variante.` });
      updates.sku = newSku;
    }

    if (Object.keys(updates).length === 0 && stock === undefined) {
      return res.status(400).json({ success: false, error: 'No hay cambios para actualizar.' });
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await sb
        .from('product_variants')
        .update(updates)
        .eq('id', variantId);
      if (error?.code === '23505' && newSku && error.message?.includes('sku')) {
        return res.status(400).json({ success: false, error: `El SKU "${newSku}" ya está en uso por otra variante.` });
      }
      if (error) throw error;
    }

    // El stock se mueve solo vía adjust_stock: actualiza la variante, recalcula el padre y deja historial
    if (stockChange !== 0) {
      const { error: rpcError } = await supabaseAdmin.rpc('adjust_stock', {
        p_business_id: req.businessId,
        p_product_id: productId,
        p_variant_id: variantId,
        p_change: stockChange,
        p_type: 'ajuste',
        p_reason: 'Ajuste manual desde el panel',
        p_ref_type: 'variant_update',
        p_ref_id: null,
        p_user: null,
      });
      if (rpcError) throw rpcError;
    } else if (updates.is_active !== undefined) {
      await recalcProductStock(productId, req.businessId);
    }

    const { data, error } = await sb
      .from('product_variants')
      .select('*')
      .eq('id', variantId)
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

    const { data, error } = await sb
      .from('product_variants')
      .update({ is_active: false })
      .eq('id', variantId)
      .select('id');

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Variante no encontrada.' });
    }

    await recalcProductStock(productId, req.businessId);

    return res.json({ success: true, data: { id: variantId } });
  } catch (err) {
    logger.error('productVariants.deactivate: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al desactivar la variante.' });
  }
}

async function uploadImage(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { productId, variantId } = req.params;

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se adjuntó ninguna imagen.' });
    }

    const { data: variant, error: vErr } = await sb
      .from('product_variants')
      .select('id')
      .eq('id', variantId)
      .eq('product_id', productId)
      .eq('business_id', req.businessId)
      .single();

    if (vErr || !variant) {
      return res.status(404).json({ success: false, error: 'Variante no encontrada.' });
    }

    const timestamp = Date.now();
    const fileName = `products/${req.businessId}/variants/${variantId}-${timestamp}`;
    const filePath = fileName;

    const { error: uploadErr } = await sb.storage
      .from('product-images')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadErr) {
      logger.error('productVariants.uploadImage storage error: ' + uploadErr.message);
      return res.status(400).json({ success: false, error: 'Error al subir la imagen.' });
    }

    const { data: { publicUrl } } = sb.storage
      .from('product-images')
      .getPublicUrl(filePath);

    const { error: updateErr } = await sb
      .from('product_variants')
      .update({ image_url: publicUrl })
      .eq('id', variantId);

    if (updateErr) throw updateErr;

    return res.json({ success: true, data: { image_url: publicUrl } });
  } catch (err) {
    logger.error('productVariants.uploadImage: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al subir la imagen.' });
  }
}

module.exports = {
  getAll,
  create,
  update,
  deactivate,
  uploadImage,
};
