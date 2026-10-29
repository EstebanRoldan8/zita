// Asistente para negocios TIENDA (FLOW): herramientas propias, confirmación obligatoria antes de escribir
// y deshacer real. Los negocios que no son tienda NO pasan por aquí.
//
// Reglas que garantiza el SERVIDOR (no dependen de que el modelo obedezca):
//  - business_id siempre de la sesión (ctx.businessId); ningún input de las tools lo acepta.
//  - Toda escritura es en dos pasos: preparar_* guarda una acción 'pending' en assistant_actions y devuelve
//    el resumen; confirmar_accion la ejecuta SOLO si se propuso en un mensaje ANTERIOR (el usuario la vio) y
//    el mensaje actual del usuario es un "sí".
//  - El stock cambia solo con adjust_stock, a nivel de VARIANTE si el producto tiene variantes, y siempre se
//    revisa el { error } del rpc (no lanza). El resultado que se informa es el leído de la base después.
//  - Deshacer aplica la operación inversa (stock con adjust_stock "deshacer asistente") y vuelve a leer.
// Reutiliza los controladores del panel (pedidos, productos, variantes) con el token del usuario.

const { normalizeOptionKey } = require('../utils/optionKey');
const { loadBundles, deriveBundle } = require('../utils/bundles');
const { calculateShipping } = require('../config/shipping');
const { parseDiscount, computeTotals } = require('../utils/orderTotals');

const ACTION_TTL_MS = 30 * 60 * 1000;
const UNDO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_QTY = 10000;
const PAYMENT_WINDOW_H = 24;

