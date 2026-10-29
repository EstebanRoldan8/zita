const { parseGender } = require('../utils/gender');
const crypto = require('crypto');
const { parseFilters, applyFilters, describeSource } = require('../utils/inventoryHistory');
const { createUserClient, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { getTimezone } = require('../utils/timezone');
const { generarSku } = require('../utils/sku');
const { findLowStock } = require('../utils/lowStock');
const { normalizeOptionKey } = require('../utils/optionKey');
const { getColorOptions, uniqueUrls } = require('../utils/variantImages');
const { getTopSellers } = require('../utils/topSellers');
const { loadBundles, deriveBundle } = require('../utils/bundles');

const MSG_SET_SIN_STOCK = 'Un set no tiene stock propio: su disponibilidad se calcula de sus productos. Ajusta el stock de cada producto del set.';

// Sets de una lista de productos: stock calculado de sus componentes + resumen para el panel
async function withBundleInfo(businessId, products) {
  const sets = (products || []).filter((p) => p.is_bundle);
  if (sets.length === 0) return products || [];
  const { componentsByBundle, variantsByProduct } = await loadBundles(supabaseAdmin, businessId, sets.map((p) => p.id));
  const info = {};
  for (const p of sets) {
    const comps = componentsByBundle[p.id] || [];
    const d = deriveBundle(p, comps, variantsByProduct);
    info[p.id] = {
      stock: d.error ? 0 : (d.hasVariants ? d.variants.reduce((n, v) => n + v.stock, 0) : d.simpleStock),
      bundle: {
        components: comps.map((c) => ({ product_id: c.product.id, name: c.product.name, quantity: c.quantity, is_active: c.product.is_active !== false })),
        variants: d.variants.map((v) => ({ id: v.id, attributes: v.attributes, stock: v.stock })),
        lost: d.lost.map((l) => ({ attributes: l.attributes, missing: l.missing })),
        error: d.error,
      },
    };
  }
  return products.map((p) => (info[p.id] ? { ...p, stock: info[p.id].stock, stock_calculated: true, bundle: info[p.id].bundle } : p));
}

const MSG_VARIANTES_ACTIVAS = 'Debes desactivar todas las variantes antes de quitar esta opción.';
const msgStockAntesDeVariantes = (n) =>
  `Este producto tiene ${n} unidad${n === 1 ? '' : 'es'} en stock. Ajusta el stock a 0 antes de activar variantes, para no perder esas unidades.`;

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
    return res.json({ success: true, data: await withBundleInfo(req.businessId, data || []) });
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
      .eq('is_bundle', false)
      .order('stock');
    if (error) throw error;
    const lowStock = await findLowStock(sb, req.businessId, data);
    return res.json({ success: true, data: lowStock });
  } catch (err) {
    logger.error('products.getLowStock: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al obtener productos con stock bajo.' });
  }
}

