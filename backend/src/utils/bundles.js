// Sets / combos: un producto con is_bundle = true compuesto por otros productos del MISMO negocio
// (product_bundle_components). El set no tiene stock ni variantes propias:
//  - sus variantes se DERIVAN: intersección de talla+color (y cualquier otro atributo) de las
//    variantes activas de los componentes, con un id UUID v5 estable (set + combinación normalizada);
//  - su stock por variante = mínimo de floor(stock del componente / cantidad);
//  - al venderse, la línea del set se expande en un movimiento por componente (adjust_stock);
//  - order_items guarda la línea del set con variant_id NULL y bundle_snapshot (componentes,
//    variantes y costo descontados) para restaurar y costear exacto aunque luego cambie el set.
const crypto = require('crypto');
const { normalizeAttributeName, findColorAttribute, normalizeOptionKey } = require('./optionKey');
const { uniqueUrls } = require('./variantImages');
// orderStock también usa este módulo: se carga al usarlo para no crear un require circular
const defaultAdjust = (params) => require('./orderStock').callAdjustStock(params);

// Namespace FIJO de los ids derivados (no cambiarlo: cambiaría los ids de las bolsas ya guardadas)
const BUNDLE_NAMESPACE = '3f4e2a5c-9b1d-4c7e-8a6f-2d5b7c9e1a04';
const MAX_QTY_PER_LINE = 10;

// ── Normalización e ids ──────────────────────────────────────────────────────
const removeAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
// "  Negró  Mate " → "negro mate" (minúsculas, sin tildes, espacios simples, trim)
const normValue = (v) => removeAccents(v).toLowerCase().replace(/\s+/g, ' ').trim();

function uuidv5(name, namespace = BUNDLE_NAMESPACE) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(Buffer.concat([ns, Buffer.from(String(name), 'utf8')])).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // versión 5
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Atributos → { nombreNormalizado: valorNormalizado } sin vacíos
function normAttributes(attributes) {
  const out = {};
  for (const [k, v] of Object.entries(attributes || {})) {
    const name = normalizeAttributeName(k);
    const value = normValue(v);
    if (name && value) out[name] = value;
  }
  return out;
}

// Clave estable de una combinación: atributos ordenados por nombre ("color=negro|talla=s")
function comboKey(attributes) {
  const n = normAttributes(attributes);
  return Object.keys(n).sort().map((k) => `${k}=${n[k]}`).join('|');
}

const derivedVariantId = (bundleId, key) => uuidv5(`${String(bundleId).toLowerCase()}|${key}`);

const variantLabel = (attributes) => Object.values(attributes || {}).map((v) => String(v).trim()).filter(Boolean).join(' / ');