// ── Utilidades ────────────────────────────────────────────────────────────────
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const cop = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const orderCode = (id) => `P-${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
const text = (v, max = 80) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const attr = (attributes, name) => {
  for (const [k, v] of Object.entries(attributes || {})) if (norm(k) === name) return String(v);
  return '';
};
const variantLabel = (v) => [attr(v.attributes, 'color'), attr(v.attributes, 'talla')].filter(Boolean).join(' talla ') || Object.values(v.attributes || {}).join(' / ');

// "sí", "si", "dale", "confirmo", "listo"... al inicio del mensaje, sin "no" delante
const AFFIRMATIVE = /^(s[ií]|sip|claro|dale|ok(ay)?|listo|confirm(o|ado|a)|de una|h[aá]gale|hazlo|adelante|correcto|perfecto|va|vale|eso)\b/;
function isAffirmative(message) {
  const m = norm(message).replace(/^[¡!¿?.,\s]+/, '');
  if (!m || /^no\b/.test(m)) return false;
  return AFFIRMATIVE.test(m) || /\bconfirmo\b/.test(m);
}

function isNegative(message) {
  const m = norm(message).replace(/^[¡!¿?.,\s]+/, '');
  return /^(no|nop|nel|cancela|cancelar|mejor no|olvidalo|dejalo asi|espera)\b/.test(m);
}

// "devuélvelo como estaba", "deshaz eso", "revierte", "reversa"
function isUndoIntent(message) {
  return /(devuelv|deshaz|deshac|revert|revie|reversa|como estaba)/.test(norm(message));
}

// La respuesta afirma que se HIZO un cambio (para no dejar pasar un "✅ listo" sin escritura real)
function claimsWrite(text) {
  const t = norm(text);
  return /\b(listo|hecho|ya quedo|ya esta)\b/.test(t) && /(quedo|volvio|paso de|actualic|registr|cambi[eo]|sum[eo]|rest[eo]|cancel[eo]|desactiv|activ[eo])/.test(t);
}

// Coincidencia de productos por nombre: exacta primero; luego todas las palabras (>= 3 letras) presentes
function matchProducts(products, query) {
  const q = norm(query);
  if (!q) return [];
  const exact = products.filter((p) => norm(p.name) === q);
  if (exact.length) return exact;
  const words = q.split(' ').filter((w) => w.length >= 3);
  return products.filter((p) => {
    const n = norm(p.name);
    return n.includes(q) || (words.length > 0 && words.every((w) => n.includes(w)));
  });
}

function matchVariants(variants, color, talla) {
  const c = norm(color);
  const t = norm(talla);
  return variants.filter((v) => (!c || norm(attr(v.attributes, 'color')) === c) && (!t || norm(attr(v.attributes, 'talla')) === t));
}

// ── Herramientas (esquemas) ───────────────────────────────────────────────────
const STORE_TOOLS = [
  {
    name: 'consultar_stock',
    description: 'Stock REAL por variante (color + talla) leído de la base. Filtra por producto, color, talla, agotados o poco stock. Úsala SIEMPRE antes de responder cuánto hay.',
    input_schema: {
      type: 'object',
      properties: {
        producto: { type: 'string', description: 'Nombre o parte del nombre (opcional)' },
        color: { type: 'string' },
        talla: { type: 'string' },
        filtro: { type: 'string', enum: ['todos', 'agotados', 'poco_stock'], description: 'Default todos' },
      },
    },
  },
  {
    name: 'buscar_productos_tienda',
    description: 'Lista productos con precio, costo, margen, género, categoría, colores, stock total (suma de variantes) y si está activo. Filtra por texto, género, categoría o color (los drops son grupos de colores).',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string' },
        genero: { type: 'string', enum: ['mujer', 'hombre', 'unisex'] },
        categoria: { type: 'string' },
        color: { type: 'string' },
        incluir_inactivos: { type: 'boolean' },
      },
    },
  },
  {
    name: 'consultar_sets',
    description: 'Sets (combos): componentes, precio, costo (suma de componentes), margen, estado y disponibilidad por color y talla (limitada por la pieza con menos stock).',
    input_schema: { type: 'object', properties: { nombre: { type: 'string' } } },
  },
  {
    name: 'consultar_pedidos',
    description: 'Pedidos con total neto (descuento y envío incluidos), estado, pago y cliente. Filtra por código (P-XXXXXXXX), cliente, pendientes de pago, estado o fechas.',
    input_schema: {
      type: 'object',
      properties: {
        codigo: { type: 'string', description: 'Código P-XXXXXXXX' },
        cliente: { type: 'string' },
        pago: { type: 'string', enum: ['pendiente', 'pagado'] },
        estado: { type: 'string', enum: ['recibido', 'en_proceso', 'listo', 'enviado', 'entregado', 'cancelado'] },
        desde: { type: 'string', description: 'YYYY-MM-DD' },
        hasta: { type: 'string', description: 'YYYY-MM-DD' },
        limite: { type: 'number' },
      },
    },
  },
  {
    name: 'ventas_tienda',
    description: 'Ventas por pedidos (no cancelados) de hoy, semana, mes o un rango: total neto, descuentos, envíos, pagado vs pendiente y unidades por producto.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', enum: ['hoy', 'semana', 'mes', 'rango'] },
        desde: { type: 'string' },
        hasta: { type: 'string' },
      },
      required: ['periodo'],
    },
  },
  {
    name: 'consultar_envio',
    description: 'Tarifas de envío por zona del negocio y, si das ciudad y subtotal, el costo exacto (incluye envío gratis desde cierto monto).',
    input_schema: { type: 'object', properties: { ciudad: { type: 'string' }, subtotal: { type: 'number' } } },
  },
  {
    name: 'preparar_ajuste_stock',
    description: 'PASO 1 para sumar o restar stock. Si el producto tiene variantes y no hay color y talla exactos, devuelve las variantes para que PREGUNTES cuál. Devuelve un resumen que debes repetir al usuario y pedir confirmación. NO escribe nada.',
    input_schema: {
      type: 'object',
      properties: {
        producto: { type: 'string' },
        color: { type: 'string' },
        talla: { type: 'string' },
        cantidad: { type: 'number', description: 'Positivo suma, negativo resta' },
        motivo: { type: 'string', description: 'llegada de mercancía, corrección, pérdida, devolución…' },
      },
      required: ['producto', 'cantidad'],
    },
  },
  {
    name: 'preparar_cambio_precio',
    description: 'PASO 1 para cambiar el precio de venta de un producto o set. Devuelve el resumen para confirmar. NO escribe nada.',
    input_schema: { type: 'object', properties: { producto: { type: 'string' }, precio: { type: 'number' } }, required: ['producto', 'precio'] },
  },
  {
    name: 'preparar_estado',
    description: 'PASO 1 para activar o desactivar un producto, un set o una variante (con color y talla). Devuelve el resumen para confirmar. NO escribe nada.',
    input_schema: {
      type: 'object',
      properties: { producto: { type: 'string' }, color: { type: 'string' }, talla: { type: 'string' }, activo: { type: 'boolean' } },
      required: ['producto', 'activo'],
    },
  },
  {
    name: 'preparar_pedido_manual',
    description: 'PASO 1 para registrar una venta/pedido manual (igual que el panel): descuenta stock por variante, cliente opcional, descuento en pesos opcional. Precios del sistema. Devuelve el resumen para confirmar. NO escribe nada.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { producto: { type: 'string' }, color: { type: 'string' }, talla: { type: 'string' }, cantidad: { type: 'number' } },
            required: ['producto', 'cantidad'],
          },
        },
        cliente_nombre: { type: 'string' },
        cliente_telefono: { type: 'string' },
        descuento: { type: 'number', description: 'Pesos, opcional' },
        pagado: { type: 'boolean', description: 'true si ya pagó' },
        metodo_pago: { type: 'string', enum: ['efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'otro'] },
        notas: { type: 'string' },
      },
      required: ['items'],
    },
  },
  {
    name: 'preparar_deshacer',
    description: 'PASO 1 para "devuélvelo como estaba": prepara la operación inversa de la última acción aplicada por el asistente (o de la indicada). Devuelve el resumen para confirmar o explica por qué no se puede.',
    input_schema: { type: 'object', properties: { accion_id: { type: 'string', description: 'Opcional; por defecto la última' } } },
  },
  {
    name: 'confirmar_accion',
    description: 'PASO 2: ejecuta la acción preparada que el usuario vio. SOLO cuando el usuario respondió "sí" en su ÚLTIMO mensaje. Si no tienes el confirmation_id, llámala sin él (usa la propuesta pendiente). Devuelve el resultado leído de la base.',
    input_schema: { type: 'object', properties: { confirmation_id: { type: 'string', description: 'Opcional' } } },
  },
  {
    name: 'cancelar_accion',
    description: 'Descarta la acción preparada cuando el usuario dice que no.',
    input_schema: { type: 'object', properties: { confirmation_id: { type: 'string', description: 'Opcional' } } },
  },
];

const STORE_PROMPT = `<tienda>
Este negocio es una TIENDA de ropa (no tiene citas ni empleados). Modelo de datos:
- Producto con VARIANTES: cada variante es color + talla y tiene su propio stock. El total del producto es la SUMA de sus variantes activas. NUNCA hables del "stock del producto" sin decir de qué variante; para cambiar stock SIEMPRE necesitas color y talla.
- SETS (combos, p. ej. "Set Aria" = Top Aria + Licra Aria): no tienen stock propio; su disponibilidad por color/talla es la de la pieza con menos unidades. Su costo es la suma de los costos de sus piezas.
- GÉNERO: mujer, hombre o unisex (unisex sale en ambas secciones). CATEGORÍAS: Tops, Licras, Shorts, Faldas, Pantalonetas, Camisetas, Sets, Flow Archive…
- DROPS: grupos de productos por color de la colección. Si te piden un drop por nombre y no sabes sus colores, PREGUNTA qué colores son.
- COSTO y MARGEN: margen = (precio − costo) / precio.
- PEDIDOS: total neto = subtotal + envío − descuento. Web: el cliente tiene ${PAYMENT_WINDOW_H} h para pagar; después el pedido se puede cancelar. Manual: cliente opcional y descuento en pesos.
- ENVÍO: tarifa local (ciudad del negocio), nacional y gratis desde cierto subtotal (consultar_envio).