// Resumen del inventario: unidades, valor al costo y a la venta, alertas,
// más vendidos y productos sin movimiento de venta en los últimos 30 días.
async function getInventorySummary(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: products, error } = await sb
      .from('products')
      .select('id, name, stock, min_stock, price, cost_price, has_variants')
      .eq('business_id', req.businessId)
      .eq('is_active', true)
      .eq('is_bundle', false);
    if (error) throw error;
    const list = products || [];

    // products.stock ya es la suma de variantes activas en productos con variantes
    let totalUnits = 0;
    let costValue = 0;
    let saleValue = 0;
    let withoutCost = 0;
    for (const p of list) {
      const stock = Number(p.stock) || 0;
      totalUnits += stock;
      saleValue += stock * (Number(p.price) || 0);
      if (p.cost_price != null) costValue += stock * Number(p.cost_price);
      else withoutCost += 1;
    }

    const lowList = await findLowStock(sb, req.businessId, list);
    const outOfStockCount = list.filter((p) => (Number(p.stock) || 0) === 0).length;
    const lowStockCount = lowList.filter((p) => (Number(p.stock) || 0) > 0).length;

    // Más vendidos: suma de quantity en product_sales de los últimos 30 días
    const topSellers = await getTopSellers(sb, req.businessId, since, Object.fromEntries(list.map((p) => [p.id, p.name])));

    // Sin movimiento: sin ningún 'venta' en inventory_movements en 30 días y con stock > 0
    const { data: saleMovs, error: mErr } = await sb
      .from('inventory_movements')
      .select('product_id')
      .eq('business_id', req.businessId)
      .eq('type', 'venta')
      .gte('created_at', since)
      .limit(10000);
    if (mErr) throw mErr;
    const soldIds = new Set((saleMovs || []).map((m) => m.product_id));
    const noMovementAll = list
      .filter((p) => (Number(p.stock) || 0) > 0 && !soldIds.has(p.id))
      .sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0));

    return res.json({
      success: true,
      data: {
        total_products: list.length,
        total_units: totalUnits,
        inventory_cost_value: costValue,
        products_without_cost: withoutCost,
        inventory_sale_value: saleValue,
        out_of_stock_count: outOfStockCount,
        low_stock_count: lowStockCount,
        top_sellers: topSellers,
        no_movement: noMovementAll.slice(0, 20).map((p) => ({ id: p.id, name: p.name, stock: p.stock })),
        no_movement_total: noMovementAll.length,
      },
    });
  } catch (err) {
    logger.error('products.getInventorySummary: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al obtener el resumen de inventario.' });
  }
}

async function getSales(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const todayCol = new Date().toLocaleDateString('en-CA', { timeZone: getTimezone(req.business?.country) });
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
    const { name, description, price, stock, min_stock, category, has_variants, cost_price, sku, gender } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'El nombre del producto es obligatorio.' });
    if (price === undefined || Number(price) < 0) return res.status(400).json({ success: false, error: 'El precio debe ser mayor o igual a 0.' });

    const g = parseGender(gender);
    if (g.error) return res.status(400).json({ success: false, error: g.error });

    let finalSku = sku?.trim() || null;
    if (!finalSku) {
      finalSku = generarSku(category, name);
    }

    if (finalSku) {
      let skuCandidate = finalSku;
      let counter = 2;
      let skuExists = true;
      while (skuExists) {
        const { data: existing } = await sb
          .from('products')
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

    const initialStock = has_variants ? 0 : (Number(stock) || 0);
    if (!Number.isInteger(initialStock) || initialStock < 0) {
      return res.status(400).json({ success: false, error: 'El stock debe ser un entero mayor o igual a 0.' });
    }

    // Se inserta en 0 y el stock inicial entra por adjust_stock para que quede en inventory_movements
    const payload = {
      business_id: req.businessId,
      name:        name.trim(),
      price:       Number(price),
      stock:       0,
      has_variants: Boolean(has_variants) || false,
    };
    if (description !== undefined) payload.description = description?.trim() || null;
    if (min_stock  !== undefined) payload.min_stock  = Number(min_stock);
    if (category   !== undefined) payload.category   = category?.trim() || null;
    if (!g.skip) payload.gender = g.value;
    if (cost_price !== undefined) { const _cp = parseFloat(cost_price); payload.cost_price = (!isNaN(_cp) && _cp >= 0) ? _cp : null; }
    if (finalSku) payload.sku = finalSku;

    const { data, error } = await sb
      .from('products')
      .insert(payload)
      .select()
      .single();

    if (error) {
      logger.error('products.create supabase error: ' + JSON.stringify(error));
      return res.status(400).json({ success: false, error: error.message || 'Error al crear el producto.' });
    }

    let finalData = data;
    if (initialStock > 0) {
      try {
        const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('adjust_stock', {
          p_business_id: req.businessId,
          p_product_id: data.id,
          p_variant_id: null,
          p_change: initialStock,
          p_type: 'inicial',
          p_reason: null,
          p_ref_type: 'product_create',
          p_ref_id: null,
          p_user: null,
        });
        if (rpcError) throw rpcError;
        finalData = { ...data, stock: rpcData };
      } catch (rpcErr) {
        logger.error('products.create adjust_stock error: ' + JSON.stringify(rpcErr));
        await sb.from('products').delete().eq('id', data.id);
        throw rpcErr;
      }
    }

    return res.status(201).json({ success: true, data: finalData });
  } catch (err) {
    logger.error('products.create: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al crear el producto.' });
  }
}

