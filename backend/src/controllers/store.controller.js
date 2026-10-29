// API pública de la tienda (/api/store/:slug). Sin sesión: el negocio viene de req.storeBusinessId
// (storeContext, por slug). Todas las respuestas usan listas blancas de campos.
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { getColorOptions, colorOnlyImages, uniqueUrls } = require('../utils/variantImages');
const { findColorAttribute, normalizeOptionKey, normalizeAttributeName } = require('../utils/optionKey');
const { normalizeColombianPhone, maskPhone } = require('../utils/phone');
const { decrypt } = require('../utils/encrypt');
const { sendMessage } = require('../config/whatsapp');
const { calculateShipping } = require('../config/shipping');
const { enabledPaymentMethods } = require('../config/paymentMethods');
const { TERMS_VERSION } = require('../config/checkoutLegal');
const { discardOrder, flagForReview } = require('../utils/orderCleanup');
const { loadBundles, deriveBundle, bundleSnapshot, applyMoves, variantLabel: bundleVariantLabel } = require('../utils/bundles');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIZE_KEYS = ['talla', 'size', 'tamano'];
const MAX_QTY_PER_LINE = 10;
const MAX_PAGE_SIZE = 48;

const notFound = (res, msg = 'No encontrado.') => res.status(404).json({ success: false, error: msg });
const serverError = (res) => res.status(500).json({ success: false, error: 'Error interno. Intenta de nuevo en un momento.' });

