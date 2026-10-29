// Sets / combos en el panel (/api/products/bundles). Un set es un producto con is_bundle = true y sus
// componentes en product_bundle_components. Sin stock ni variantes propias: se derivan (utils/bundles).
// business_id SIEMPRE del JWT (req.businessId); los componentes deben ser del mismo negocio.
const { parseGender } = require('../utils/gender');
const { createUserClient, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { generarSku } = require('../utils/sku');
const { isTiendaBusiness } = require('../utils/businessType');
const { loadBundles, deriveBundle } = require('../utils/bundles');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COMPONENTS = 10;
const bad = (res, error, status = 400) => res.status(status).json({ success: false, error });
const onlyTienda = (req, res) => (isTiendaBusiness(req.business) ? null : bad(res, 'Los sets solo están disponibles para negocios de tipo Tienda.', 403));

// Valida y normaliza [{ product_id, quantity }]. Devuelve { components, products } o { error }.
async function validateComponents(businessId, raw, bundleId = null) {
  if (!Array.isArray(raw) || raw.length < 2) return { error: 'Un set necesita al menos 2 productos.' };
  if (raw.length > MAX_COMPONENTS) return { error: `Un set puede tener máximo ${MAX_COMPONENTS} productos.` };
  const components = [];
  for (const c of raw) {
    const id = String(c?.product_id || '');
    const quantity = Number(c?.quantity ?? 1);
    if (!UUID_RE.test(id)) return { error: 'Producto inválido en el set.' };
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return { error: 'La cantidad de cada producto del set debe ser un entero entre 1 y 10.' };
    if (components.some((x) => x.product_id === id)) return { error: 'Un producto no puede repetirse en el set (usa la cantidad).' };
    if (bundleId && id === bundleId) return { error: 'Un set no puede incluirse a sí mismo.' };
    components.push({ product_id: id, quantity });
  }
  // Solo productos de ESTE negocio: si alguno no aparece es de otro negocio o no existe
  const { data: products, error } = await supabaseAdmin
    .from('products')
    .select('id, name, is_bundle, is_active, cost_price')
    .eq('business_id', businessId)
    .in('id', components.map((c) => c.product_id));
  if (error) throw error;
  if ((products || []).length !== components.length) return { error: 'Uno o más productos no existen o no son de tu negocio.' };
  const nested = products.find((p) => p.is_bundle);
  if (nested) return { error: `"${nested.name}" ya es un set: no se permiten sets dentro de sets.` };
  const inactive = products.find((p) => p.is_active === false);
  if (inactive) return { error: `"${inactive.name}" está inactivo. Actívalo antes de usarlo en un set.` };
  return { components, products };
}

// Vista previa de las variantes derivadas de unos componentes (sin guardar nada)
async function previewOf(businessId, bundle, components) {
  const fake = { id: bundle?.id || '00000000-0000-4000-8000-000000000000', name: bundle?.name || 'Set' };
  const variantsByProduct = {};
  const ids = components.map((c) => c.product_id);
  const { data: products, error } = await supabaseAdmin
    .from('products').select('id, name, price, cost_price, stock, has_variants, is_active, is_bundle, option_images')
    .eq('business_id', businessId).in('id', ids);
  if (error) throw error;
  const { data: variants, error: vErr } = await supabaseAdmin
    .from('product_variants').select('id, product_id, attributes, stock, image_url, is_active')
    .eq('business_id', businessId).eq('is_active', true).in('product_id', ids);
  if (vErr) throw vErr;
  for (const v of variants || []) (variantsByProduct[v.product_id] ||= []).push(v);
  const byId = Object.fromEntries((products || []).map((p) => [p.id, p]));
  const comps = components.map((c) => ({ quantity: c.quantity, product: byId[c.product_id] })).filter((c) => c.product);
  const d = deriveBundle(fake, comps, variantsByProduct);
  const costs = comps.map((c) => (c.product.cost_price == null ? null : Number(c.product.cost_price) * c.quantity));
  return {
    error: d.error,
    has_variants: d.hasVariants,
    stock: d.error ? 0 : (d.hasVariants ? d.variants.reduce((n, v) => n + v.stock, 0) : d.simpleStock),
    variants: d.variants.map((v) => ({ id: v.id, attributes: v.attributes, stock: v.stock })),
    lost: d.lost.map((l) => ({ attributes: l.attributes, missing: l.missing })),
    // Costo del set = suma de costos de componentes (null si a alguno le falta costo)
    cost_price: costs.some((c) => c == null) ? null : costs.reduce((a, b) => a + b, 0),
    components: comps.map((c) => ({ product_id: c.product.id, name: c.product.name, quantity: c.quantity, cost_price: c.product.cost_price ?? null })),
  };
}

function readFields(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'El nombre del set es obligatorio.' };
    out.name = name.slice(0, 120);
  }
  if (!partial || body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) return { error: 'El precio del set debe ser mayor que 0.' };
    out.price = price;
  }
  if (body.description !== undefined) out.description = String(body.description || '').trim() || null;
  const g = parseGender(body.gender);
  if (g.error) return { error: g.error };
  if (!g.skip) out.gender = g.value;
  if (body.category !== undefined) out.category = String(body.category || '').trim() || null;
  if (body.min_stock !== undefined) {
    const m = Number(body.min_stock);
    if (!Number.isInteger(m) || m < 0) return { error: 'El stock mínimo debe ser un entero mayor o igual a 0.' };
    out.min_stock = m;
  }
  if (body.stock !== undefined && Number(body.stock) !== 0) return { error: 'Un set no tiene stock propio: su disponibilidad se calcula de sus productos.' };
  return { fields: out };
}