async function update(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;
    const { name, description, price, stock, min_stock, category, has_variants, cost_price, sku, gender } = req.body;
    const g = parseGender(gender);
    if (g.error) return res.status(400).json({ success: false, error: g.error });

    const { data: current, error: cErr } = await sb
      .from('products')
      .select('id, stock, has_variants, is_bundle')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();
    if (cErr || !current) return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    if (current.is_bundle && ((stock !== undefined && Number(stock) !== 0) || has_variants)) {
      return res.status(400).json({ success: false, error: MSG_SET_SIN_STOCK });
    }

    const willHaveVariants = has_variants !== undefined ? Boolean(has_variants) : Boolean(current.has_variants);

    if (willHaveVariants || current.has_variants) {
      const { count, error: vErr } = await sb
        .from('product_variants')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', id)
        .eq('business_id', req.businessId)
        .eq('is_active', true);
      if (vErr) throw vErr;
      if (!willHaveVariants && count > 0) {
        return res.status(400).json({ success: false, error: MSG_VARIANTES_ACTIVAS });
      }
      if (willHaveVariants && !current.has_variants && current.stock > 0) {
        return res.status(400).json({ success: false, error: msgStockAntesDeVariantes(current.stock) });
      }
      if (willHaveVariants && count === 0) {
        return res.status(400).json({ success: false, error: 'Debes crear al menos una variante activa.' });
      }
    }

    // Sin variantes, el stock se mueve solo vía adjust_stock (diferencia contra el actual)
    let stockChange = 0;
    if (stock !== undefined && !willHaveVariants) {
      const newStock = Number(stock);
      if (!Number.isInteger(newStock) || newStock < 0) {
        return res.status(400).json({ success: false, error: 'El stock debe ser un entero mayor o igual a 0.' });
      }
      stockChange = newStock - current.stock;
    }

    // Edición explícita del SKU: si choca con otro producto se rechaza (no se agrega sufijo).
    // Vacío = se conserva el SKU actual.
    const newSku = typeof sku === 'string' ? sku.trim() : '';
    if (newSku) {
      const { data: clash, error: sErr } = await sb
        .from('products')
        .select('id')
        .eq('business_id', req.businessId)
        .eq('sku', newSku)
        .neq('id', id)
        .maybeSingle();
      if (sErr) throw sErr;
      if (clash) return res.status(400).json({ success: false, error: `El SKU "${newSku}" ya está en uso por otro producto.` });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (newSku) updates.sku = newSku;
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (price !== undefined) updates.price = Number(price);
    if (min_stock !== undefined) updates.min_stock = Number(min_stock);
    if (category !== undefined) updates.category = category?.trim() || null;
    if (!g.skip) updates.gender = g.value;
    if (has_variants !== undefined) updates.has_variants = Boolean(has_variants);
    if (cost_price !== undefined) { const _cp = parseFloat(cost_price); updates.cost_price = (!isNaN(_cp) && _cp >= 0) ? _cp : null; }

    const { data, error } = await sb
      .from('products')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error?.code === '23505' && newSku && error.message?.includes('sku')) {
      return res.status(400).json({ success: false, error: `El SKU "${newSku}" ya está en uso por otro producto.` });
    }
    if (error) throw error;

    let finalData = data;
    if (stockChange !== 0) {
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('adjust_stock', {
        p_business_id: req.businessId,
        p_product_id: id,
        p_variant_id: null,
        p_change: stockChange,
        p_type: 'ajuste',
        p_reason: 'Ajuste manual desde el panel',
        p_ref_type: 'product_update',
        p_ref_id: null,
        p_user: null,
      });
      if (rpcError) throw rpcError;
      finalData = { ...data, stock: rpcData };
    }

    return res.json({ success: true, data: finalData });
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
    const { data, error } = await sb
      .from('products')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    }
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

    // Un producto que es parte de un set no se puede borrar (la base también lo impide: RESTRICT)
    const { data: usedIn, error: uErr } = await supabaseAdmin
      .from('product_bundle_components')
      .select('bundle_product_id')
      .eq('business_id', req.businessId)
      .eq('component_product_id', id);
    if (uErr) throw uErr;
    if ((usedIn || []).length > 0) {
      const { data: sets, error: sErr } = await supabaseAdmin
        .from('products').select('name').eq('business_id', req.businessId).in('id', usedIn.map((u) => u.bundle_product_id));
      if (sErr) throw sErr;
      const names = [...new Set((sets || []).map((x) => x.name).filter(Boolean))];
      return res.status(409).json({
        success: false,
        error: `"${product.name}" es parte ${names.length === 1 ? 'del set' : 'de los sets'} ${names.map((n) => `"${n}"`).join(', ')}. Quítalo del set (o borra el set) antes de eliminarlo.`,
      });
    }

    const { data, error } = await sb
      .from('products')
      .delete()
      .eq('id', id)
      .select('id');

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    }
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
      .from('products').select('*').eq('id', id).eq('business_id', req.businessId).single();
    if (pErr || !product) return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    if (!product.is_active) return res.status(400).json({ success: false, error: 'El producto no está activo.' });
    if (product.is_bundle) {
      return res.status(400).json({ success: false, error: 'Los sets no se venden desde caja: registra la venta como pedido, que descuenta cada producto del set.' });
    }

    if (product.has_variants && !variant_id) {
      return res.status(400).json({ success: false, error: 'Este producto tiene variantes, debes especificar cuál (talla/color).' });
    }

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

    const totalAmount = Number(product.price) * qty;
    let newStock;
    // El movimiento de inventario queda enlazado al registro de la venta (product_sales.id)
    const saleId = crypto.randomUUID();

    try {
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('adjust_stock', {
        p_business_id: req.businessId,
        p_product_id: id,
        p_variant_id: variant_id || null,
        p_change: -qty,
        p_type: 'venta',
        p_reason: null,
        p_ref_type: 'product_sale',
        p_ref_id: saleId,
        p_user: req.user?.id || null,
      });
      if (rpcError) throw rpcError;
      newStock = rpcData;
    } catch (err) {
      if (err.message?.includes('STOCK_INSUFICIENTE_O_NO_ENCONTRADO')) {
        // Se consulta después del fallo (sin pre-chequeo) para no reabrir la condición de carrera
        const { data: current } = variant_id
          ? await sb.from('product_variants').select('stock').eq('id', variant_id).eq('business_id', req.businessId).maybeSingle()
          : await sb.from('products').select('stock').eq('id', id).eq('business_id', req.businessId).maybeSingle();
        if (current && current.stock != null) {
          return res.status(400).json({ success: false, error: `Stock insuficiente. Disponible: ${current.stock}.` });
        }
        return res.status(400).json({ success: false, error: 'Ya no hay stock suficiente de este producto.' });
      }
      throw err;
    }

    const { error: saleErr } = await sb
      .from('product_sales')
      .insert({
        id:             saleId,
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

    const saleDate = new Date().toLocaleDateString('en-CA', { timeZone: getTimezone(req.business?.country) });

    const { data: incomeData, error: incomeErr } = await sb
      .from('income')
      .insert({
        business_id: req.businessId,
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
      const { data: expData, error: expErr } = await sb
        .from('expenses')
        .insert({
          business_id: req.businessId,
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

async function uploadImages(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No se adjuntaron imágenes.' });
    }

    const { data: product, error: pErr } = await sb
      .from('products')
      .select('id, business_id, images')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (pErr || !product) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    }

    const uploadedUrls = [];
    const timestamp = Date.now();

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const fileName = `products/${req.businessId}/gallery/${id}-${timestamp}-${i}`;

      const { error: uploadErr } = await sb.storage
        .from('product-images')
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (uploadErr) {
        logger.error('products.uploadImages storage error: ' + uploadErr.message);
        continue;
      }

      const { data: { publicUrl } } = sb.storage
        .from('product-images')
        .getPublicUrl(fileName);

      uploadedUrls.push(publicUrl);
    }

    const currentImages = (product.images || []);
    const updatedImages = [...currentImages, ...uploadedUrls];

    const { error: updateErr } = await sb
      .from('products')
      .update({ images: updatedImages })
      .eq('id', id);

    if (updateErr) throw updateErr;

    return res.json({ success: true, data: { images: updatedImages } });
  } catch (err) {
    logger.error('products.uploadImages: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al subir las imágenes.' });
  }
}

async function deleteImage(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ success: false, error: 'Se requiere la URL de la imagen a eliminar.' });
    }

    const { data: product, error: pErr } = await sb
      .from('products')
      .select('id, business_id, images')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (pErr || !product) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    }

    const currentImages = product.images || [];
    const updatedImages = currentImages.filter(img => img !== url);

    const { error: updateErr } = await sb
      .from('products')
      .update({ images: updatedImages })
      .eq('id', id);

    if (updateErr) throw updateErr;

    return res.json({ success: true, data: { images: updatedImages } });
  } catch (err) {
    logger.error('products.deleteImage: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al eliminar la imagen.' });
  }
}