const toNumber = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const round2 = (n) => Math.round(n * 100) / 100;
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Código visible del pedido, derivado del id (sin columna nueva)
const orderCode = (id) => `P-${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;

const formatCOP = (v) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);

// ── Lista blanca de store_settings ───────────────────────────────────────────
function publicSettings(settings = {}) {
  const policies = settings.policies && typeof settings.policies === 'object' ? settings.policies : {};
  const social = settings.social && typeof settings.social === 'object' ? settings.social : {};
  return {
    tagline: str(settings.tagline, 200),
    logo_url: str(settings.logo_url, 500) || null,
    hero_title: str(settings.hero_title, 200),
    hero_subtitle: str(settings.hero_subtitle, 400),
    currency: str(settings.currency, 3) || 'COP',
    shipping_flat_cost: toNumber(settings.shipping_flat_cost, 0),
    // Tarifa de la ciudad local (null = el negocio cobra shipping_flat_cost en todo)
    shipping_local_cost: settings.shipping_local_cost === undefined || settings.shipping_local_cost === null || settings.shipping_local_cost === ''
      ? null : toNumber(settings.shipping_local_cost, 0),
    shipping_local_city: str(settings.shipping_local_city, 80),
    free_shipping_from: toNumber(settings.free_shipping_from, 0),
    payment_methods: str(settings.payment_methods, 300),
    // Métodos que ofrece el checkout (lista blanca por negocio; por defecto solo transferencia)
    checkout_payment_methods: enabledPaymentMethods(settings),
    policies: {
      envios: str(policies.envios, 4000),
      cambios: str(policies.cambios, 4000),
      privacidad: str(policies.privacidad, 4000),
    },
    social: { instagram: str(social.instagram, 200), tiktok: str(social.tiktok, 200) },
    whatsapp_number: String(settings.whatsapp_number || '').replace(/\D/g, '').slice(0, 15),
  };
}

// ── Helpers de catálogo ──────────────────────────────────────────────────────
const PRODUCT_COLUMNS = 'id, name, description, category, gender, price, image_url, images, option_images, stock, min_stock, has_variants, is_bundle, created_at';
const VARIANT_COLUMNS = 'id, product_id, attributes, stock, image_url, is_active';

async function loadActiveVariants(businessId, productIds) {
  if (productIds.length === 0) return {};
  const { data, error } = await supabaseAdmin
    .from('product_variants')
    .select(VARIANT_COLUMNS)
    .eq('business_id', businessId)
    .eq('is_active', true)
    .in('product_id', productIds);
  if (error) throw error;
  const byProduct = {};
  for (const v of data || []) (byProduct[v.product_id] ||= []).push(v);
  return byProduct;
}

function sizeOf(attributes) {
  for (const [k, v] of Object.entries(attributes || {})) {
    if (SIZE_KEYS.includes(normalizeAttributeName(k)) && String(v).trim()) return String(v).trim();
  }
  return null;
}

function stockFlags(product, variants) {
  const inStock = product.has_variants
    ? variants.some((v) => Number(v.stock) > 0)
    : Number(product.stock) > 0;
  // Solo el booleano: el número exacto y min_stock no se exponen
  const lowStock = inStock && Number(product.stock) <= Number(product.min_stock || 0);
  return { in_stock: inStock, low_stock: lowStock };
}

function colorSwatches(product, variants) {
  return getColorOptions(variants, product.option_images || {}).map((o) => ({
    key: o.key,
    name: o.label,
    // Solo una foto de ESTE color (nunca la galería general ni la de otro color); null si no tiene
    image: colorOnlyImages({ product, variants, selectedAttributes: { color: o.label } })[0] || null,
    available: variants.some((v) => {
      const attr = findColorAttribute(v.attributes);
      return attr && normalizeOptionKey(attr.value) === o.key && Number(v.stock) > 0;
    }),
  }));
}

// Sets: producto "adaptado" (has_variants y stock calculados) + variantes derivadas de sus componentes.
// Con eso productCard, colorSwatches y resolveImages funcionan igual que con un producto normal.
async function bundleViews(businessId, products) {
  const sets = (products || []).filter((p) => p.is_bundle);
  if (sets.length === 0) return {};
  const { componentsByBundle, variantsByProduct } = await loadBundles(supabaseAdmin, businessId, sets.map((p) => p.id));
  const out = {};
  for (const p of sets) {
    const components = componentsByBundle[p.id] || [];
    const d = deriveBundle(p, components, variantsByProduct);
    const variants = d.error ? [] : d.variants;
    const stock = d.error ? 0 : (d.hasVariants ? variants.reduce((n, v) => n + v.stock, 0) : d.simpleStock);
    // Categorías de sus productos (públicas): la tienda decide con ellas si el set es de Mujer u Hombre
    const bundleCategories = [...new Set(components.map((c) => c.product.category).filter(Boolean))];
    out[p.id] = { product: { ...p, has_variants: d.hasVariants && !d.error, stock, bundle_categories: bundleCategories }, variants, components, derived: d };
  }
  return out;
}

function productCard(product, variants) {
  const sizes = [];
  for (const v of variants) {
    const size = sizeOf(v.attributes);
    if (size && Number(v.stock) > 0 && !sizes.some((s) => s.toLowerCase() === size.toLowerCase())) sizes.push(size);
  }
  return {
    id: product.id,
    name: product.name,
    description: product.description || '',
    category: product.category || null,
    gender: product.gender || 'mujer',
    price: toNumber(product.price),
    images: uniqueUrls([product.image_url, ...(Array.isArray(product.images) ? product.images : [])]),
    colors: product.has_variants ? colorSwatches(product, variants) : [],
    sizes_available: sizes,
    ...stockFlags(product, variants),
    // Solo en sets (los productos normales quedan idénticos)
    ...(product.is_bundle ? { is_bundle: true, bundle_categories: product.bundle_categories || [] } : {}),
  };
}

// Atributos disponibles: { color: ['Negro','Azul'], talla: ['S','M'] } con la primera forma vista
function attributeOptions(variants) {
  const out = {};
  const seen = {};
  for (const v of variants) {
    for (const [k, val] of Object.entries(v.attributes || {})) {
      const name = normalizeAttributeName(k);
      const value = String(val).trim();
      if (!name || !value) continue;
      out[name] ||= [];
      seen[name] ||= new Set();
      const key = normalizeOptionKey(value);
      if (!seen[name].has(key)) { seen[name].add(key); out[name].push(value); }
    }
  }
  return out;
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// ── GET /api/store/:slug ─────────────────────────────────────────────────────
async function getStore(req, res) {
  return res.json({ success: true, data: { name: req.storeBusiness.name, ...publicSettings(req.storeBusiness.settings) } });
}

// ── GET /api/store/:slug/products ────────────────────────────────────────────
async function listProducts(req, res) {
  try {
    const category = str(req.query.category, 60);
    const q = str(req.query.q, 60);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), MAX_PAGE_SIZE);
    const from = (page - 1) * limit;

    let query = supabaseAdmin
      .from('products')
      .select(PRODUCT_COLUMNS, { count: 'exact' })
      .eq('business_id', req.storeBusinessId)
      .eq('is_active', true);
    if (category) query = query.ilike('category', escapeLike(category));
    if (q) query = query.ilike('name', `%${escapeLike(q)}%`);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);
    if (error) throw error;

    const products = data || [];
    const variantsByProduct = await loadActiveVariants(req.storeBusinessId, products.filter((p) => p.has_variants && !p.is_bundle).map((p) => p.id));
    const sets = await bundleViews(req.storeBusinessId, products);
    return res.json({
      success: true,
      data: {
        products: products.map((p) => (sets[p.id] ? productCard(sets[p.id].product, sets[p.id].variants) : productCard(p, variantsByProduct[p.id] || []))),
        page,
        limit,
        total: count || 0,
      },
    });
  } catch (err) {
    logger.error('store.listProducts: ' + err.message);
    return serverError(res);
  }
}

// ── GET /api/store/:slug/products/:id ────────────────────────────────────────
async function getProduct(req, res) {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return notFound(res, 'Producto no encontrado.');
    const { data: rawProduct, error } = await supabaseAdmin
      .from('products')
      .select(PRODUCT_COLUMNS)
      .eq('id', id)
      .eq('business_id', req.storeBusinessId)
      .eq('is_active', true)
      .maybeSingle();
    if (error || !rawProduct) return notFound(res, 'Producto no encontrado.');

    // Set: producto adaptado + variantes derivadas (sin stock ni variantes propias)
    const set = rawProduct.is_bundle ? (await bundleViews(req.storeBusinessId, [rawProduct]))[rawProduct.id] : null;
    const product = set ? set.product : rawProduct;
    const variants = set ? set.variants
      : (product.has_variants ? ((await loadActiveVariants(req.storeBusinessId, [id]))[id] || []) : []);
    const card = productCard(product, variants);

    // Por color, solo sus fotos; un color sin fotos propias va vacío y la ficha muestra la galería general
    const imagesByColor = {};
    for (const c of card.colors) {
      imagesByColor[c.key] = colorOnlyImages({ product, variants, selectedAttributes: { color: c.name } });
    }

    return res.json({
      success: true,
      data: {
        ...card,
        attributes: attributeOptions(variants),
        // Las variantes no tienen precio propio en ZITA: todas usan el precio del producto
        variants: variants.map((v) => ({
          id: v.id,
          attributes: v.attributes || {},
          available: Number(v.stock) > 0,
          max_qty: Math.max(Math.min(Number(v.stock) || 0, MAX_QTY_PER_LINE), 0),
        })),
        max_qty: product.has_variants ? null : Math.max(Math.min(Number(product.stock) || 0, MAX_QTY_PER_LINE), 0),
        images_by_color: imagesByColor,
        // Solo lectura: qué incluye el set (sin costos ni ids internos)
        ...(set ? { bundle: { components: set.components.map((c) => ({ name: c.product.name, quantity: Number(c.quantity) || 1 })) } } : {}),
      },
    });
  } catch (err) {
    logger.error('store.getProduct: ' + err.message);
    return serverError(res);
  }
}

// ── GET /api/store/:slug/categories ──────────────────────────────────────────
async function listCategories(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('category')
      .eq('business_id', req.storeBusinessId)
      .eq('is_active', true)
      .not('category', 'is', null)
      .limit(5000);
    if (error) throw error;
    const counts = new Map();
    for (const row of data || []) {
      const name = String(row.category || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!counts.has(key)) counts.set(key, { name, count: 0 });
      counts.get(key).count += 1;
    }
    const categories = [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    return res.json({ success: true, data: { categories } });
  } catch (err) {
    logger.error('store.listCategories: ' + err.message);
    return serverError(res);
  }
}

// ── Pedido público ───────────────────────────────────────────────────────────
const variantLabel = (attributes) => Object.values(attributes || {}).map((v) => String(v).trim()).filter(Boolean).join(' / ');

function publicOrder(order) {
  const total = toNumber(order.total_amount);
  const shipping = toNumber(order.shipping_cost);
  return {
    id: order.id,
    code: orderCode(order.id),
    total,
    subtotal: round2(total - shipping),
    shipping_cost: shipping,
    status: order.status,
  };
}

function whatsappUrl(settings, order, items, customerName, storeName) {
  const number = String(settings.whatsapp_number || '').replace(/\D/g, '');
  if (!number) return null;
  const lines = items.map((i) => `• ${i.quantity} x ${i.description}`);
  const text = [
    `Hola, acabo de hacer el pedido ${orderCode(order.id)} en ${storeName}:`,
    ...lines,
    `Total: ${formatCOP(order.total_amount)}`,
    `A nombre de: ${customerName}`,
  ].join('\n');
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

async function loadOrderItems(orderId, businessId) {
  const { data, error } = await supabaseAdmin
    .from('order_items')
    .select('description, quantity, unit_price')
    .eq('order_id', orderId)
    .eq('business_id', businessId);
  if (error) throw error;
  return data || [];
}

// Respuesta de un pedido ya creado (reintento con la misma idempotency_key)
async function respondExisting(req, res, orderId) {
  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .select('id, status, total_amount, shipping_cost, client_name')
    .eq('id', orderId)
    .eq('business_id', req.storeBusinessId)
    .single();
  if (error) throw error;
  const items = await loadOrderItems(order.id, req.storeBusinessId);
  return res.status(200).json({
    success: true,
    data: {
      order: publicOrder(order),
      whatsapp_url: whatsappUrl(publicSettings(req.storeBusiness.settings), order, items, order.client_name, req.storeBusiness.name),
      duplicate: true,
    },
  });
}

// Notificación al dueño: best-effort y fuera del ciclo de la respuesta. Nunca lanza.
function notifyOwner(contact, order, items, customer, city) {
  setImmediate(async () => {
    try {
      if (!contact?.owner_whatsapp || !contact?.whatsapp_phone_number_id || !contact?.whatsapp_access_token) return;
      const token = decrypt(contact.whatsapp_access_token);
      const text = [
        `🛒 *Nuevo pedido web ${orderCode(order.id)}*`,
        `Cliente: ${customer.name}`,
        `Teléfono: +${customer.phone}`,
        `Ciudad: ${city}`,
        '',
        ...items.map((i) => `• ${i.quantity} x ${i.description}`),
        '',
        `Total: ${formatCOP(order.total_amount)}`,
      ].join('\n');
      await sendMessage(contact.owner_whatsapp, text, token, contact.whatsapp_phone_number_id);
    } catch (err) {
      logger.warn(`store.notifyOwner order=${order.id}: ${err.message}`);
    }
  });
}

// Honeypot: el campo oculto "website" lleno indica un bot. Se responde 200 sin crear nada.
function honeypot(req, res, next) {
  const trap = req.body?.website;
  if (trap !== undefined && trap !== null && String(trap).trim() !== '') {
    logger.warn(`store.honeypot business=${req.storeBusinessId}`);
    const fakeId = crypto.randomUUID();
    return res.status(200).json({
      success: true,
      data: { order: { id: fakeId, code: orderCode(fakeId), total: 0, subtotal: 0, shipping_cost: 0, status: 'recibido' }, whatsapp_url: null },
    });
  }
  next();
}

// ── POST /api/store/:slug/orders ─────────────────────────────────────────────
async function createOrder(req, res) {
  const businessId = req.storeBusinessId;
  const { items, customer, shipping, payment_method, idempotency_key, consents } = req.body;
  let orderId = null;
  try {
    // 1) Idempotencia: mismo negocio + misma clave → el pedido ya creado
    const { data: existing, error: exErr } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('business_id', businessId)
      .eq('idempotency_key', idempotency_key)
      .maybeSingle();
    if (exErr) throw exErr;
    if (existing) return respondExisting(req, res, existing.id);

    // 2) Productos y variantes de ESTE negocio, activos. Precio y nombre salen de la base.
    const productIds = [...new Set(items.map((i) => i.product_id))];
    const { data: products, error: pErr } = await supabaseAdmin
      .from('products')
      .select('id, name, price, stock, has_variants, is_bundle')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .in('id', productIds);
    if (pErr) throw pErr;
    const productById = Object.fromEntries((products || []).map((p) => [p.id, p]));
    const missingProducts = productIds.filter((id) => !productById[id]);
    if (missingProducts.length > 0) {
      return res.status(400).json({ success: false, error: 'producto_no_disponible', items: missingProducts });
    }

    const variantIds = [...new Set(items.filter((i) => !productById[i.product_id].is_bundle).map((i) => i.variant_id).filter(Boolean))];
    let variantById = {};
    if (variantIds.length > 0) {
      const { data: variants, error: vErr } = await supabaseAdmin
        .from('product_variants')
        .select('id, product_id, attributes, stock')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .in('id', variantIds);
      if (vErr) throw vErr;
      variantById = Object.fromEntries((variants || []).map((v) => [v.id, v]));
    }

    // Sets del pedido: variantes derivadas de sus componentes (mismo negocio, calculado en el servidor)
    const sets = await bundleViews(businessId, (products || []).filter((p) => p.is_bundle));
    const hasSets = Object.keys(sets).length > 0;

    const badVariants = [];
    const setVariantOf = []; // por índice de item: variante derivada elegida (o null)
    items.forEach((item, idx) => {
      const p = productById[item.product_id];
      if (p.is_bundle) {
        const set = sets[p.id];
        if (!set || set.derived.error) { badVariants.push(item.variant_id || item.product_id); return; }
        if (set.product.has_variants) {
          const dv = item.variant_id ? set.variants.find((v) => v.id === item.variant_id) : null;
          if (!dv) badVariants.push(item.variant_id || item.product_id);
          setVariantOf[idx] = dv || null;
        } else if (item.variant_id) {
          badVariants.push(item.variant_id);
        }
      } else if (p.has_variants) {
        const v = item.variant_id ? variantById[item.variant_id] : null;
        if (!v || v.product_id !== p.id) badVariants.push(item.variant_id || item.product_id);
      } else if (item.variant_id) {
        badVariants.push(item.variant_id);
      }
    });
    if (badVariants.length > 0) {
      return res.status(400).json({ success: false, error: 'variante_no_disponible', items: [...new Set(badVariants)] });
    }

    // 3) Líneas (totales calculados en el servidor; cualquier precio del body se ignora) y movimientos de
    //    stock: línea normal → ella misma; línea de set → un movimiento por componente (snapshot)
    const available = {}; // clave (variant_id || product_id) → stock disponible
    const lines = items.map((item, idx) => {
      const p = productById[item.product_id];
      const unitPrice = toNumber(p.price);
      const lineId = item.variant_id || item.product_id;
      if (p.is_bundle) {
        const set = sets[p.id];
        const dv = setVariantOf[idx] || null;
        const snapshot = bundleSnapshot(set.product, dv, set.components);
        const parts = dv ? dv.components
          : set.components.map((c) => ({ product_id: c.product.id, variant_id: null, stock: Number(c.product.stock) || 0 }));
        for (const c of parts) available[c.variant_id || c.product_id] = Number(c.stock) || 0;
        const label = dv ? bundleVariantLabel(dv.attributes) : '';
        return {
          lineId,
          moves: snapshot.components.map((c) => ({
            product_id: c.product_id, variant_id: c.variant_id, quantity: c.quantity * item.quantity,
            label: [c.name, c.label].filter(Boolean).join(' '),
          })),
          row: {
            product_id: p.id,
            variant_id: null,
            description: label ? `${p.name} (${label})` : p.name,
            quantity: item.quantity,
            unit_price: unitPrice,
            total_price: round2(unitPrice * item.quantity),
            bundle_snapshot: snapshot,
          },
        };
      }
      const v = item.variant_id ? variantById[item.variant_id] : null;
      available[lineId] = v ? Number(v.stock) : Number(p.stock);
      const label = v ? variantLabel(v.attributes) : '';
      const description = label ? `${p.name} (${label})` : p.name;
      return {
        lineId,
        moves: [{ product_id: p.id, variant_id: v ? v.id : null, quantity: item.quantity, label: description }],
        row: {
          product_id: p.id,
          variant_id: v ? v.id : null,
          description,
          quantity: item.quantity,
          unit_price: unitPrice,
          total_price: round2(unitPrice * item.quantity),
        },
      };
    });

    // Pre-chequeo de stock de TODO el pedido junto (piezas sueltas + componentes de sets).
    // adjust_stock sigue siendo la verdad.
    const needed = {};
    const usedBy = {};
    for (const line of lines) {
      for (const m of line.moves) {
        const key = m.variant_id || m.product_id;
        needed[key] = (needed[key] || 0) + m.quantity;
        (usedBy[key] ||= { lines: new Set(), label: m.label }).lines.add(line.lineId);
      }
    }
    const shortKeys = Object.entries(needed).filter(([key, qty]) => !(available[key] >= qty)).map(([key]) => key);
    if (shortKeys.length > 0) {
      const shortLines = [...new Set(shortKeys.flatMap((k) => [...usedBy[k].lines]))];
      return res.status(409).json({
        success: false,
        error: 'sin_stock',
        items: shortLines,
        // Solo con sets: qué pieza falta ("Licra Aria S / Negro"). Pedidos sin sets: respuesta igual que antes
        ...(hasSets ? { missing: shortKeys.map((k) => usedBy[k].label) } : {}),
      });
    }

    // 4) Totales
    const subtotal = round2(lines.reduce((sum, l) => sum + l.row.total_price, 0));
    const settings = publicSettings(req.storeBusiness.settings);
    // Envío por ciudad y subtotal de productos, con las tarifas del negocio (nunca del cliente)
    const { zone: shippingZone, cost: shippingCost } = calculateShipping({
      subtotal, city: shipping.city, settings: req.storeBusiness.settings,
    });
    const total = round2(subtotal + shippingCost);

    // 5) Pedido
    const acceptedAt = new Date().toISOString();
    const marketingWhatsapp = consents.marketing_whatsapp === true;
    const marketingEmail = consents.marketing_email === true;
    const { data: order, error: oErr } = await supabaseAdmin
      .from('orders')
      .insert({
        business_id: businessId,
        client_id: null,
        client_name: customer.name,
        client_phone: customer.phone,
        customer_email: customer.email || null,
        delivery_type: 'envio',
        delivery_address: shipping.address,
        shipping_city: shipping.city,
        notes: shipping.notes || null,
        status: 'recibido',
        payment_status: 'pendiente',
        payment_method,
        total_amount: total,
        shipping_cost: shippingCost,
        shipping_zone: shippingZone,
        // Aceptaciones (Anexo 1.2): hora del servidor; las dos primeras ya las exigió el validador
        terms_accepted_at: acceptedAt,
        terms_version: TERMS_VERSION,
        data_auth_at: acceptedAt,
        marketing_whatsapp: marketingWhatsapp,
        marketing_email: marketingEmail,
        marketing_consent_at: marketingWhatsapp || marketingEmail ? acceptedAt : null,
        source: 'web',
        idempotency_key,
      })
      .select('id, status, total_amount, shipping_cost')
      .single();
    if (oErr) {
      // Dos peticiones simultáneas con la misma clave: gana una, la otra devuelve ese pedido
      if (oErr.code === '23505') {
        const { data: dup } = await supabaseAdmin.from('orders').select('id')
          .eq('business_id', businessId).eq('idempotency_key', idempotency_key).maybeSingle();
        if (dup) return respondExisting(req, res, dup.id);
      }
      throw oErr;
    }
    orderId = order.id;

    // 6) Ítems (snapshot de nombre y precio)
    const { error: iErr } = await supabaseAdmin
      .from('order_items')
      .insert(lines.map((l) => ({ ...l.row, order_id: orderId, business_id: businessId })));
    if (iErr) throw iErr;

    // 7) Stock: un adjust_stock por movimiento (un set: uno por componente). Si uno falla se revierten
    //    los ya aplicados y se borra el pedido. Si un revert falla, el pedido no se borra: se cancela y
    //    se marca para revisar el inventario (ver utils/orderCleanup.js).
    let revertFailed = false;
    try {
      await applyMoves(
        lines.flatMap((l) => l.moves.map((m) => ({ ...m, lineId: l.lineId }))),
        { businessId, type: 'venta', refType: 'order', refId: orderId, revertReason: 'Reversión por error en pedido web' },
        undefined,
        (done, revErr) => {
          revertFailed = true;
          logger.error(`store.createOrder revert failed order=${orderId}: ${revErr.message}`);
        },
      );
    } catch (stockErr) {
      if (revertFailed) await flagForReview(supabaseAdmin, logger, { orderId, businessId });
      else await discardOrder(supabaseAdmin, logger, { orderId, businessId });
      orderId = null;
      if (stockErr.message?.includes('STOCK_INSUFICIENTE_O_NO_ENCONTRADO')) {
        const failed = stockErr.failedMove;
        return res.status(409).json({
          success: false,
          error: 'sin_stock',
          items: [failed?.lineId].filter(Boolean),
          ...(hasSets && failed ? { missing: [failed.label] } : {}),
        });
      }
      throw stockErr;
    }

    logger.info(`store.createOrder ok order=${orderId} business=${businessId} items=${lines.length} phone=${maskPhone(customer.phone)}`);
    notifyOwner(req.storeOwnerContact, order, lines.map((l) => l.row), customer, shipping.city);

    return res.status(201).json({
      success: true,
      data: {
        order: publicOrder(order),
        whatsapp_url: whatsappUrl(settings, order, lines.map((l) => l.row), customer.name, req.storeBusiness.name),
      },
    });
  } catch (err) {
    logger.error(`store.createOrder business=${businessId}: ${err.message}`);
    // Si el pedido alcanzó a crearse pero algo falló antes de descontar stock, se borra
    if (orderId) await discardOrder(supabaseAdmin, logger, { orderId, businessId });
    return serverError(res);
  }
}

// ── GET /api/store/:slug/orders/:id?phone= ───────────────────────────────────
async function getOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const phone = normalizeColombianPhone(req.query.phone);
    if (!UUID_RE.test(id) || !phone) return notFound(res, 'Pedido no encontrado.');
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select('id, status, total_amount, shipping_cost, payment_method')
      .eq('id', id)
      .eq('business_id', req.storeBusinessId)
      .eq('source', 'web')
      .eq('client_phone', phone)
      .maybeSingle();
    if (error || !order) return notFound(res, 'Pedido no encontrado.');
    const items = await loadOrderItems(order.id, req.storeBusinessId);
    return res.json({
      success: true,
      data: {
        code: orderCode(order.id),
        status: order.status,
        total: toNumber(order.total_amount),
        payment_method: str(order.payment_method, 30) || null,
        items: items.map((i) => ({ description: i.description, quantity: i.quantity, unit_price: toNumber(i.unit_price) })),
      },
    });
  } catch (err) {
    logger.error('store.getOrderStatus: ' + err.message);
    return serverError(res);
  }
}

module.exports = { getStore, listProducts, getProduct, listCategories, honeypot, createOrder, getOrderStatus, orderCode };