REGLAS (obligatorias):
1. NUNCA inventes cifras: todo número sale de una herramienta de ESTE turno.
2. Si algo es ambiguo (varios productos, falta color o talla) → PREGUNTA, muestra las opciones y no asumas.
3. Para ESCRIBIR (stock, precio, activar/desactivar, pedido, deshacer): llama preparar_* → repite el "resumen" tal cual y pregunta "¿Confirmas?" → espera la respuesta. SOLO si el usuario dice "sí" en su siguiente mensaje llama confirmar_accion (con el confirmation_id si lo tienes; si no, sin él). NUNCA vuelvas a preparar la misma acción en el turno del "sí". Si dice que no, cancelar_accion.
4. Después de confirmar informa SIEMPRE antes → después con el valor que devolvió confirmar_accion (leído de la base). Si success es false di que FALLÓ y por qué; NUNCA digas "listo".
5. "Devuélvelo como estaba" / "deshaz eso" → preparar_deshacer y sigue la regla 3. Si dice que no se puede, explícalo.
6. Nunca muestres IDs técnicos (sí puedes mostrar códigos de pedido P-XXXXXXXX).
</tienda>`;

// Herramientas genéricas que en una tienda se reemplazan o no aplican (escribían el total del producto
// sin variante ni movimiento, o son de citas/servicios/empleados)
const GENERIC_TOOLS_HIDDEN_FOR_STORE = new Set([
  'ajustar_stock', 'actualizar_producto', 'vender_producto', 'registrar_venta', 'crear_producto', 'eliminar_producto',
  'activar_producto', 'desactivar_producto', 'buscar_producto', 'listar_productos',
  'buscar_servicio', 'listar_servicios', 'crear_servicio', 'actualizar_servicio', 'activar_servicio', 'desactivar_servicio', 'eliminar_servicio',
  'buscar_empleado', 'listar_empleados', 'crear_empleado', 'actualizar_empleado', 'eliminar_empleado', 'calcular_comisiones',
  'rendimiento_empleados', 'ver_agenda_empleado', 'listar_citas', 'ver_agenda_semana', 'crear_cita', 'cancelar_cita', 'buscar_cita',
  'confirmar_cita', 'completar_cita', 'actualizar_cita', 'citas_completadas', 'ver_citas_pendientes', 'confirmar_todas_pendientes',
  'ver_disponibilidad', 'horas_rentables', 'cerrar_dia_especial',
]);

function createStoreAssistant(deps) {
  const { db, controllers } = deps;
  const now = deps.now || (() => new Date());

  // ── Lecturas base (siempre acotadas al negocio de la sesión) ──
  async function loadProducts(businessId, { includeInactive = false } = {}) {
    let q = db.from('products')
      .select('id, name, price, cost_price, stock, min_stock, category, gender, is_active, is_bundle, has_variants')
      .eq('business_id', businessId);
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  async function loadVariants(businessId, productIds, { includeInactive = false } = {}) {
    if (!productIds.length) return [];
    let q = db.from('product_variants').select('id, product_id, attributes, stock, min_stock, is_active').eq('business_id', businessId).in('product_id', productIds);
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  async function readStock(businessId, productId, variantId) {
    if (variantId) {
      const { data } = await db.from('product_variants').select('stock, is_active').eq('business_id', businessId).eq('id', variantId).maybeSingle();
      return data ? data.stock : null;
    }
    const { data } = await db.from('products').select('stock').eq('business_id', businessId).eq('id', productId).maybeSingle();
    return data ? data.stock : null;
  }

  // Producto único por nombre o la lista para preguntar
  async function resolveProduct(businessId, query, opts = {}) {
    const products = await loadProducts(businessId, opts);
    const matches = matchProducts(products, query);
    if (matches.length === 0) return { error: `No encontré un producto que se llame "${text(query)}".`, sugerencias: products.slice(0, 15).map((p) => p.name) };
    if (matches.length > 1) return { needs: 'producto', pregunta: '¿Cuál de estos?', opciones: matches.slice(0, 15).map((p) => p.name) };
    return { product: matches[0] };
  }

  async function resolveVariant(businessId, product, color, talla, { includeInactive = false, required = true } = {}) {
    const variants = await loadVariants(businessId, [product.id], { includeInactive });
    if (!variants.length) return { variant: null };
    const hits = (color || talla) ? matchVariants(variants, color, talla) : [];
    if (hits.length === 1) return { variant: hits[0] };
    if (!required && !color && !talla) return { variant: null };
    return {
      needs: 'variante',
      pregunta: `${product.name} tiene variantes: ¿de cuál color y talla?`,
      opciones: variants.map((v) => ({ variante: variantLabel(v), stock: v.stock, activa: v.is_active })),
    };
  }

  // ── Registro de acciones ──
  async function savePending(businessId, kind, summary, plan) {
    const { data, error } = await db.from('assistant_actions').insert({
      business_id: businessId, kind, status: 'pending', summary, plan,
      expires_at: new Date(now().getTime() + ACTION_TTL_MS).toISOString(),
    }).select('id').single();
    if (error) throw error;
    return { requiere_confirmacion: true, confirmation_id: data.id, resumen: summary };
  }
  const finish = (id, businessId, fields) => db.from('assistant_actions').update(fields).eq('id', id).eq('business_id', businessId);

  // ── Lecturas para el modelo ──
  async function consultarStock(input, ctx) {
    const products = (await loadProducts(ctx.businessId)).filter((p) => !p.is_bundle);
    const scoped = input.producto ? matchProducts(products, input.producto) : products;
    if (input.producto && !scoped.length) return { encontrados: 0, mensaje: `No encontré "${text(input.producto)}".` };
    const variants = await loadVariants(ctx.businessId, scoped.map((p) => p.id));
    const rows = [];
    for (const p of scoped) {
      const vs = variants.filter((v) => v.product_id === p.id);
      const list = vs.length ? matchVariants(vs, input.color, input.talla) : [];
      if (!vs.length) rows.push({ producto: p.name, variante: null, stock: p.stock, minimo: p.min_stock });
      for (const v of list) rows.push({ producto: p.name, variante: variantLabel(v), stock: v.stock, minimo: v.min_stock ?? 2 });
    }
    const filtro = input.filtro || 'todos';
    const out = rows.filter((r) => (filtro === 'agotados' ? r.stock === 0 : filtro === 'poco_stock' ? r.stock > 0 && r.stock <= r.minimo : true));
    const descuadres = scoped.filter((p) => {
      const vs = variants.filter((v) => v.product_id === p.id);
      return vs.length && vs.reduce((s, v) => s + v.stock, 0) !== p.stock;
    }).map((p) => p.name);
    return { total_filas: out.length, filas: out.slice(0, 80), ...(descuadres.length ? { aviso_descuadre: `El total guardado no coincide con la suma de variantes en: ${descuadres.join(', ')}. Las cifras por variante son las reales.` } : {}) };
  }

  async function buscarProductos(input, ctx) {
    let products = await loadProducts(ctx.businessId, { includeInactive: !!input.incluir_inactivos });
    if (input.texto) products = matchProducts(products, input.texto);
    if (input.genero) products = products.filter((p) => p.gender === input.genero || (input.genero !== 'unisex' && p.gender === 'unisex'));
    if (input.categoria) products = products.filter((p) => norm(p.category) === norm(input.categoria));
    const variants = await loadVariants(ctx.businessId, products.map((p) => p.id));
    let rows = products.map((p) => {
      const vs = variants.filter((v) => v.product_id === p.id);
      const colors = [...new Set(vs.map((v) => attr(v.attributes, 'color')).filter(Boolean))];
      return {
        producto: p.name, categoria: p.category, genero: p.gender, precio: Number(p.price), costo: p.cost_price == null ? null : Number(p.cost_price),
        margen_pct: p.cost_price != null && p.price > 0 ? Number((((p.price - p.cost_price) / p.price) * 100).toFixed(1)) : null,
        es_set: !!p.is_bundle, activo: p.is_active, colores: colors,
        stock_total: p.is_bundle ? null : vs.length ? vs.reduce((s, v) => s + v.stock, 0) : p.stock,
      };
    });
    if (input.color) rows = rows.filter((r) => r.colores.some((c) => norm(c) === norm(input.color)));
    return { total: rows.length, productos: rows.slice(0, 60) };
  }

  async function consultarSets(input, ctx) {
    let sets = (await loadProducts(ctx.businessId, { includeInactive: true })).filter((p) => p.is_bundle);
    if (input.nombre) sets = matchProducts(sets, input.nombre);
    if (!sets.length) return { total: 0, mensaje: 'No hay sets con ese nombre.' };
    const { componentsByBundle, variantsByProduct } = await loadBundles(db, ctx.businessId, sets.map((s) => s.id));
    return {
      total: sets.length,
      sets: sets.map((s) => {
        const comps = componentsByBundle[s.id] || [];
        const d = deriveBundle(s, comps, variantsByProduct);
        const costs = comps.map((c) => (c.product.cost_price == null ? null : Number(c.product.cost_price) * c.quantity));
        const cost = costs.some((c) => c == null) ? null : costs.reduce((a, b) => a + b, 0);
        return {
          set: s.name, activo: s.is_active, precio: Number(s.price), costo: cost,
          margen_pct: cost != null && s.price > 0 ? Number((((s.price - cost) / s.price) * 100).toFixed(1)) : null,
          piezas: comps.map((c) => `${c.quantity > 1 ? `${c.quantity}× ` : ''}${c.product.name}`),
          disponibles_total: d.error ? 0 : d.hasVariants ? d.variants.reduce((n, v) => n + v.stock, 0) : d.simpleStock,
          por_variante: d.variants.map((v) => ({ variante: variantLabel(v), disponibles: v.stock })),
          ...(d.error ? { problema: d.error } : {}),
        };
      }),
    };
  }

  async function consultarPedidos(input, ctx) {
    let q = db.from('orders')
      .select('id, created_at, status, payment_status, payment_method, total_amount, shipping_cost, discount_amount, client_name, client_phone, source, shipping_city, order_items(description, quantity, unit_price)')
      .eq('business_id', ctx.businessId).order('created_at', { ascending: false });
    if (input.pago) q = q.eq('payment_status', input.pago);
    if (input.estado) q = q.eq('status', input.estado);
    if (input.desde) q = q.gte('created_at', `${text(input.desde, 10)}T00:00:00-05:00`);
    if (input.hasta) q = q.lte('created_at', `${text(input.hasta, 10)}T23:59:59-05:00`);
    const { data, error } = await q.limit(200);
    if (error) throw error;
    let rows = data || [];
    if (input.codigo) rows = rows.filter((o) => orderCode(o.id) === text(input.codigo, 12).toUpperCase());
    if (input.cliente) rows = rows.filter((o) => norm(o.client_name).includes(norm(input.cliente)) || String(o.client_phone || '').includes(text(input.cliente)));
    const limit = Math.min(Math.max(Number(input.limite) || 20, 1), 50);
    const ahora = now().getTime();
    return {
      total: rows.length,
      pedidos: rows.slice(0, limit).map((o) => {
        const horas = Math.floor((ahora - new Date(o.created_at).getTime()) / 3600000);
        return {
          codigo: orderCode(o.id), fecha: o.created_at, origen: o.source, estado: o.status, pago: o.payment_status, metodo: o.payment_method,
          cliente: o.client_name || 'Cliente sin datos', total_neto: Number(o.total_amount), envio: Number(o.shipping_cost || 0), descuento: Number(o.discount_amount || 0),
          items: (o.order_items || []).map((i) => `${i.quantity}× ${i.description}`),
          ...(o.payment_status === 'pendiente' && o.status !== 'cancelado' ? { horas_sin_pagar: horas, vencido_24h: horas >= PAYMENT_WINDOW_H } : {}),
        };
      }),
    };
  }

  async function ventasTienda(input, ctx) {
    const today = now().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    let desde = today; let hasta = today;
    if (input.periodo === 'semana') desde = new Date(now().getTime() - 6 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    if (input.periodo === 'mes') desde = `${today.slice(0, 7)}-01`;
    if (input.periodo === 'rango') { desde = text(input.desde, 10) || today; hasta = text(input.hasta, 10) || today; }
    const { data, error } = await db.from('orders')
      .select('id, status, payment_status, total_amount, shipping_cost, discount_amount, order_items(description, quantity)')
      .eq('business_id', ctx.businessId).neq('status', 'cancelado')
      .gte('created_at', `${desde}T00:00:00-05:00`).lte('created_at', `${hasta}T23:59:59-05:00`);
    if (error) throw error;
    const rows = data || [];
    const sum = (f) => rows.reduce((s, o) => s + Number(f(o) || 0), 0);
    const units = {};
    for (const o of rows) for (const i of o.order_items || []) units[i.description] = (units[i.description] || 0) + Number(i.quantity || 0);
    return {
      desde, hasta, pedidos: rows.length,
      total_neto: sum((o) => o.total_amount), descuentos: sum((o) => o.discount_amount), envios: sum((o) => o.shipping_cost),
      cobrado: rows.filter((o) => o.payment_status === 'pagado').reduce((s, o) => s + Number(o.total_amount), 0),
      pendiente_de_pago: rows.filter((o) => o.payment_status !== 'pagado').reduce((s, o) => s + Number(o.total_amount), 0),
      unidades_por_producto: Object.entries(units).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([p, u]) => ({ producto: p, unidades: u })),
    };
  }

  async function consultarEnvio(input, ctx) {
    const settings = ctx.business?.store_settings || (await db.from('businesses').select('store_settings').eq('id', ctx.businessId).maybeSingle()).data?.store_settings || {};
    const tarifas = { local: settings.shipping_local_cost ?? null, ciudad_local: settings.shipping_local_city || 'cali', nacional: settings.shipping_flat_cost ?? null, gratis_desde: settings.free_shipping_from || 0 };
    if (!input.ciudad) return { tarifas };
    const r = calculateShipping({ subtotal: Number(input.subtotal) || 0, city: text(input.ciudad), settings });
    return { tarifas, ciudad: text(input.ciudad), zona: r.zone, costo: r.cost };
  }

  // ── Preparar (no escribe datos del negocio) ──
  async function prepararAjuste(input, ctx) {
    const qty = Number(input.cantidad);
    if (!Number.isInteger(qty) || qty === 0 || Math.abs(qty) > MAX_QTY) return { success: false, error: 'La cantidad debe ser un entero distinto de 0.' };
    const r = await resolveProduct(ctx.businessId, input.producto);
    if (!r.product) return r;
    const p = r.product;
    if (p.is_bundle) return { success: false, error: `${p.name} es un set: no tiene stock propio. Ajusta el stock de sus piezas.` };
    const v = await resolveVariant(ctx.businessId, p, input.color, input.talla);
    if (v.needs) return v;
    const before = v.variant ? v.variant.stock : p.stock;
    if (before + qty < 0) return { success: false, error: `No se puede restar ${Math.abs(qty)}: ${p.name}${v.variant ? `, ${variantLabel(v.variant)}` : ''} tiene ${before}.` };
    const who = `${p.name}${v.variant ? `, ${variantLabel(v.variant)}` : ''}`;
    const summary = `Voy a ${qty > 0 ? 'sumar' : 'restar'} ${Math.abs(qty)} a ${who} (hoy ${before} → quedaría ${before + qty}). ¿Confirmas?`;
    return savePending(ctx.businessId, 'stock', summary, {
      product_id: p.id, variant_id: v.variant ? v.variant.id : null, delta: qty, before, label: who, motivo: text(input.motivo, 80) || 'ajuste',
    });
  }

  async function prepararPrecio(input, ctx) {
    const price = Number(input.precio);
    if (!Number.isFinite(price) || price <= 0 || price > 100000000) return { success: false, error: 'El precio debe ser mayor que 0.' };
    const r = await resolveProduct(ctx.businessId, input.producto, { includeInactive: true });
    if (!r.product) return r;
    const p = r.product;
    const summary = `Voy a cambiar el precio de ${p.name}: ${cop(p.price)} → ${cop(price)}. ¿Confirmas?`;
    return savePending(ctx.businessId, 'precio', summary, { product_id: p.id, before: Number(p.price), after: price, label: p.name });
  }

  async function prepararEstado(input, ctx) {
    if (typeof input.activo !== 'boolean') return { success: false, error: 'Indica si se activa o se desactiva.' };
    const r = await resolveProduct(ctx.businessId, input.producto, { includeInactive: true });
    if (!r.product) return r;
    const p = r.product;
    if (input.color || input.talla) {
      const v = await resolveVariant(ctx.businessId, p, input.color, input.talla, { includeInactive: true });
      if (v.needs) return v;
      if (!v.variant) return { success: false, error: `${p.name} no tiene variantes.` };
      if (v.variant.is_active === input.activo) return { success: false, error: `${p.name}, ${variantLabel(v.variant)} ya está ${input.activo ? 'activa' : 'desactivada'}.` };
      const summary = `Voy a ${input.activo ? 'activar' : 'desactivar'} ${p.name}, ${variantLabel(v.variant)}${input.activo ? '' : ' (deja de venderse en la tienda; conserva su historial)'}. ¿Confirmas?`;
      return savePending(ctx.businessId, 'estado_variante', summary, { product_id: p.id, variant_id: v.variant.id, before: v.variant.is_active, after: input.activo, label: `${p.name}, ${variantLabel(v.variant)}` });
    }
    if (p.is_active === input.activo) return { success: false, error: `${p.name} ya está ${input.activo ? 'activo' : 'desactivado'}.` };
    const summary = `Voy a ${input.activo ? 'activar' : 'desactivar'} ${p.name}${input.activo ? ' (se verá en la tienda)' : ' (deja de verse en la tienda)'}. ¿Confirmas?`;
    return savePending(ctx.businessId, 'estado_producto', summary, { product_id: p.id, before: p.is_active, after: input.activo, label: p.name });
  }

  async function prepararPedido(input, ctx) {
    const items = Array.isArray(input.items) ? input.items.slice(0, 20) : [];
    if (!items.length) return { success: false, error: 'El pedido necesita al menos un producto.' };
    const lines = [];
    for (const it of items) {
      const qty = Number(it.cantidad);
      if (!Number.isInteger(qty) || qty < 1 || qty > 100) return { success: false, error: 'Cada cantidad debe ser un entero entre 1 y 100.' };
      const r = await resolveProduct(ctx.businessId, it.producto);
      if (!r.product) return r;
      const p = r.product;
      let variantId = null; let label = p.name; let available;
      if (p.is_bundle) {
        const { componentsByBundle, variantsByProduct } = await loadBundles(db, ctx.businessId, [p.id]);
        const d = deriveBundle(p, componentsByBundle[p.id] || [], variantsByProduct);
        if (d.error) return { success: false, error: `${p.name}: ${d.error}` };
        if (d.hasVariants) {
          const hits = matchVariants(d.variants, it.color, it.talla);
          if (hits.length !== 1 || (!it.color && !it.talla)) return { needs: 'variante', pregunta: `${p.name}: ¿qué color y talla?`, opciones: d.variants.map((v) => ({ variante: variantLabel(v), disponibles: v.stock })) };
          variantId = hits[0].id; label = `${p.name} (${variantLabel(hits[0])})`; available = hits[0].stock;
        } else available = d.simpleStock;
      } else {
        const v = await resolveVariant(ctx.businessId, p, it.color, it.talla);
        if (v.needs) return v;
        if (v.variant) { variantId = v.variant.id; label = `${p.name} (${variantLabel(v.variant)})`; available = v.variant.stock; } else available = p.stock;
      }
      if (qty > available) return { success: false, error: `Solo hay ${available} de ${label}.` };
      lines.push({ product_id: p.id, variant_id: variantId, description: label, quantity: qty, unit_price: Number(p.price) });
    }
    const totals = computeTotals(lines);
    const disc = parseDiscount(input.descuento === undefined ? undefined : Number(input.descuento), totals.subtotal);
    if (disc.error) return { success: false, error: disc.error };
    const total = computeTotals(lines, { discount: disc.discount }).total;
    const cliente = text(input.cliente_nombre, 120) || null;
    const summary = `Voy a registrar un pedido: ${lines.map((l) => `${l.quantity}× ${l.description} ${cop(l.unit_price)}`).join(', ')}. Subtotal ${cop(totals.subtotal)}`
      + `${disc.discount ? `, descuento ${cop(disc.discount)}` : ''}, total ${cop(total)}. Cliente: ${cliente || 'sin datos'}. Pago: ${input.pagado ? `pagado${input.metodo_pago ? ` (${input.metodo_pago})` : ''}` : 'pendiente'}. ¿Confirmas?`;
    return savePending(ctx.businessId, 'pedido', summary, {
      body: {
        delivery_type: 'retiro', items: lines, client_name: cliente, client_phone: text(input.cliente_telefono, 30) || null,
        discount_amount: disc.discount, notes: text(input.notas, 300) || null,
        ...(input.pagado ? { payment_status: 'pagado', payment_method: input.metodo_pago || 'efectivo' } : {}),
      },
      total,
    });
  }

  async function prepararDeshacer(input, ctx) {
    let q = db.from('assistant_actions').select('*').eq('business_id', ctx.businessId).eq('status', 'applied');
    if (input.accion_id) q = q.eq('id', String(input.accion_id));
    const { data, error } = await q.order('applied_at', { ascending: false }).limit(1);
    if (error) throw error;
    const a = (data || [])[0];
    if (!a) return { success: false, error: 'No encontré una acción reciente del asistente para deshacer.' };
    if (a.kind === 'undo') return { success: false, error: 'La última acción ya fue un deshacer; no se deshace un deshacer.' };
    if (now().getTime() - new Date(a.applied_at).getTime() > UNDO_WINDOW_MS) return { success: false, error: 'Esa acción tiene más de 7 días; no la deshago automáticamente.' };
    const p = a.plan || {};
    if (a.kind === 'stock') {
      const current = await readStock(ctx.businessId, p.product_id, p.variant_id);
      if (current === null) return { success: false, error: `${p.label} ya no existe.` };
      if (current - p.delta < 0) return { success: false, error: `No se puede deshacer: ${p.label} tiene ${current} y habría que restar ${p.delta}.` };
      const summary = `Voy a deshacer: ${p.delta > 0 ? 'restar' : 'sumar'} ${Math.abs(p.delta)} a ${p.label} (hoy ${current} → quedaría ${current - p.delta}). ¿Confirmas?`;
      return savePending(ctx.businessId, 'undo', summary, { undo_of: a.id, kind: a.kind, product_id: p.product_id, variant_id: p.variant_id, delta: -p.delta, before: current, label: p.label });
    }
    if (a.kind === 'precio') {
      const { data: prod } = await db.from('products').select('price').eq('business_id', ctx.businessId).eq('id', p.product_id).maybeSingle();
      if (!prod) return { success: false, error: `${p.label} ya no existe.` };
      if (Number(prod.price) !== Number(p.after)) return { success: false, error: `El precio de ${p.label} cambió después (hoy ${cop(prod.price)}); no lo deshago para no pisar ese cambio.` };
      return savePending(ctx.businessId, 'undo', `Voy a deshacer: precio de ${p.label} ${cop(prod.price)} → ${cop(p.before)}. ¿Confirmas?`, { undo_of: a.id, kind: a.kind, product_id: p.product_id, before: Number(prod.price), after: p.before, label: p.label });
    }
    if (a.kind === 'estado_producto' || a.kind === 'estado_variante') {
      return savePending(ctx.businessId, 'undo', `Voy a deshacer: ${p.before ? 'activar' : 'desactivar'} de nuevo ${p.label}. ¿Confirmas?`, { undo_of: a.id, kind: a.kind, product_id: p.product_id, variant_id: p.variant_id || null, before: p.after, after: p.before, label: p.label });
    }
    if (a.kind === 'pedido') {
      const orderId = a.result?.order_id;
      const { data: o } = await db.from('orders').select('status').eq('business_id', ctx.businessId).eq('id', orderId).maybeSingle();
      if (!o) return { success: false, error: 'Ese pedido ya no existe.' };
      if (o.status === 'cancelado') return { success: false, error: 'Ese pedido ya está cancelado.' };
      return savePending(ctx.businessId, 'undo', `Voy a deshacer: cancelar el pedido ${orderCode(orderId)} y devolver su stock. ¿Confirmas?`, { undo_of: a.id, kind: a.kind, order_id: orderId, label: orderCode(orderId) });
    }
    return { success: false, error: 'Esa acción no se puede deshacer automáticamente.' };
  }

  // ── Ejecutar (solo desde confirmar_accion) ──
  const call = async (fn, { params = {}, body = {} }, ctx) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await fn({ params, body, query: {}, headers: { authorization: ctx.authorization }, businessId: ctx.businessId, business: ctx.business }, res);
    return res;
  };

  async function adjust(ctx, plan, actionId, reason) {
    const { error } = await db.rpc('adjust_stock', {
      p_business_id: ctx.businessId, p_product_id: plan.product_id, p_variant_id: plan.variant_id || null,
      p_change: plan.delta, p_type: 'ajuste', p_reason: reason, p_ref_type: 'assistant_action', p_ref_id: actionId, p_user: null,
    });
    if (error) {
      const short = String(error.message || '').includes('STOCK_INSUFICIENTE');
      return { ok: false, error: short ? 'No hay stock suficiente para ese ajuste (cambió mientras tanto).' : 'La base rechazó el ajuste de stock.' };
    }
    const after = await readStock(ctx.businessId, plan.product_id, plan.variant_id);
    const { data: mv } = await db.from('inventory_movements').select('id').eq('business_id', ctx.businessId).eq('reference_id', actionId).order('created_at', { ascending: false }).limit(1);
    return { ok: true, after, movement_id: mv?.[0]?.id || null };
  }

  async function execute(action, ctx) {
    const p = action.plan || {};
    const kind = action.kind === 'undo' ? p.kind : action.kind;
    const isUndo = action.kind === 'undo';
    if (kind === 'stock') {
      const r = await adjust(ctx, p, action.id, isUndo ? 'deshacer asistente' : `Asistente: ${p.motivo || 'ajuste'}`);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, result: { antes: p.before, despues_leido: r.after, cambio: p.delta, movement_id: r.movement_id }, message: `${p.label}: ${p.before} → ${r.after} (leído de la base).` };
    }
    if (kind === 'precio') {
      const r = await call(controllers.products.update, { params: { id: p.product_id }, body: { price: p.after } }, ctx);
      if (r.code >= 400) return { ok: false, error: r.body?.error || 'No se pudo cambiar el precio.' };
      const { data } = await db.from('products').select('price').eq('business_id', ctx.businessId).eq('id', p.product_id).maybeSingle();
      return { ok: Number(data?.price) === Number(p.after), result: { antes: p.before, despues_leido: Number(data?.price) }, message: `${p.label}: ${cop(p.before)} → ${cop(data?.price)} (leído de la base).`, error: 'El precio no quedó como se esperaba.' };
    }
    if (kind === 'estado_producto') {
      const { data: cur } = await db.from('products').select('is_active').eq('business_id', ctx.businessId).eq('id', p.product_id).maybeSingle();
      if (!cur) return { ok: false, error: 'El producto ya no existe.' };
      if (cur.is_active !== p.after) {
        const r = await call(controllers.products.toggleProduct, { params: { id: p.product_id } }, ctx);
        if (r.code >= 400) return { ok: false, error: r.body?.error || 'No se pudo cambiar el estado.' };
      }
      const { data } = await db.from('products').select('is_active').eq('business_id', ctx.businessId).eq('id', p.product_id).maybeSingle();
      return { ok: data?.is_active === p.after, result: { antes: p.before, despues_leido: data?.is_active }, message: `${p.label}: ${data?.is_active ? 'activo' : 'desactivado'} (leído de la base).`, error: 'El estado no quedó como se esperaba.' };
    }
    if (kind === 'estado_variante') {
      const r = await call(controllers.variants.update, { params: { productId: p.product_id, variantId: p.variant_id }, body: { is_active: p.after } }, ctx);
      if (r.code >= 400) return { ok: false, error: r.body?.error || 'No se pudo cambiar la variante.' };
      const { data } = await db.from('product_variants').select('is_active').eq('business_id', ctx.businessId).eq('id', p.variant_id).maybeSingle();
      return { ok: data?.is_active === p.after, result: { antes: p.before, despues_leido: data?.is_active, aviso_sets: r.body?.warning || null }, message: `${p.label}: ${data?.is_active ? 'activa' : 'desactivada'} (leído de la base).${r.body?.warning ? ` ${r.body.warning}` : ''}`, error: 'La variante no quedó como se esperaba.' };
    }
    if (kind === 'pedido' && !isUndo) {
      const r = await call(controllers.orders.create, { body: p.body }, ctx);
      if (r.code >= 400) return { ok: false, error: r.body?.error || 'No se pudo crear el pedido.' };
      const o = r.body.data;
      return { ok: true, result: { order_id: o.id, codigo: orderCode(o.id), total_leido: Number(o.total_amount), descuento: Number(o.discount_amount || 0), aviso: r.body.warning || null }, message: `Pedido ${orderCode(o.id)} creado, total ${cop(o.total_amount)} (leído de la base).${r.body.warning ? ` ${r.body.warning}` : ''}` };
    }
    if (kind === 'pedido' && isUndo) {
      const r = await call(controllers.orders.updateStatus, { params: { id: p.order_id }, body: { status: 'cancelado' } }, ctx);
      if (r.code >= 400) return { ok: false, error: r.body?.error || 'No se pudo cancelar el pedido.' };
      const { data } = await db.from('orders').select('status').eq('business_id', ctx.businessId).eq('id', p.order_id).maybeSingle();
      return { ok: data?.status === 'cancelado', result: { estado_leido: data?.status }, message: `Pedido ${p.label}: ${data?.status} y su stock devuelto (leído de la base).`, error: 'El pedido no quedó cancelado.' };
    }
    return { ok: false, error: 'Tipo de acción desconocido.' };
  }

  // Última acción pendiente de ESTE negocio propuesta ANTES del mensaje actual (la que el usuario vio)
  async function latestPending(ctx) {
    const { data, error } = await db.from('assistant_actions').select('*')
      .eq('business_id', ctx.businessId).eq('status', 'pending').order('created_at', { ascending: false }).limit(10);
    if (error) throw error;
    const cutoff = ctx.requestStartedAt ? ctx.requestStartedAt.getTime() : Infinity;
    return (data || []).find((a) => new Date(a.created_at).getTime() < cutoff) || null;
  }

  async function confirmar(input, ctx) {
    // El historial solo guarda texto: en el turno del "sí" el modelo puede no tener el id. Se usa el indicado si es
    // válido para este negocio y, si no, la última pendiente que el usuario vio.
    const id = String(input.confirmation_id || '');
    let action = null;
    if (id) {
      const { data, error } = await db.from('assistant_actions').select('*').eq('business_id', ctx.businessId).eq('id', id).maybeSingle();
      if (error) throw error;
      action = data;
    }
    const seenBefore = (a) => a && (!ctx.requestStartedAt || new Date(a.created_at).getTime() < ctx.requestStartedAt.getTime());
    if (!action || (action.status === 'pending' && !seenBefore(action))) action = (await latestPending(ctx)) || action;
    if (!action) return { success: false, error: 'No hay ninguna acción pendiente de confirmar.' };
    if (action.status !== 'pending') return { success: false, error: `Esa acción ya está ${action.status}.` };
    if (new Date(action.expires_at).getTime() < now().getTime()) {
      await finish(action.id, ctx.businessId, { status: 'expired' });
      return { success: false, error: 'La propuesta expiró (30 min). Vuelve a pedirla.' };
    }
    // El usuario tuvo que VER el resumen: la acción se propuso en un mensaje anterior, y el actual es un "sí"
    if (ctx.requestStartedAt && new Date(action.created_at).getTime() >= ctx.requestStartedAt.getTime()) {
      return { success: false, error: 'Primero muestra el resumen al usuario y espera su "sí" en el siguiente mensaje.', resumen: action.summary };
    }
    if (!isAffirmative(ctx.userMessage)) {
      return { success: false, error: 'El usuario no confirmó con un "sí" en su último mensaje. Pregúntale de nuevo.', resumen: action.summary };
    }
    let out;
    try {
      out = await execute(action, ctx);
    } catch (err) {
      out = { ok: false, error: 'Error inesperado al ejecutar.' };
    }
    if (!out.ok) {
      await finish(action.id, ctx.businessId, { status: 'failed', result: { error: out.error, ...(out.result || {}) } });
      return { success: false, error: `FALLÓ: ${out.error} No se cambió nada.` };
    }
    await finish(action.id, ctx.businessId, { status: 'applied', applied_at: now().toISOString(), result: out.result, ...(action.kind === 'undo' ? { undo_of: action.plan.undo_of } : {}) });
    if (action.kind === 'undo') await finish(action.plan.undo_of, ctx.businessId, { status: 'undone', undone_at: now().toISOString() });
    // Otras propuestas que quedaron abiertas (p. ej. el modelo repitió el resumen) ya no aplican
    await db.from('assistant_actions').update({ status: 'cancelled' }).eq('business_id', ctx.businessId).eq('status', 'pending');
    return { success: true, resultado: out.message, ...out.result };
  }

  async function cancelar(input, ctx) {
    // Cancela todas las propuestas abiertas de este negocio (el "no" aplica a lo que el usuario está viendo)
    const { data } = await db.from('assistant_actions').select('id').eq('business_id', ctx.businessId).eq('status', 'pending');
    if (!data || !data.length) return { success: false, error: 'No hay ninguna acción pendiente.' };
    await db.from('assistant_actions').update({ status: 'cancelled' }).eq('business_id', ctx.businessId).eq('status', 'pending');
    return { success: true, resultado: 'Cancelado: no se cambió nada.' };
  }

  // Contexto compacto del negocio tienda para el prompt (cifras por variante, no totales guardados) y la
  // propuesta pendiente, para que en el turno del "sí" el modelo sepa qué confirmar
  async function storeContext(businessId) {
    const products = (await loadProducts(businessId)).filter((p) => !p.is_bundle);
    const variants = await loadVariants(businessId, products.map((p) => p.id));
    const agotadas = variants.filter((v) => v.stock === 0).length;
    const bajas = variants.filter((v) => v.stock > 0 && v.stock <= (v.min_stock ?? 2)).length;
    const { data: pend } = await db.from('orders').select('id').eq('business_id', businessId).eq('payment_status', 'pendiente').neq('status', 'cancelado');
    const pending = await latestPending({ businessId });
    const open = pending && new Date(pending.expires_at).getTime() >= now().getTime()
      ? `\nPropuesta esperando confirmación del usuario: "${pending.summary}" (confirmation_id: ${pending.id}). Si el usuario dice "sí", llama confirmar_accion; si dice "no", cancelar_accion. No la vuelvas a preparar.`
      : '';
    return `Tienda: ${products.length} productos activos, ${variants.length} variantes (${agotadas} agotadas, ${bajas} con poco stock). Pedidos pendientes de pago: ${(pend || []).length}.${open}`;
  }

  const handlers = {
    consultar_stock: consultarStock, buscar_productos_tienda: buscarProductos, consultar_sets: consultarSets,
    consultar_pedidos: consultarPedidos, ventas_tienda: ventasTienda, consultar_envio: consultarEnvio,
    preparar_ajuste_stock: prepararAjuste, preparar_cambio_precio: prepararPrecio, preparar_estado: prepararEstado,
    preparar_pedido_manual: prepararPedido, preparar_deshacer: prepararDeshacer, confirmar_accion: confirmar, cancelar_accion: cancelar,
  };

  // Herramienta que el servidor obliga a usar en este turno (el modelo no decide si confirma o deshace)
  async function forcedToolFor(ctx) {
    const pending = await latestPending(ctx);
    const live = pending && new Date(pending.expires_at).getTime() >= now().getTime();
    if (live && isAffirmative(ctx.userMessage)) return 'confirmar_accion';
    if (live && isNegative(ctx.userMessage)) return 'cancelar_accion';
    if (isUndoIntent(ctx.userMessage)) return 'preparar_deshacer';
    return null;
  }

  return {
    tools: STORE_TOOLS,
    prompt: STORE_PROMPT,
    forcedToolFor,
    handles: (name) => Object.prototype.hasOwnProperty.call(handlers, name),
    // input nunca trae business_id que valga: el negocio sale de ctx (sesión)
    execute: (name, input, ctx) => handlers[name](input && typeof input === 'object' ? input : {}, ctx),
    storeContext,
  };
}

let defaultInstance = null;
function storeAssistant() {
  if (!defaultInstance) {
    const { supabaseAdmin } = require('../config/supabase');
    defaultInstance = createStoreAssistant({
      db: supabaseAdmin,
      controllers: {
        orders: require('../controllers/orders.controller'),
        products: require('../controllers/products.controller'),
        variants: require('../controllers/productVariants.controller'),
      },
    });
  }
  return defaultInstance;
}

module.exports = { createStoreAssistant, storeAssistant, isAffirmative, isNegative, isUndoIntent, claimsWrite, matchProducts, STORE_TOOLS, STORE_PROMPT, GENERIC_TOOLS_HIDDEN_FOR_STORE };