// ── Fotos por color (products.option_images) ─────────────────────────────────
// Solo estos endpoints escriben option_images (update() y create() no la aceptan).
const MAX_PHOTOS_PER_OPTION = 8;
const STORAGE_PUBLIC_MARKER = '/storage/v1/object/public/product-images/';

async function loadOptionContext(sb, productId, businessId) {
  const { data: product, error } = await sb
    .from('products')
    .select('id, is_active, has_variants, is_bundle, option_images')
    .eq('id', productId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (error || !product) return { product: null };
  let variants = [];
  if (product.is_bundle) {
    // Set: sus colores salen de las variantes derivadas de sus productos
    const { componentsByBundle, variantsByProduct } = await loadBundles(supabaseAdmin, businessId, [productId]);
    variants = deriveBundle(product, componentsByBundle[productId] || [], variantsByProduct).variants;
  } else if (product.has_variants) {
    const { data, error: vErr } = await sb
      .from('product_variants')
      .select('id, attributes, is_active')
      .eq('product_id', productId)
      .eq('business_id', businessId);
    if (vErr) throw vErr;
    variants = data || [];
  }
  // Panel: un grupo por CADA color de variante (activas e inactivas) y las fotos huérfanas (color que ya ninguna
  // variante usa) para poder verlas y quitarlas
  return { product, options: getColorOptions(variants, product.option_images || {}, { includeInactive: true, includeOrphans: true }) };
}

// Ruta interna en Storage solo si la URL es de este negocio en el bucket product-images
function ownStoragePath(url, businessId) {
  const idx = typeof url === 'string' ? url.indexOf(STORAGE_PUBLIC_MARKER) : -1;
  if (idx === -1) return null;
  const path = decodeURIComponent(url.slice(idx + STORAGE_PUBLIC_MARKER.length).split('?')[0]);
  return path.startsWith(`products/${businessId}/`) ? path : null;
}

async function removeStorageFiles(sb, paths, context) {
  if (!paths.length) return;
  const { error } = await sb.storage.from('product-images').remove(paths);
  if (error) logger.error(`${context} storage remove: ${error.message}`);
}

// GET /:id/option-images
async function getOptionImages(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { product, options } = await loadOptionContext(sb, req.params.id, req.businessId);
    if (!product) return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    return res.json({ success: true, data: { attribute: 'color', options } });
  } catch (err) {
    logger.error('products.getOptionImages: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al obtener las fotos por color.' });
  }
}