// POST /api/products/bundles/preview { components }
async function preview(req, res) {
  try {
    if (onlyTienda(req, res)) return undefined;
    const v = await validateComponents(req.businessId, req.body?.components, req.body?.bundle_id || null);
    if (v.error) return bad(res, v.error);
    return res.json({ success: true, data: await previewOf(req.businessId, null, v.components) });
  } catch (err) {
    logger.error('bundles.preview: ' + err.message);
    return bad(res, 'Error al calcular la vista previa del set.', 500);
  }
}

// GET /api/products/bundles/:id
async function getOne(req, res) {
  try {
    if (onlyTienda(req, res)) return undefined;
    const sb = createUserClient(req.headers.authorization);
    const { data: set, error } = await sb.from('products')
      .select('id, name, description, price, category, gender, min_stock, sku, is_active, is_bundle, images, image_url, option_images')
      .eq('id', req.params.id).eq('business_id', req.businessId).maybeSingle();
    if (error) throw error;
    if (!set || !set.is_bundle) return bad(res, 'Set no encontrado.', 404);
    const { componentsByBundle } = await loadBundles(supabaseAdmin, req.businessId, [set.id]);
    const components = (componentsByBundle[set.id] || []).map((c) => ({ product_id: c.product.id, quantity: c.quantity }));
    return res.json({ success: true, data: { ...set, preview: await previewOf(req.businessId, set, components) } });
  } catch (err) {
    logger.error('bundles.getOne: ' + err.message);
    return bad(res, 'Error al obtener el set.', 500);
  }
}

