// API pública de la tienda (/api/store/:slug). Sin sesión: el negocio viene de req.storeBusinessId
// (storeContext, por slug). Todas las respuestas usan listas blancas de campos.
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { getColorOptions, resolveImages, uniqueUrls } = require('../utils/variantImages');
const { findColorAttribute, normalizeOptionKey, normalizeAttributeName } = require('../utils/optionKey');
const { normalizeColombianPhone, maskPhone } = require('../utils/phone');
const { decrypt } = require('../utils/encrypt');
const { sendMessage } = require('../config/whatsapp');

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
    free_shipping_from: toNumber(settings.free_shipping_from, 0),
    payment_methods: str(settings.payment_methods, 300),
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
const PRODUCT_COLUMNS = 'id, name, description, category, price, image_url, images, option_images, stock, min_stock, has_variants, created_at';
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
    image: resolveImages({ product, variants, selectedAttributes: { color: o.label } }).images[0] || null,
    available: variants.some((v) => {
      const attr = findColorAttribute(v.attributes);
      return attr && normalizeOptionKey(attr.value) === o.key && Number(v.stock) > 0;
    }),
  }));
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
    price: toNumber(product.price),
    images: uniqueUrls([product.image_url, ...(Array.isArray(product.images) ? product.images : [])]),
    colors: product.has_variants ? colorSwatches(product, variants) : [],
    sizes_available: sizes,
    ...stockFlags(product, variants),
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
    const variantsByProduct = await loadActiveVariants(req.storeBusinessId, products.filter((p) => p.has_variants).map((p) => p.id));
    return res.json({
      success: true,
      data: {
        products: products.map((p) => productCard(p, variantsByProduct[p.id] || [])),
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
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .select(PRODUCT_COLUMNS)
      .eq('id', id)
      .eq('business_id', req.storeBusinessId)
      .eq('is_active', true)
      .maybeSingle();
    if (error || !product) return notFound(res, 'Producto no encontrado.');

    const variants = product.has_variants ? ((await loadActiveVariants(req.storeBusinessId, [id]))[id] || []) : [];
    const card = productCard(product, variants);

    const imagesByColor = {};
    for (const c of card.colors) {
      imagesByColor[c.key] = resolveImages({ product, variants, selectedAttributes: { color: c.name } }).images;
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

async function callAdjustStock(params) {
  const { data, error } = await supabaseAdmin.rpc('adjust_stock', params);
  if (error) throw error;
  return data;
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
  const { items, customer, shipping, payment_method, idempotency_key } = req.body;
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
      .select('id, name, price, stock, has_variants')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .in('id', productIds);
    if (pErr) throw pErr;
    const productById = Object.fromEntries((products || []).map((p) => [p.id, p]));
    const missingProducts = productIds.filter((id) => !productById[id]);
    if (missingProducts.length > 0) {
      return res.status(400).json({ success: false, error: 'producto_no_disponible', items: missingProducts });
    }

    const variantIds = [...new Set(items.map((i) => i.variant_id).filter(Boolean))];
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

    const badVariants = [];
    for (const item of items) {
      const p = productById[item.product_id];
      if (p.has_variants) {
        const v = item.variant_id ? variantById[item.variant_id] : null;
        if (!v || v.product_id !== p.id) badVariants.push(item.variant_id || item.product_id);
      } else if (item.variant_id) {
        badVariants.push(item.variant_id);
      }
    }
    if (badVariants.length > 0) {
      return res.status(400).json({ success: false, error: 'variante_no_disponible', items: [...new Set(badVariants)] });
    }

    // 3) Pre-chequeo de stock (sumando líneas repetidas). adjust_stock sigue siendo la verdad.
    const needed = {};
    for (const item of items) {
      const key = item.variant_id || item.product_id;
      needed[key] = (needed[key] || 0) + item.quantity;
    }
    const short = Object.entries(needed)
      .filter(([key, qty]) => {
        const available = variantById[key] ? Number(variantById[key].stock) : Number(productById[key]?.stock);
        return !(available >= qty);
      })
      .map(([key]) => key);
    if (short.length > 0) return res.status(409).json({ success: false, error: 'sin_stock', items: short });

    // 4) Totales calculados en el servidor (cualquier precio del body se ignora)
    const lines = items.map((item) => {
      const p = productById[item.product_id];
      const v = item.variant_id ? variantById[item.variant_id] : null;
      const unitPrice = toNumber(p.price);
      const label = v ? variantLabel(v.attributes) : '';
      return {
        product_id: p.id,
        variant_id: v ? v.id : null,
        description: label ? `${p.name} (${label})` : p.name,
        quantity: item.quantity,
        unit_price: unitPrice,
        total_price: round2(unitPrice * item.quantity),
      };
    });
    const subtotal = round2(lines.reduce((s, l) => s + l.total_price, 0));
    const settings = publicSettings(req.storeBusiness.settings);
    const shippingCost = settings.free_shipping_from > 0 && subtotal >= settings.free_shipping_from ? 0 : settings.shipping_flat_cost;
    const total = round2(subtotal + shippingCost);

    // 5) Pedido
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
      .insert(lines.map((l) => ({ ...l, order_id: orderId, business_id: businessId })));
    if (iErr) throw iErr;

    // 7) Stock: un adjust_stock por ítem; si uno falla se restauran los anteriores y se borra el pedido
    const applied = [];
    for (const line of lines) {
      try {
        await callAdjustStock({
          p_business_id: businessId,
          p_product_id: line.product_id,
          p_variant_id: line.variant_id,
          p_change: -line.quantity,
          p_type: 'venta',
          p_reason: null,
          p_ref_type: 'order',
          p_ref_id: orderId,
          p_user: null,
        });
        applied.push(line);
      } catch (stockErr) {
        for (const done of applied) {
          try {
            await callAdjustStock({
              p_business_id: businessId,
              p_product_id: done.product_id,
              p_variant_id: done.variant_id,
              p_change: done.quantity,
              p_type: 'ajuste',
              p_reason: 'Reversión por error en pedido web',
              p_ref_type: 'order',
              p_ref_id: orderId,
              p_user: null,
            });
          } catch (revErr) {
            logger.error(`store.createOrder revert failed order=${orderId}: ${revErr.message}`);
          }
        }
        await supabaseAdmin.from('order_items').delete().eq('order_id', orderId);
        await supabaseAdmin.from('orders').delete().eq('id', orderId).eq('business_id', businessId);
        orderId = null;
        if (stockErr.message?.includes('STOCK_INSUFICIENTE_O_NO_ENCONTRADO')) {
          return res.status(409).json({ success: false, error: 'sin_stock', items: [line.variant_id || line.product_id] });
        }
        throw stockErr;
      }
    }

    logger.info(`store.createOrder ok order=${orderId} business=${businessId} items=${lines.length} phone=${maskPhone(customer.phone)}`);
    notifyOwner(req.storeOwnerContact, order, lines, customer, shipping.city);

    return res.status(201).json({
      success: true,
      data: {
        order: publicOrder(order),
        whatsapp_url: whatsappUrl(settings, order, lines, customer.name, req.storeBusiness.name),
      },
    });
  } catch (err) {
    logger.error(`store.createOrder business=${businessId}: ${err.message}`);
    // Si el pedido alcanzó a crearse pero algo falló antes de descontar stock, se borra
    if (orderId) {
      await supabaseAdmin.from('order_items').delete().eq('order_id', orderId);
      await supabaseAdmin.from('orders').delete().eq('id', orderId).eq('business_id', businessId);
    }
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
      .select('id, status, total_amount, shipping_cost')
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
        items: items.map((i) => ({ description: i.description, quantity: i.quantity, unit_price: toNumber(i.unit_price) })),
      },
    });
  } catch (err) {
    logger.error('store.getOrderStatus: ' + err.message);
    return serverError(res);
  }
}

module.exports = { getStore, listProducts, getProduct, listCategories, honeypot, createOrder, getOrderStatus, orderCode };