// POST /:id/option-images (multipart: option + images[1..8]). Todo o nada.
async function uploadOptionImages(req, res) {
  const uploadedPaths = [];
  const sb = createUserClient(req.headers.authorization);
  try {
    const { id } = req.params;
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ success: false, error: 'Adjunta al menos una imagen.' });
    }
    const key = normalizeOptionKey(req.body?.option);
    if (!key) return res.status(400).json({ success: false, error: 'Indica el color de las fotos (campo "option").' });

    const { product, options } = await loadOptionContext(sb, id, req.businessId);
    if (!product) return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    if (!product.is_active) return res.status(400).json({ success: false, error: 'El producto no está activo.' });
    if (!product.has_variants && !product.is_bundle) return res.status(400).json({ success: false, error: 'Este producto no tiene variantes.' });
    if (!options.some((o) => !o.orphan)) {
      return res.status(400).json({ success: false, error: 'Las variantes de este producto no tienen un atributo «color».' });
    }
    const option = options.find((o) => o.key === key && !o.orphan);
    if (!option) {
      return res.status(400).json({ success: false, error: `No hay variantes con el color ${String(req.body.option).trim().slice(0, 40)}.` });
    }
    const current = (product.option_images || {})[key] || [];
    if (current.length + files.length > MAX_PHOTOS_PER_OPTION) {
      const left = Math.max(MAX_PHOTOS_PER_OPTION - current.length, 0);
      return res.status(400).json({
        success: false,
        error: `El color ${option.label} ya tiene ${current.length} foto${current.length !== 1 ? 's' : ''}; el máximo es ${MAX_PHOTOS_PER_OPTION} (quedan ${left} cupo${left !== 1 ? 's' : ''}).`,
      });
    }

    const timestamp = Date.now();
    const newUrls = [];
    for (let i = 0; i < files.length; i++) {
      const path = `products/${req.businessId}/colors/${id}/${key}-${timestamp}-${i}`;
      const { error: upErr } = await sb.storage
        .from('product-images')
        .upload(path, files[i].buffer, { contentType: files[i].mimetype, upsert: false });
      if (upErr) {
        logger.error('products.uploadOptionImages storage error: ' + upErr.message);
        await removeStorageFiles(sb, uploadedPaths, 'products.uploadOptionImages');
        return res.status(500).json({ success: false, error: 'No se pudieron subir las fotos; no se guardó ninguna. Intenta de nuevo.' });
      }
      uploadedPaths.push(path);
      newUrls.push(sb.storage.from('product-images').getPublicUrl(path).data.publicUrl);
    }

    // Se relee justo antes de escribir y solo se toca la clave de este color
    const { data: fresh, error: fErr } = await sb
      .from('products')
      .select('option_images')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();
    if (fErr) throw fErr;
    const merged = { ...(fresh.option_images || {}) };
    const updatedList = uniqueUrls([...(merged[key] || []), ...newUrls]);
    if (updatedList.length > MAX_PHOTOS_PER_OPTION) {
      await removeStorageFiles(sb, uploadedPaths, 'products.uploadOptionImages');
      return res.status(409).json({ success: false, error: `El color ${option.label} superaría ${MAX_PHOTOS_PER_OPTION} fotos. Recarga e intenta de nuevo.` });
    }
    merged[key] = updatedList;

    const { error: saveErr } = await sb
      .from('products')
      .update({ option_images: merged })
      .eq('id', id)
      .eq('business_id', req.businessId);
    if (saveErr) throw saveErr;

    return res.json({ success: true, data: { option: key, label: option.label, images: updatedList } });
  } catch (err) {
    logger.error('products.uploadOptionImages: ' + err.message);
    await removeStorageFiles(sb, uploadedPaths, 'products.uploadOptionImages');
    return res.status(500).json({ success: false, error: 'Error al guardar las fotos del color; no se guardó ninguna.' });
  }
}