// ── Derivación (función pura) ────────────────────────────────────────────────
// bundle: { id }, components: [{ quantity, product: { id, name, is_active, has_variants, stock, cost_price, option_images } }]
// variantsByProduct: { productId: [variantes activas { id, attributes, stock, image_url }] }
// Devuelve { variants, simpleStock, lost, error }:
//  - variants: [{ id, product_id, attributes, stock, image_url, is_active, components }] (vacío si ningún
//    componente tiene variantes; entonces simpleStock trae el stock del set)
//  - lost: combinaciones que existen en algún componente pero no en todos ({ attributes, missing: [nombres] })
//  - error: texto si la composición no es válida (no se puede vender)
function deriveBundle(bundle, components, variantsByProduct = {}) {
  const comps = (components || []).filter((c) => c && c.product);
  const result = { variants: [], simpleStock: 0, lost: [], error: null, hasVariants: false };
  if (comps.length < 2) {
    result.error = 'Un set necesita al menos 2 productos.';
    return result;
  }
  const inactive = comps.filter((c) => c.product.is_active === false);
  const withVariants = comps.filter((c) => (variantsByProduct[c.product.id] || []).length > 0);
  const simple = comps.filter((c) => (variantsByProduct[c.product.id] || []).length === 0);

  // Tope que ponen los componentes sin variantes (stock del producto / cantidad)
  const simpleCap = simple.length
    ? Math.min(...simple.map((c) => Math.floor((Number(c.product.stock) || 0) / Math.max(1, Number(c.quantity) || 1))))
    : Infinity;

  if (withVariants.length === 0) {
    result.simpleStock = inactive.length ? 0 : Math.max(0, simpleCap === Infinity ? 0 : simpleCap);
    return result;
  }
  result.hasVariants = true;

  // Todos los componentes con variantes deben usar los mismos atributos (p. ej. talla + color)
  const attrSets = withVariants.map((c) => {
    const names = new Set();
    for (const v of variantsByProduct[c.product.id]) for (const k of Object.keys(normAttributes(v.attributes))) names.add(k);
    return [...names].sort().join(',');
  });
  if (new Set(attrSets).size > 1) {
    result.error = `Los productos del set usan atributos distintos (${[...new Set(attrSets)].map((s) => s || 'sin atributos').join(' vs ')}). Todos deben tener los mismos (por ejemplo talla y color).`;
    return result;
  }

  // Combinación → variante, por componente (si un componente repite combinación, gana la de más stock)
  const maps = withVariants.map((c) => {
    const m = new Map();
    for (const v of variantsByProduct[c.product.id]) {
      const key = comboKey(v.attributes);
      if (!key) continue;
      const prev = m.get(key);
      if (!prev || Number(v.stock) > Number(prev.stock)) m.set(key, v);
    }
    return { c, m };
  });

  const allKeys = new Set(maps.flatMap(({ m }) => [...m.keys()]));
  for (const key of [...allKeys].sort()) {
    const missing = maps.filter(({ m }) => !m.has(key)).map(({ c }) => c.product.name);
    const first = maps.find(({ m }) => m.has(key)).m.get(key);
    if (missing.length) {
      result.lost.push({ key, attributes: first.attributes, missing });
      continue;
    }
    const parts = maps.map(({ c, m }) => ({ c, v: m.get(key) }));
    const variantCap = Math.min(...parts.map(({ c, v }) => Math.floor((Number(v.stock) || 0) / Math.max(1, Number(c.quantity) || 1))));
    const stock = inactive.length ? 0 : Math.max(0, Math.min(variantCap, simpleCap));
    // Foto del componente para ese color: sus fotos por color, o la de su variante
    const colorAttr = findColorAttribute(first.attributes);
    const colorKey = colorAttr ? normalizeOptionKey(colorAttr.value) : '';
    const image = uniqueUrls(parts.flatMap(({ c, v }) => [...(colorKey ? (c.product.option_images?.[colorKey] || []) : []), v.image_url]))[0] || null;
    result.variants.push({
      id: derivedVariantId(bundle.id, key),
      product_id: bundle.id,
      key,
      attributes: { ...first.attributes },
      stock,
      image_url: image,
      is_active: true,
      components: [
        ...parts.map(({ c, v }) => ({ product_id: c.product.id, variant_id: v.id, quantity: Number(c.quantity) || 1, name: c.product.name, label: variantLabel(v.attributes), cost_price: c.product.cost_price ?? null, stock: Number(v.stock) || 0 })),
        ...simple.map((c) => ({ product_id: c.product.id, variant_id: null, quantity: Number(c.quantity) || 1, name: c.product.name, label: '', cost_price: c.product.cost_price ?? null, stock: Number(c.product.stock) || 0 })),
      ],
    });
  }
  return result;
}

// Componentes de un set sin variantes (para el snapshot y la expansión)
function simpleComponents(components) {
  return (components || []).filter((c) => c && c.product).map((c) => ({
    product_id: c.product.id, variant_id: null, quantity: Number(c.quantity) || 1, name: c.product.name, label: '',
    cost_price: c.product.cost_price ?? null, stock: Number(c.product.stock) || 0,
  }));
}

// Snapshot que se guarda en order_items.bundle_snapshot (no lleva stock)
function bundleSnapshot(bundle, derivedVariant, components) {
  const parts = derivedVariant ? derivedVariant.components : simpleComponents(components);
  return {
    version: 1,
    bundle_product_id: bundle.id,
    bundle_name: bundle.name,
    bundle_variant_id: derivedVariant?.id || null,
    attributes: derivedVariant?.attributes || {},
    components: parts.map(({ product_id, variant_id, quantity, name, label, cost_price }) => ({ product_id, variant_id, quantity, name, label, cost_price })),
  };
}

// Línea de un set (snapshot + cantidad de sets) → movimientos de stock por componente
function snapshotMoves(snapshot, setQuantity) {
  return (snapshot?.components || []).map((c) => ({
    product_id: c.product_id,
    variant_id: c.variant_id || null,
    quantity: (Number(c.quantity) || 1) * (Number(setQuantity) || 0),
    label: [c.name, c.label].filter(Boolean).join(' '),
  })).filter((m) => m.product_id && m.quantity > 0);
}