// POST /api/products/bundles { name, price, description?, category?, min_stock?, components }
async function create(req, res) {
  try {
    if (onlyTienda(req, res)) return undefined;
    const sb = createUserClient(req.headers.authorization);
    const f = readFields(req.body || {});
    if (f.error) return bad(res, f.error);
    const v = await validateComponents(req.businessId, req.body?.components);
    if (v.error) return bad(res, v.error);

    // SKU con el mismo esquema que el panel (base, base-2, ...)
    let sku = generarSku(f.fields.category, f.fields.name) || null;
    if (sku) {
      const base = sku;
      for (let n = 2; ; n += 1) {
        const { data: taken } = await sb.from('products').select('id').eq('business_id', req.businessId).eq('sku', sku).maybeSingle();
        if (!taken) break;
        sku = `${base}-${n}`;
      }
    }

    const { data: set, error } = await sb.from('products').insert({
      business_id: req.businessId, // del JWT, nunca del body
      ...f.fields,
      stock: 0,
      has_variants: false,
      is_bundle: true,
      cost_price: null, // el costo de cada venta sale de los componentes (snapshot)
      ...(sku ? { sku } : {}),
    }).select().single();
    if (error) throw error;

    const { error: cErr } = await sb.from('product_bundle_components').insert(
      v.components.map((c) => ({ business_id: req.businessId, bundle_product_id: set.id, component_product_id: c.product_id, quantity: c.quantity })),
    );
    if (cErr) {
      await sb.from('products').delete().eq('id', set.id).eq('business_id', req.businessId);
      logger.error('bundles.create components: ' + cErr.message);
      return bad(res, 'No se pudieron guardar los productos del set.', 400);
    }
    return res.status(201).json({ success: true, data: { ...set, preview: await previewOf(req.businessId, set, v.components) } });
  } catch (err) {
    logger.error('bundles.create: ' + err.message);
    return bad(res, 'Error al crear el set.', 500);
  }
}

// PUT /api/products/bundles/:id { name?, price?, description?, category?, min_stock?, components? }
async function update(req, res) {
  try {
    if (onlyTienda(req, res)) return undefined;
    const sb = createUserClient(req.headers.authorization);
    const { data: set, error } = await sb.from('products').select('id, name, is_bundle')
      .eq('id', req.params.id).eq('business_id', req.businessId).maybeSingle();
    if (error) throw error;
    if (!set || !set.is_bundle) return bad(res, 'Set no encontrado.', 404);
    const f = readFields(req.body || {}, { partial: true });
    if (f.error) return bad(res, f.error);

    let next = null;
    if (req.body?.components !== undefined) {
      const v = await validateComponents(req.businessId, req.body.components, set.id);
      if (v.error) return bad(res, v.error);
      next = v.components;
    }

    if (Object.keys(f.fields).length) {
      const { error: uErr } = await sb.from('products').update(f.fields).eq('id', set.id).eq('business_id', req.businessId);
      if (uErr) throw uErr;
    }

    if (next) {
      // Reemplazo de componentes; si el insert falla se restauran los anteriores
      const { data: prev, error: pErr } = await sb.from('product_bundle_components')
        .select('component_product_id, quantity').eq('bundle_product_id', set.id).eq('business_id', req.businessId);
      if (pErr) throw pErr;
      const { error: dErr } = await sb.from('product_bundle_components').delete().eq('bundle_product_id', set.id).eq('business_id', req.businessId);
      if (dErr) throw dErr;
      const rows = (list) => list.map((c) => ({ business_id: req.businessId, bundle_product_id: set.id, component_product_id: c.component_product_id || c.product_id, quantity: c.quantity }));
      const { error: iErr } = await sb.from('product_bundle_components').insert(rows(next));
      if (iErr) {
        const { error: rErr } = await sb.from('product_bundle_components').insert(rows(prev || []));
        if (rErr) logger.error(`bundles.update restore failed set=${set.id}: ${rErr.message}`);
        logger.error('bundles.update components: ' + iErr.message);
        return bad(res, 'No se pudieron guardar los productos del set.', 400);
      }
    }

    const { componentsByBundle } = await loadBundles(supabaseAdmin, req.businessId, [set.id]);
    const components = (componentsByBundle[set.id] || []).map((c) => ({ product_id: c.product.id, quantity: c.quantity }));
    const { data: fresh } = await sb.from('products').select('*').eq('id', set.id).eq('business_id', req.businessId).single();
    return res.json({ success: true, data: { ...fresh, preview: await previewOf(req.businessId, fresh, components) } });
  } catch (err) {
    logger.error('bundles.update: ' + err.message);
    return bad(res, 'Error al actualizar el set.', 500);
  }
}

module.exports = { preview, getOne, create, update, validateComponents };