// Lee option_images y valida que la URL esté bajo ese color
async function loadOptionEntry(sb, req) {
  const { option, url } = req.body || {};
  const key = normalizeOptionKey(option);
  if (!key || typeof url !== 'string' || !url) {
    return { status: 400, error: 'Indica el color (option) y la URL de la foto (url).' };
  }
  const { data: product, error } = await sb
    .from('products')
    .select('id, option_images')
    .eq('id', req.params.id)
    .eq('business_id', req.businessId)
    .maybeSingle();
  if (error || !product) return { status: 404, error: 'Producto no encontrado.' };
  const all = { ...(product.option_images || {}) };
  const list = all[key] || [];
  if (!list.includes(url)) return { status: 404, error: 'La foto no está en ese color.' };
  return { key, url, all, list };
}

// DELETE /:id/option-images { option, url }
async function deleteOptionImage(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const entry = await loadOptionEntry(sb, req);
    if (entry.error) return res.status(entry.status).json({ success: false, error: entry.error });

    const remaining = entry.list.filter((u) => u !== entry.url);
    const updated = { ...entry.all };
    if (remaining.length > 0) updated[entry.key] = remaining;
    else delete updated[entry.key];

    const { error: saveErr } = await sb
      .from('products')
      .update({ option_images: updated })
      .eq('id', req.params.id)
      .eq('business_id', req.businessId);
    if (saveErr) throw saveErr;

    // Solo se borra de Storage si el archivo es de este negocio; un fallo no hace fallar la petición
    const path = ownStoragePath(entry.url, req.businessId);
    if (path) await removeStorageFiles(sb, [path], 'products.deleteOptionImage');

    return res.json({ success: true, data: { option: entry.key, images: remaining } });
  } catch (err) {
    logger.error('products.deleteOptionImage: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al eliminar la foto del color.' });
  }
}