// Costo de una línea de set según su snapshot: suma de cost_price × cantidad del componente × sets.
// hasCost = algún componente tenía costo. Usa el costo guardado al vender (no cambia si luego se edita).
function snapshotCost(snapshot, setQuantity) {
  let cost = 0;
  let hasCost = false;
  for (const c of snapshot?.components || []) {
    if (c.cost_price == null) continue;
    hasCost = true;
    cost += Number(c.cost_price) * (Number(c.quantity) || 1) * (Number(setQuantity) || 0);
  }
  return { cost, hasCost };
}

// ── Base de datos ────────────────────────────────────────────────────────────
const COMPONENT_PRODUCT_COLUMNS = 'id, name, price, cost_price, stock, has_variants, is_active, is_bundle, option_images, business_id';

// { [bundleId]: [{ quantity, product }] } y { [productId]: variantes activas } — SIEMPRE filtrado por negocio
async function loadBundles(client, businessId, bundleIds) {
  const ids = [...new Set((bundleIds || []).filter(Boolean))];
  if (ids.length === 0) return { componentsByBundle: {}, variantsByProduct: {} };
  const { data: rows, error } = await client
    .from('product_bundle_components')
    .select('bundle_product_id, component_product_id, quantity')
    .eq('business_id', businessId)
    .in('bundle_product_id', ids);
  if (error) throw error;
  const compIds = [...new Set((rows || []).map((r) => r.component_product_id))];
  let products = [];
  let variants = [];
  if (compIds.length) {
    const p = await client.from('products').select(COMPONENT_PRODUCT_COLUMNS).eq('business_id', businessId).in('id', compIds);
    if (p.error) throw p.error;
    products = p.data || [];
    const v = await client.from('product_variants').select('id, product_id, attributes, stock, image_url, is_active')
      .eq('business_id', businessId).eq('is_active', true).in('product_id', compIds);
    if (v.error) throw v.error;
    variants = v.data || [];
  }
  const productById = Object.fromEntries(products.map((p) => [p.id, p]));
  const componentsByBundle = {};
  for (const r of rows || []) {
    const product = productById[r.component_product_id];
    if (!product) continue; // de otro negocio o borrado: no cuenta (el trigger ya lo impide)
    (componentsByBundle[r.bundle_product_id] ||= []).push({ quantity: r.quantity, product });
  }
  const variantsByProduct = {};
  for (const v of variants) (variantsByProduct[v.product_id] ||= []).push(v);
  return { componentsByBundle, variantsByProduct };
}

// Aplica movimientos de stock en orden. Si uno falla, revierte los ya aplicados (tipo 'ajuste') y relanza
// el error con .failedMove. adjust es inyectable para probar el fallo; por defecto adjust_stock real.
async function applyMoves(moves, { businessId, type = 'venta', refType = 'order', refId = null, userId = null, reason = null, revertReason = 'Reversión por error en pedido' }, adjust = defaultAdjust, onRevertError = () => {}) {
  const applied = [];
  for (const move of moves) {
    try {
      await adjust({
        p_business_id: businessId, p_product_id: move.product_id, p_variant_id: move.variant_id || null,
        p_change: type === 'venta' ? -move.quantity : move.quantity,
        p_type: type, p_reason: reason, p_ref_type: refType, p_ref_id: refId, p_user: userId,
      });
      applied.push(move);
    } catch (err) {
      for (const done of [...applied].reverse()) {
        try {
          await adjust({
            p_business_id: businessId, p_product_id: done.product_id, p_variant_id: done.variant_id || null,
            p_change: type === 'venta' ? done.quantity : -done.quantity,
            p_type: 'ajuste', p_reason: revertReason, p_ref_type: refType, p_ref_id: refId, p_user: userId,
          });
        } catch (revErr) {
          onRevertError(done, revErr);
        }
      }
      err.failedMove = move;
      err.applied = applied;
      throw err;
    }
  }
  return applied;
}

module.exports = {
  BUNDLE_NAMESPACE, MAX_QTY_PER_LINE, uuidv5, normValue, normAttributes, comboKey, derivedVariantId, variantLabel,
  deriveBundle, simpleComponents, bundleSnapshot, snapshotMoves, snapshotCost, loadBundles, applyMoves,
};
