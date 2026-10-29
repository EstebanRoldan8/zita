const { createUserClient, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { generarSku } = require('../utils/sku');
const {
  sanitizeAttributes, findDuplicate, duplicateMessage, parseMinStock, deleteDecision,
} = require('../utils/variantRules');
const { ownStockLossMessage } = require('../utils/inventoryHistory');
const { findColorAttribute } = require('../utils/optionKey');
const { planColorRename } = require('../utils/variantImages');

const MAX_PHOTOS_PER_COLOR = 8;

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

// Producto del negocio del token (nunca del body). null si no existe o es de otro negocio.
async function loadProduct(productId, businessId) {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('id, category, name, stock, has_variants, is_bundle')
    .eq('id', productId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Uso de cada variante: pedidos y movimientos de inventario (sin el de creación 'inicial') → ¿se puede eliminar?
async function usageOf(variants, businessId) {
  const ids = variants.map((v) => v.id);
  const orders = {};
  const moves = {};
  if (ids.length) {
    const { data: items, error: iErr } = await supabaseAdmin
      .from('order_items').select('variant_id').eq('business_id', businessId).in('variant_id', ids);
    if (iErr) throw iErr;
    for (const r of items || []) orders[r.variant_id] = (orders[r.variant_id] || 0) + 1;
    const { data: mv, error: mErr } = await supabaseAdmin
      .from('inventory_movements').select('variant_id, type').eq('business_id', businessId).in('variant_id', ids);
    if (mErr) throw mErr;
    for (const r of mv || []) if (r.type !== 'inicial') moves[r.variant_id] = (moves[r.variant_id] || 0) + 1;
  }
  const out = {};
  for (const v of variants) {
    const d = deleteDecision({ stock: v.stock, orderItems: orders[v.id] || 0, movements: moves[v.id] || 0 });
    out[v.id] = { orders: orders[v.id] || 0, movements: moves[v.id] || 0, can_delete: d.canDelete, delete_block: d.message };
  }
  return out;
}

// Sets (activos) que usan este producto: quitar una variante cambia las combinaciones que esos sets pueden vender
async function setsUsing(productId, businessId) {
  const { data, error } = await supabaseAdmin
    .from('product_bundle_components')
    .select('bundle_product_id')
    .eq('business_id', businessId)
    .eq('component_product_id', productId);
  if (error) throw error;
  const ids = [...new Set((data || []).map((r) => r.bundle_product_id))];
  if (!ids.length) return [];
  const { data: sets, error: sErr } = await supabaseAdmin
    .from('products').select('id, name').eq('business_id', businessId).eq('is_bundle', true).in('id', ids);
  if (sErr) throw sErr;
  return sets || [];
}

function setsWarning(sets) {
  if (!sets.length) return null;
  const names = sets.map((s) => s.name).join(', ');
  return `Esta combinación deja de estar disponible también en ${sets.length === 1 ? 'el set' : 'los sets'}: ${names}.`;
}

async function getAll(req, res) {
  try {
    const { productId } = req.params;
    const all = req.query.include_inactive === '1';
    const product = await loadProduct(productId, req.businessId);
    if (!product) return res.status(404).json({ success: false, error: 'Producto no encontrado.' });

    let query = supabaseAdmin
      .from('product_variants')
      .select('*')
      .eq('product_id', productId)
      .eq('business_id', req.businessId)
      .order('created_at', { ascending: true });
    if (!all) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;

    let rows = data || [];
    if (all) {
      const usage = await usageOf(rows, req.businessId);
      rows = rows.map((v) => ({ ...v, usage: usage[v.id] }));
    }
    return res.json({ success: true, data: rows });
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

    const attrs = sanitizeAttributes(attributes);
    if (attrs.error) return res.status(400).json({ success: false, error: attrs.error });

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

    // Mismo color y talla en el mismo producto (sin mayúsculas ni tildes): no se permite
    const { data: siblings, error: sibErr } = await supabaseAdmin
      .from('product_variants').select('id, attributes, is_active').eq('product_id', productId).eq('business_id', req.businessId);
    if (sibErr) throw sibErr;
    const dup = findDuplicate(attrs.attributes, siblings);
    if (dup) return res.status(409).json({ success: false, error: duplicateMessage(dup), code: 'VARIANT_DUPLICATE' });

    let finalSku = typeof sku === 'string' ? sku.trim().slice(0, 64) || null : null;
    if (!finalSku) {
      finalSku = generarSku(product.category, product.name, attrs.attributes);
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
      attributes: attrs.attributes,
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

// PATCH /:productId/variants/:variantId { attributes?, sku?, min_stock?, is_active?, stock? }
// El stock se mueve solo con adjust_stock (deja movimiento). El negocio sale del JWT, nunca del body.
async function update(req, res) {
  try {
    const { productId, variantId } = req.params;
    const { attributes, stock, is_active, sku, min_stock } = req.body || {};

    const product = await loadProduct(productId, req.businessId);
    if (!product) return res.status(404).json({ success: false, error: 'Producto no encontrado.' });

    const { data: variant, error: getErr } = await supabaseAdmin
      .from('product_variants')
      .select('id, stock, is_active, attributes')
      .eq('id', variantId)
      .eq('product_id', productId)
      .eq('business_id', req.businessId)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!variant) return res.status(404).json({ success: false, error: 'Variante no encontrada.' });

    // Activar una variante en un producto con stock propio (sin otras variantes activas) recalcularía el total con
    // las variantes y borraría esas unidades: se bloquea (no se adivina a qué color/talla pertenecían).
    if (is_active === true && variant.is_active === false) {
      const [{ data: prod }, { count: others }] = await Promise.all([
        supabaseAdmin.from('products').select('stock').eq('id', productId).eq('business_id', req.businessId).maybeSingle(),
        supabaseAdmin.from('product_variants').select('id', { count: 'exact', head: true })
          .eq('product_id', productId).eq('business_id', req.businessId).eq('is_active', true).neq('id', variantId),
      ]);
      const label = Object.values(variant.attributes || {}).filter(Boolean).join(' / ');
      const block = ownStockLossMessage({ productStock: prod?.stock, otherActiveVariants: others || 0, variantLabel: label });
      if (block) return res.status(409).json({ success: false, error: block, code: 'OWN_STOCK_WOULD_BE_LOST' });
    }

    const updates = {};
    // Cambio de atributos (p. ej. el color): validado, sin duplicar otra variante del producto, y con plan para
    // las fotos del color viejo (se mueven al nuevo, o se avisa si otra variante aún usa el color viejo)
    let photoPlan = null;
    if (attributes !== undefined) {
      const attrs = sanitizeAttributes(attributes);
      if (attrs.error) return res.status(400).json({ success: false, error: attrs.error });
      const { data: siblings, error: sibErr } = await supabaseAdmin
        .from('product_variants').select('id, attributes, is_active').eq('product_id', productId).eq('business_id', req.businessId);
      if (sibErr) throw sibErr;
      const dup = findDuplicate(attrs.attributes, siblings, variantId);
      if (dup) return res.status(409).json({ success: false, error: duplicateMessage(dup), code: 'VARIANT_DUPLICATE' });
      const oldColor = findColorAttribute(variant.attributes);
      const newColor = findColorAttribute(attrs.attributes);
      if (oldColor && newColor) {
        const { data: prod, error: pErr } = await supabaseAdmin
          .from('products').select('option_images').eq('id', productId).eq('business_id', req.businessId).single();
        if (pErr) throw pErr;
        photoPlan = planColorRename({
          oldValue: oldColor.value, newValue: newColor.value, others: (siblings || []).filter((x) => x.id !== variantId),
          optionImages: prod.option_images || {}, maxPhotos: MAX_PHOTOS_PER_COLOR,
        });
      }
      updates.attributes = attrs.attributes;
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
      if (typeof is_active !== 'boolean') return res.status(400).json({ success: false, error: 'is_active debe ser verdadero o falso.' });
      updates.is_active = is_active;
    }

    const ms = parseMinStock(min_stock);
    if (ms.error) return res.status(400).json({ success: false, error: ms.error });
    if (!ms.skip) updates.min_stock = ms.value;

    // Edición explícita del SKU: si choca con otra variante se rechaza (no se agrega sufijo)
    const newSku = typeof sku === 'string' ? sku.trim().slice(0, 64) : '';
    if (newSku) {
      const { data: clash, error: sErr } = await supabaseAdmin
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

    if (Object.keys(updates).length === 0 && stockChange === 0) {
      return res.status(400).json({ success: false, error: 'No hay cambios para actualizar.' });
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await supabaseAdmin
        .from('product_variants')
        .update(updates)
        .eq('id', variantId)
        .eq('business_id', req.businessId);
      if (error?.code === '23505' && newSku) {
        return res.status(400).json({ success: false, error: `El SKU "${newSku}" ya está en uso por otra variante.` });
      }
      if (error) throw error;
    }

    // Fotos del color: se mueven al nuevo nombre. Si no se pueden guardar, la variante vuelve a su color (todo o nada)
    if (photoPlan?.action === 'move') {
      const { error: imgErr } = await supabaseAdmin
        .from('products')
        .update({ option_images: photoPlan.optionImages })
        .eq('id', productId)
        .eq('business_id', req.businessId);
      if (imgErr) {
        logger.error(`productVariants.update option_images product=${productId}: ${imgErr.message}`);
        const { error: revErr } = await supabaseAdmin.from('product_variants').update({ attributes: variant.attributes })
          .eq('id', variantId).eq('business_id', req.businessId);
        if (revErr) logger.error('productVariants.update revert attributes: ' + revErr.message);
        return res.status(500).json({ success: false, error: 'No se pudieron mover las fotos del color; la variante conserva su color anterior. Intenta de nuevo.' });
      }
    }

    // adjust_stock no lanza: devuelve { error } y hay que revisarlo
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
      if (rpcError) {
        logger.error('productVariants.update adjust_stock: ' + rpcError.message);
        const short = String(rpcError.message || '').includes('STOCK_INSUFICIENTE');
        return res.status(short ? 400 : 500).json({ success: false, error: short ? 'Stock insuficiente para ese ajuste.' : 'No se pudo ajustar el stock.' });
      }
    } else if (updates.is_active !== undefined) {
      await recalcProductStock(productId, req.businessId);
    }

    const { data, error } = await supabaseAdmin
      .from('product_variants').select('*').eq('id', variantId).eq('business_id', req.businessId).single();
    if (error) throw error;

    // Desactivar o cambiar el color/talla de una variante cambia lo que venden los sets que usan el producto
    const touchesSets = (updates.is_active === false && variant.is_active) || (updates.attributes && variant.is_active);
    const sets = touchesSets ? await setsUsing(productId, req.businessId) : [];
    // photos: qué pasó con las fotos del color ('move' | 'keep' | 'full' | 'none') y el mensaje para el panel
    const photos = photoPlan && photoPlan.action !== 'none'
      ? { action: photoPlan.action, from: photoPlan.oldKey, to: photoPlan.newKey, moved: photoPlan.moved, message: photoPlan.message }
      : null;
    return res.json({
      success: true, data,
      ...(sets.length ? { affected_sets: sets, warning: setsWarning(sets) } : {}),
      ...(photos ? { photos } : {}),
    });
  } catch (err) {
    logger.error('productVariants.update: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al actualizar la variante.' });
  }
}

// DELETE /:productId/variants/:variantId — elimina de verdad SOLO una variante que nunca se usó
// (sin stock, sin pedidos, sin movimientos). Si tiene historial responde 409 y el panel ofrece "Desactivar".
// Las FK de pedidos y movimientos son ON DELETE SET NULL: por eso esta revisión es obligatoria.
async function remove(req, res) {
  try {
    const { productId, variantId } = req.params;

    const product = await loadProduct(productId, req.businessId);
    if (!product) return res.status(404).json({ success: false, error: 'Producto no encontrado.' });

    const { data: variant, error: getErr } = await supabaseAdmin
      .from('product_variants')
      .select('id, stock, is_active')
      .eq('id', variantId)
      .eq('product_id', productId)
      .eq('business_id', req.businessId)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!variant) return res.status(404).json({ success: false, error: 'Variante no encontrada.' });

    const usage = (await usageOf([variant], req.businessId))[variant.id];
    if (!usage.can_delete) {
      return res.status(409).json({ success: false, error: usage.delete_block, code: 'VARIANT_HAS_HISTORY', can_deactivate: true });
    }

    // stock = 0 en el DELETE: si entró stock justo ahora, no se borra
    const { data: deleted, error } = await supabaseAdmin
      .from('product_variants')
      .delete()
      .eq('id', variantId)
      .eq('product_id', productId)
      .eq('business_id', req.businessId)
      .eq('stock', 0)
      .select('id');
    if (error) throw error;
    if (!deleted || deleted.length === 0) {
      return res.status(409).json({ success: false, error: 'La variante cambió mientras se eliminaba. Revisa su stock y vuelve a intentarlo.', code: 'VARIANT_HAS_HISTORY', can_deactivate: true });
    }

    await recalcProductStock(productId, req.businessId);
    const sets = variant.is_active ? await setsUsing(productId, req.businessId) : [];
    return res.json({ success: true, data: { id: variantId }, ...(sets.length ? { affected_sets: sets, warning: setsWarning(sets) } : {}) });
  } catch (err) {
    logger.error('productVariants.remove: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al eliminar la variante.' });
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
  remove,
  uploadImage,
};