// PATCH /:id/option-images/cover { option, url } — mueve la foto a la posición 0 (principal)
async function setOptionCover(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const entry = await loadOptionEntry(sb, req);
    if (entry.error) return res.status(entry.status).json({ success: false, error: entry.error });

    const reordered = [entry.url, ...entry.list.filter((u) => u !== entry.url)];
    const { error: saveErr } = await sb
      .from('products')
      .update({ option_images: { ...entry.all, [entry.key]: reordered } })
      .eq('id', req.params.id)
      .eq('business_id', req.businessId);
    if (saveErr) throw saveErr;

    return res.json({ success: true, data: { option: entry.key, images: reordered } });
  } catch (err) {
    logger.error('products.setOptionCover: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al cambiar la foto principal del color.' });
  }
}

// Entrada de mercancía: suma unidades vía adjust_stock (type 'entrada'). No toca cost_price.
async function restock(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;
    const { quantity, variant_id, note } = req.body || {};

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) {
      return res.status(400).json({ success: false, error: 'La cantidad debe ser un número entero entre 1 y 100000.' });
    }

    let reason = null;
    if (note !== undefined && note !== null && note !== '') {
      if (typeof note !== 'string') {
        return res.status(400).json({ success: false, error: 'La nota debe ser texto.' });
      }
      const trimmed = note.trim();
      if (trimmed.length > 200) {
        return res.status(400).json({ success: false, error: 'La nota no puede superar 200 caracteres.' });
      }
      reason = trimmed || null;
    }

    const { data: product, error: pErr } = await sb
      .from('products')
      .select('id, is_active, has_variants, is_bundle')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .maybeSingle();
    if (pErr || !product) return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    if (!product.is_active) return res.status(400).json({ success: false, error: 'El producto no está activo.' });
    if (product.is_bundle) return res.status(400).json({ success: false, error: MSG_SET_SIN_STOCK });

    if (product.has_variants) {
      if (!variant_id) {
        return res.status(400).json({ success: false, error: 'Este producto tiene variantes, debes indicar cuál (talla/color).' });
      }
      const { data: variant, error: vErr } = await sb
        .from('product_variants')
        .select('id, is_active')
        .eq('id', variant_id)
        .eq('product_id', id)
        .eq('business_id', req.businessId)
        .maybeSingle();
      if (vErr || !variant) return res.status(404).json({ success: false, error: 'Variante no encontrada.' });
      if (!variant.is_active) return res.status(400).json({ success: false, error: 'La variante está inactiva.' });
    } else if (variant_id) {
      return res.status(400).json({ success: false, error: 'Este producto no tiene variantes; no envíes variant_id.' });
    }

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('adjust_stock', {
      p_business_id: req.businessId,
      p_product_id: id,
      p_variant_id: product.has_variants ? variant_id : null,
      p_change: qty,
      p_type: 'entrada',
      p_reason: reason,
      p_ref_type: 'restock',
      p_ref_id: null,
      p_user: req.user.id,
    });
    if (rpcError) {
      if (rpcError.message?.includes('STOCK_INSUFICIENTE_O_NO_ENCONTRADO')) {
        return res.status(404).json({ success: false, error: 'Producto o variante no encontrado.' });
      }
      throw rpcError;
    }

    const { data: after, error: aErr } = await sb
      .from('products')
      .select('stock')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();
    if (aErr) throw aErr;

    return res.json({
      success: true,
      data: {
        stock_variante: product.has_variants ? rpcData : null,
        stock_producto: after.stock,
      },
    });
  } catch (err) {
    logger.error('products.restock: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al registrar la entrada de mercancía.' });
  }
}

// Historial de movimientos de inventario de un producto (más recientes primero)
async function getMovements(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { id } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    const { data: product, error: pErr } = await sb
      .from('products')
      .select('id')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .maybeSingle();
    if (pErr || !product) return res.status(404).json({ success: false, error: 'Producto no encontrado.' });

    const { data: movs, error } = await sb
      .from('inventory_movements')
      .select('id, product_id, variant_id, type, quantity_change, stock_after, reason, reference_type, reference_id, created_by, created_at')
      .eq('business_id', req.businessId)
      .eq('product_id', id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    // Segunda consulta en vez de embed: atributos y sku de las variantes involucradas
    const variantIds = [...new Set((movs || []).map((m) => m.variant_id).filter(Boolean))];
    const variantsById = {};
    if (variantIds.length > 0) {
      const { data: variants, error: vErr } = await sb
        .from('product_variants')
        .select('id, attributes, sku, is_active')
        .eq('business_id', req.businessId)
        .in('id', variantIds);
      if (vErr) throw vErr;
      for (const v of variants || []) variantsById[v.id] = v;
    }

    const data = (movs || []).map((m) => ({ ...m, variant: m.variant_id ? (variantsById[m.variant_id] || null) : null }));
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('products.getMovements: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al obtener el historial de inventario.' });
  }
}

// GET /api/products/movements — historial de inventario del negocio (todos los productos), con filtros y paginación.
// ?tipo=venta|ajuste|devolucion|deshacer &product_id &variant_id &desde &hasta (YYYY-MM-DD) &page &limit
async function getHistory(req, res) {
  try {
    const f = parseFilters(req.query);
    let q = supabaseAdmin
      .from('inventory_movements')
      .select('id, product_id, variant_id, type, quantity_change, stock_after, reason, reference_type, reference_id, created_by, created_at', { count: 'exact' })
      .eq('business_id', req.businessId);
    q = applyFilters(q, f).order('created_at', { ascending: false }).range(f.from, f.to);
    const { data: movs, error, count } = await q;
    if (error) throw error;
    const rows = movs || [];
    const ids = (k) => [...new Set(rows.map((m) => m[k]).filter(Boolean))];
    const orderIds = [...new Set(rows.filter((m) => /^order/.test(m.reference_type || '') && m.reference_id).map((m) => m.reference_id))];
    const [prods, vars, ords] = await Promise.all([
      ids('product_id').length ? supabaseAdmin.from('products').select('id, name').eq('business_id', req.businessId).in('id', ids('product_id')) : { data: [] },
      ids('variant_id').length ? supabaseAdmin.from('product_variants').select('id, attributes, sku').eq('business_id', req.businessId).in('id', ids('variant_id')) : { data: [] },
      orderIds.length ? supabaseAdmin.from('orders').select('id, source, client_name').eq('business_id', req.businessId).in('id', orderIds) : { data: [] },
    ]);
    const byId = (list) => Object.fromEntries((list.data || []).map((x) => [x.id, x]));
    const P = byId(prods); const V = byId(vars); const O = byId(ords);
    const data = rows.map((m) => ({
      ...m,
      product_name: P[m.product_id]?.name || 'Producto eliminado',
      variant: m.variant_id ? (V[m.variant_id] || null) : null,
      ...describeSource(m, O),
    }));
    return res.json({ success: true, data, page: f.page, limit: f.limit, total: count || 0 });
  } catch (err) {
    logger.error('products.getHistory: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al obtener el historial de inventario.' });
  }
}

module.exports = { getAll, getLowStock, getSales, getInventorySummary, create, update, toggleProduct, deactivate, deleteProduct, sell, uploadImage, uploadImages, deleteImage, restock, getMovements, getHistory,
  getOptionImages, uploadOptionImages, deleteOptionImage, setOptionCover };
