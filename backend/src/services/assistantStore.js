// Asistente para negocios TIENDA (FLOW): contexto vivo, herramientas propias, confirmación obligatoria antes de
// escribir (varias acciones con un solo "sí") y deshacer real. Los negocios que no son tienda NO pasan por aquí.
//
// Lo garantiza el SERVIDOR (no depende de que el modelo obedezca):
//  - business_id siempre de la sesión (ctx.businessId); ningún input de las herramientas lo acepta.
//  - Toda escritura es en dos pasos: preparar_* guarda una acción 'pending' en assistant_actions (marcada con el id
//    del mensaje que la propuso) y confirmar_accion ejecuta TODAS las propuestas que el usuario vio en un mensaje
//    anterior, en orden, solo si el mensaje actual es un "sí".
//  - El stock cambia solo con adjust_stock, a nivel de VARIANTE si el producto tiene variantes; el "hoy" de un
//    ajuste es el stock de ESA variante leído de la base; una variante que no existe no se ajusta.
//  - Siempre se revisa el { error } del rpc (no lanza) y el resultado que se informa es el leído de la base.
// Reutiliza los controladores del panel (pedidos, productos, variantes) con el token del usuario.

const crypto = require('crypto');
const { loadBundles, deriveBundle } = require('../utils/bundles');
const { calculateShipping } = require('../config/shipping');
const { parseDiscount, computeTotals } = require('../utils/orderTotals');
const { loadStoreCatalog } = require('../utils/storeCatalog');

const ACTION_TTL_MS = 30 * 60 * 1000;
const UNDO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_QTY = 10000;
const PAYMENT_WINDOW_H = 24;
const MAX_BATCH = 10;
const ORDER_STATUSES = ['recibido', 'en_proceso', 'listo', 'enviado', 'entregado', 'cancelado'];
const TZ = { timeZone: 'America/Bogota' };

// ── Utilidades ────────────────────────────────────────────────────────────────
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const cop = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const orderCode = (id) => `P-${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
const text = (v, max = 80) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const dayISO = (d) => d.toLocaleDateString('en-CA', TZ);
const attr = (attributes, name) => {
  for (const [k, v] of Object.entries(attributes || {})) if (norm(k) === name) return String(v);
  return '';
};
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const variantLabel = (v) => {
  const c = cap(attr(v.attributes, 'color'));
  const t = attr(v.attributes, 'talla').toUpperCase();
  return [c, t && `talla ${t}`].filter(Boolean).join(' ') || Object.values(v.attributes || {}).join(' / ');
};
const stripAsk = (s) => String(s || '').replace(/\s*¿Confirmas\?\s*$/, '');

// Sí / no / deshacer: sin mayúsculas, tildes ni signos
const YES_START = /^(s[ií]|sip|sii+|claro|dale|ok|okay|okey|oki|listo|confirm\w*|de una|h[aá]gale|h[aá]galo|hazlo|adelante|correcto|perfecto|va|vale|eso|procede|proceda|aplica\w*|ejecuta\w*|de acuerdo|apruebo|aprobado|todo bien|ambas|las dos|todas)\b/;
const YES_ANY = /\b(confirmo|confirmado|confirmadas|confirmalas|hazlo|hagalo|hagale|dale|procede|adelante|aplicalo|aplicalas|ejecutalo|ejecutalas)\b/;
const NO_START = /^(no|nop|nel|nada|cancela\w*|anula\w*|mejor no|olvidalo|olvida|dejalo|deja asi|espera|para|detente|no gracias)\b/;
function isNegative(message) {
  const m = norm(message).replace(/^[¡!¿?.,\s]+/, '');
  return NO_START.test(m) || /\b(no confirmo|no lo hagas|cancelalo|cancelalas)\b/.test(m);
}
function isAffirmative(message) {
  const m = norm(message).replace(/^[¡!¿?.,\s]+/, '');
  if (!m || isNegative(m)) return false;
  return YES_START.test(m) || YES_ANY.test(m);
}
function isUndoIntent(message) {
  return /(devuelv|deshaz|deshac|revert|reviert|reversa|como estaba|vuelvelo|regresalo)/.test(norm(message));
}
// La respuesta afirma que se HIZO un cambio (para no dejar pasar un "✅ listo" sin escritura real)
function claimsWrite(t0) {
  const raw = String(t0 || '');
  const t = norm(raw);
  const done = /✅/.test(raw) || /\b(listo|hecho|deshecho|ya quedo|ya esta)\b/.test(t);
  const change = /→|->/.test(raw)
    || /\b(quedo|quedaron|volvio|paso de|actualic\w*|actualizad\w*|registr\w*|cambi[eo]|cambiad\w*|sum[eo]|sumad\w*|rest[eo]|restad\w*|ajustad\w*|cancel[eo]|cancelad\w*|desactiv\w*|activ[eo]|activad\w*|cre[eo]|cread\w*|devuelt\w*|descontad\w*)\b/.test(t);
  return done && change;
}

// Productos por nombre: exacto primero; luego todas las palabras (>= 3 letras) presentes
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

// ── Herramientas ──────────────────────────────────────────────────────────────
const prop = (description, type = 'string', extra = {}) => ({ type, description, ...extra });
const STORE_TOOLS = [
  { name: 'resumen_tienda', description: 'Resumen del día de la tienda: ventas de hoy vs. ayer y del mes (neto de descuentos), pedidos sin pagar y cuáles vencen, agotados, poco stock y sets. Úsala para "¿cómo vamos hoy?", "buenos días, ¿cómo va todo?", "resumen".', input_schema: { type: 'object', properties: {} } },
  {
    name: 'consultar_stock',
    description: 'Stock REAL por variante (color + talla) leído de la base. Filtra por producto, color, talla, agotados o poco stock. Úsala SIEMPRE antes de responder cuánto hay.',
    input_schema: { type: 'object', properties: { producto: prop('Nombre o parte (opcional)'), color: prop(''), talla: prop(''), filtro: { type: 'string', enum: ['todos', 'agotados', 'poco_stock'] } } },
  },
  {
    name: 'buscar_productos_tienda',
    description: 'Productos con precio, costo, margen, género, categoría, colores, stock total (suma de variantes) y estado. Filtra por texto, género, categoría, color o drop.',
    input_schema: {
      type: 'object',
      properties: {
        texto: prop(''), genero: { type: 'string', enum: ['mujer', 'hombre', 'unisex'] }, categoria: prop(''), color: prop(''),
        drop: prop('Nombre del drop o cápsula (p. ej. "noir", "esencial")'), incluir_inactivos: prop('', 'boolean'),
      },
    },
  },
  { name: 'consultar_sets', description: 'Sets (combos): piezas, precio, costo (suma de piezas), margen, estado y disponibilidad por color y talla (la pieza con menos unidades manda).', input_schema: { type: 'object', properties: { nombre: prop('') } } },
  { name: 'catalogo_drops', description: 'Colección activa, sus cápsulas y drops con los colores que los definen y cuántos productos tiene cada uno.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'consultar_pedidos',
    description: 'Pedidos con total neto (descuento y envío incluidos), estado, pago, cliente y horas sin pagar. Filtra por código (P-XXXXXXXX), cliente, pago, estado o fechas.',
    input_schema: {
      type: 'object',
      properties: {
        codigo: prop('P-XXXXXXXX'), cliente: prop(''), pago: { type: 'string', enum: ['pendiente', 'pagado'] }, estado: { type: 'string', enum: ORDER_STATUSES },
        desde: prop('YYYY-MM-DD'), hasta: prop('YYYY-MM-DD'), limite: prop('', 'number'),
      },
    },
  },
  {
    name: 'ventas_tienda',
    description: 'Ventas por pedidos no cancelados: total neto, descuentos, envíos, cobrado vs. pendiente, ticket promedio y comparación con el período anterior.',
    input_schema: { type: 'object', properties: { periodo: { type: 'string', enum: ['hoy', 'ayer', 'semana', 'mes', 'rango'] }, desde: prop(''), hasta: prop('') }, required: ['periodo'] },
  },
  { name: 'productos_mas_vendidos', description: 'Ranking de productos (y variantes) más vendidos por unidades e ingresos en un período.', input_schema: { type: 'object', properties: { periodo: { type: 'string', enum: ['semana', 'mes', 'anio'] }, limite: prop('', 'number') } } },
  { name: 'clientes_frecuentes', description: 'Clientes que más compran (pedidos con nombre o teléfono): número de pedidos, total y última compra.', input_schema: { type: 'object', properties: { periodo: { type: 'string', enum: ['mes', 'trimestre', 'anio', 'todo'] }, limite: prop('', 'number') } } },
  { name: 'consultar_envio', description: 'Tarifas de envío por zona y, con ciudad y subtotal, el costo exacto (incluye envío gratis desde cierto monto).', input_schema: { type: 'object', properties: { ciudad: prop(''), subtotal: prop('', 'number') } } },
  {
    name: 'preparar_ajuste_stock',
    description: 'PASO 1 para sumar o restar stock de UNA variante (o de un producto sin variantes). Si falta color/talla devuelve las opciones para que PREGUNTES; si la variante no existe lo dice. NO escribe.',
    input_schema: { type: 'object', properties: { producto: prop(''), color: prop(''), talla: prop(''), cantidad: prop('Positivo suma, negativo resta', 'number'), motivo: prop('') }, required: ['producto', 'cantidad'] },
  },
  {
    name: 'preparar_crear_variante',
    description: 'PASO 1 para crear una variante nueva (color + talla) de un producto, con stock inicial opcional. Una llamada por variante. NO escribe.',
    input_schema: { type: 'object', properties: { producto: prop(''), color: prop(''), talla: prop(''), stock_inicial: prop('Default 0', 'number') }, required: ['producto', 'color', 'talla'] },
  },
  { name: 'preparar_cambio_precio', description: 'PASO 1 para cambiar el precio de venta de un producto o set. NO escribe.', input_schema: { type: 'object', properties: { producto: prop(''), precio: prop('', 'number') }, required: ['producto', 'precio'] } },
  {
    name: 'preparar_estado',
    description: 'PASO 1 para activar o desactivar un producto, un set o una variante (con color y talla). NO escribe.',
    input_schema: { type: 'object', properties: { producto: prop(''), color: prop(''), talla: prop(''), activo: prop('', 'boolean') }, required: ['producto', 'activo'] },
  },
  {
    name: 'preparar_pedido_manual',
    description: 'PASO 1 para registrar una venta/pedido manual (como en el panel): descuenta stock por variante, cliente opcional, descuento en pesos opcional, precios del sistema. NO escribe.',
    input_schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object', properties: { producto: prop(''), color: prop(''), talla: prop(''), cantidad: prop('', 'number') }, required: ['producto', 'cantidad'] } },
        cliente_nombre: prop(''), cliente_telefono: prop(''), descuento: prop('Pesos', 'number'), pagado: prop('', 'boolean'),
        metodo_pago: { type: 'string', enum: ['efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'otro'] }, notas: prop(''),
      },
      required: ['items'],
    },
  },
  {
    name: 'preparar_estado_pedido',
    description: 'PASO 1 para cambiar el estado de un pedido (en_proceso, listo, enviado, entregado) o cancelarlo (devuelve el stock; no se puede deshacer). NO escribe.',
    input_schema: { type: 'object', properties: { codigo: prop('P-XXXXXXXX'), estado: { type: 'string', enum: ORDER_STATUSES.filter((s) => s !== 'recibido') } }, required: ['codigo', 'estado'] },
  },
  { name: 'preparar_deshacer', description: 'PASO 1 para "devuélvelo como estaba": prepara el inverso de la última confirmación del asistente (todas sus acciones). NO escribe.', input_schema: { type: 'object', properties: {} } },
  { name: 'confirmar_accion', description: 'PASO 2: ejecuta TODAS las propuestas que el usuario vio, en orden, cuando su ÚLTIMO mensaje es un "sí". No necesita id. Devuelve el resultado de cada una leído de la base.', input_schema: { type: 'object', properties: {} } },
  { name: 'cancelar_accion', description: 'Descarta las propuestas pendientes cuando el usuario dice que no.', input_schema: { type: 'object', properties: {} } },
];

const STORE_PROMPT = `<tienda>
MODELO DE LA TIENDA (conocimiento fijo):
- PRODUCTO con VARIANTES: cada variante es color + talla y tiene su propio stock. El total del producto es la SUMA de sus variantes activas. Un producto sin variantes tiene stock propio.
- SETS (combos, p. ej. "Set Aria" = Top Aria + Licra Aria): no tienen stock propio; su disponibilidad por color/talla es la de la pieza con menos unidades; su costo es la suma de las piezas.
- GÉNERO: mujer, hombre o unisex (unisex sale en Mujer y en Hombre). CATEGORÍAS: Tops, Licras, Shorts, Faldas, Pantalonetas, Camisetas, Sets, Flow Archive…
- COLECCIÓN, CÁPSULAS y DROPS: grupos de productos por color (catalogo_drops). Un producto está en un drop si tiene alguno de sus colores.
- COSTO y MARGEN: margen = (precio − costo) / precio.
- PEDIDOS: total neto = subtotal + envío − descuento. Estados: recibido → en_proceso → listo → enviado → entregado, o cancelado (devuelve stock, es final). Pedido web: el cliente tiene ${PAYMENT_WINDOW_H} h para pagar. Pedido manual: cliente opcional y descuento en pesos.
- ENVÍO: tarifa en la ciudad del negocio, tarifa nacional y gratis desde cierto subtotal (consultar_envio).
</tienda>

<protocolo_tienda>
- Saludo solo ("hola", "buenas") → saluda corto con el nombre del negocio y ofrece ayuda. CERO herramientas.
- "¿Cómo vamos hoy?", "¿cómo va todo?", "resumen" → resumen_tienda.
- Puedes mencionar UNA alerta útil del contexto <tienda_hoy> cuando venga al caso (p. ej. "ojo: 2 pedidos sin pagar vencen hoy"). Sin relleno.
</protocolo_tienda>

<mapeo_tienda>
"¿Cuánto hay de X?" / "¿qué tallas quedan?" → consultar_stock
"¿Qué se agotó?" / "¿qué está por agotarse?" → consultar_stock(filtro agotados / poco_stock)
"¿Cuánto vendimos hoy/esta semana/este mes?" → ventas_tienda   ·   "¿Qué es lo que más se vende?" → productos_mas_vendidos
"¿Quiénes son mis mejores clientes?" → clientes_frecuentes   ·   "¿Cuánto cuesta el envío a X?" → consultar_envio
"¿Qué pedidos faltan por pagar?" / "el pedido P-…" / "pedidos de Ana" → consultar_pedidos
"¿Qué tiene el drop/cápsula X?" → catalogo_drops + buscar_productos_tienda(drop)   ·   "¿Cuánto me deja X?" → buscar_productos_tienda (costo y margen)
"Llegaron N de X" / "súmale" / "quítale" → preparar_ajuste_stock (una llamada por variante)
"Agrégale la variante azul S" / "crea las tallas…" → preparar_crear_variante (una llamada por variante; luego, si dieron cantidades, el stock va como stock_inicial)
"Vendí…" / "registra un pedido…" → preparar_pedido_manual   ·   "Marca el pedido como enviado" / "cancela el pedido" → preparar_estado_pedido
"Sube el precio…" → preparar_cambio_precio   ·   "Desactiva/activa…" → preparar_estado   ·   "Devuélvelo como estaba" → preparar_deshacer
NO puedes: borrar productos, cambiar fotos ni tocar pagos reales (eso es en el panel).
</mapeo_tienda>

<reglas_tienda>
0. Para sumar/restar stock, crear variantes, vender, cambiar precio o estado: llama SIEMPRE PRIMERO la herramienta preparar_* aunque creas que faltan datos. Ella te dice si falta color/talla, si el producto no tiene variantes o si algo no existe. NUNCA supongas que un producto tiene variantes ni preguntes color/talla antes de llamarla.
1. NUNCA inventes cifras: todo número sale de una herramienta de ESTE turno o del bloque <tienda_hoy>. Si no tienes el número, no lo menciones (nada de "X unidades").
2. AMBIGÜEDAD: si una herramienta devuelve needs (varios productos o falta color/talla) → muestra las opciones en lista numerada y pregunta. NUNCA asumas, NUNCA sumes al total de un producto con variantes.
3. Si la variante no existe → dilo y ofrece crearla. NUNCA propongas ajustar una variante que no existe.
4. ESCRIBIR: llama los preparar_* que hagan falta (puedes preparar VARIAS en el mismo turno). NO escribas tú la lista ni "¿Confirmas?": el sistema agrega al final la lista numerada exacta de lo que se va a ejecutar; tú da, si hace falta, una línea de contexto. Cuando el usuario responda "sí/confirmo/dale/hazlo/ok", llama confirmar_accion (una sola vez, ejecuta todas). Si dice "no/cancela", cancelar_accion. NUNCA vuelvas a preparar ni a preguntar lo mismo.
5. Después de confirmar informa cada resultado antes → después con lo que devolvió confirmar_accion. Si algo falló di que FALLÓ y por qué. NUNCA digas "listo" sin resultado.
6. Si una herramienta de preparar devuelve error, explícalo en una línea y ofrece la salida (crear la variante, activarla, ajustar primero el stock propio…). NO ofrezcas acciones en texto libre ("¿la creo?", "¿dale con ambas?"): si el usuario quiere, prepárala con la herramienta para que vea el resumen exacto.
6b. Una propuesta vale SOLO para el siguiente mensaje: si el usuario responde otra cosa que no es sí/no, el sistema la descarta.
6c. Si el mensaje trae <resultado_servidor herramienta="…">: el sistema YA ejecutó esa herramienta por el "sí", el "no" o el "devuélvelo" del usuario. Informa ese resultado (cada línea antes → después tal cual) y NO la vuelvas a llamar. Si dice que no había nada pendiente, dilo en una línea y pregunta qué quiere hacer.
7. Nunca muestres IDs (sí los códigos de pedido P-XXXXXXXX).
</reglas_tienda>

<formato_tienda>
- Español de Colombia, tuteando ("tienes", "quieres"); NUNCA voseo ("tenés", "querés").
- Dinero en formato colombiano: $1.250.000. Variantes como "Negro talla M".
- Respuestas de 2 a 6 líneas, números concretos, emojis con moderación: ✅ hecho, ⚠️ alerta, 📦 stock, 💰 dinero, 🧾 pedido, 📈/📉 tendencia.
- resumen_tienda: saludo según la hora; ventas de hoy vs. ayer con 📈/📉; mes; pendientes de pago (y cuáles vencen); 1–2 alertas de stock; cierra con UNA recomendación accionable.
- Listas de stock: "Producto — Color talla: N".
</formato_tienda>`;

// Herramientas genéricas que en una tienda se reemplazan o no aplican (escribían el total del producto sin variante
// ni movimiento, o son de citas/servicios/empleados)
const GENERIC_TOOLS_HIDDEN_FOR_STORE = new Set([
  'ajustar_stock', 'actualizar_producto', 'vender_producto', 'registrar_venta', 'crear_producto', 'eliminar_producto',
  'activar_producto', 'desactivar_producto', 'buscar_producto', 'listar_productos', 'historial_ventas', 'resumen_dia',
  'buscar_servicio', 'listar_servicios', 'crear_servicio', 'actualizar_servicio', 'activar_servicio', 'desactivar_servicio', 'eliminar_servicio',
  'buscar_empleado', 'listar_empleados', 'crear_empleado', 'actualizar_empleado', 'eliminar_empleado', 'calcular_comisiones',
  'rendimiento_empleados', 'ver_agenda_empleado', 'listar_citas', 'ver_agenda_semana', 'crear_cita', 'cancelar_cita', 'buscar_cita',
  'confirmar_cita', 'completar_cita', 'actualizar_cita', 'citas_completadas', 'ver_citas_pendientes', 'confirmar_todas_pendientes',
  'ver_disponibilidad', 'horas_rentables', 'cerrar_dia_especial', 'consultar_metricas', 'ticket_promedio', 'resumen_clientes',
]);

function createStoreAssistant(deps) {
  const { db, controllers } = deps;
  const now = deps.now || (() => new Date());
  const catalogFor = deps.catalogFor || ((slug) => loadStoreCatalog(slug));

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
      const { data } = await db.from('product_variants').select('stock').eq('business_id', businessId).eq('id', variantId).maybeSingle();
      return data ? data.stock : null;
    }
    const { data } = await db.from('products').select('stock').eq('business_id', businessId).eq('id', productId).maybeSingle();
    return data ? data.stock : null;
  }
  async function loadOrders(businessId, { desde, hasta, select = 'id, created_at, status, payment_status, total_amount, shipping_cost, discount_amount, client_name, client_phone, source' } = {}) {
    let q = db.from('orders').select(select).eq('business_id', businessId);
    if (desde) q = q.gte('created_at', `${desde}T00:00:00-05:00`);
    if (hasta) q = q.lte('created_at', `${hasta}T23:59:59-05:00`);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  // Producto único por nombre o la lista para preguntar (como en barbería: nunca elegir por el usuario)
  async function resolveProduct(businessId, query, opts = {}) {
    const products = await loadProducts(businessId, opts);
    const matches = matchProducts(products, query);
    if (matches.length === 0) return { success: false, error: `No encontré un producto que se llame "${text(query)}".`, sugerencias: products.slice(0, 15).map((p) => p.name) };
    if (matches.length > 1) {
      return { needs: 'producto', pregunta: `Hay ${matches.length} productos que coinciden con "${text(query)}". ¿Cuál?`, opciones: matches.slice(0, 15).map((p) => ({ producto: p.name, precio: Number(p.price), activo: p.is_active })) };
    }
    return { product: matches[0] };
  }

  // Variante EXACTA. Sin color/talla y con variantes → pregunta. Con color/talla que no existen → error claro
  // (nunca cae al total del producto). Un producto sin variantes activas y sin color/talla → { variant: null }.
  async function resolveVariant(businessId, product, color, talla, { includeInactive = false } = {}) {
    const all = await loadVariants(businessId, [product.id], { includeInactive: true });
    const pool = includeInactive ? all : all.filter((v) => v.is_active);
    const asked = !!(text(color) || text(talla));
    const opciones = pool.map((v) => ({ variante: variantLabel(v), stock: v.stock, ...(v.is_active ? {} : { inactiva: true }) }));
    if (!asked) {
      if (!pool.length) return { variant: null };
      return { needs: 'variante', pregunta: `${product.name} tiene ${pool.length} variante${pool.length === 1 ? '' : 's'}: ¿cuál (color y talla)?`, opciones };
    }
    const hits = matchVariants(pool, color, talla);
    if (hits.length === 1 && (text(color) || pool.every((v) => !attr(v.attributes, 'color'))) && (text(talla) || pool.every((v) => !attr(v.attributes, 'talla')))) {
      return { variant: hits[0] };
    }
    if (hits.length > 1 || (hits.length === 1 && (!text(color) || !text(talla)))) {
      return { needs: 'variante', pregunta: `${product.name}: ¿qué ${!text(color) ? 'color' : 'talla'}?`, opciones: hits.map((v) => ({ variante: variantLabel(v), stock: v.stock })) };
    }
    const wanted = [cap(text(color)), text(talla) && `talla ${text(talla).toUpperCase()}`].filter(Boolean).join(' ');
    const inactive = !includeInactive && matchVariants(all.filter((v) => !v.is_active), color, talla)[0];
    if (inactive) {
      return { success: false, error: `${product.name} tiene la variante ${variantLabel(inactive)} pero está DESACTIVADA (stock ${inactive.stock}). Puedo activarla (preparar_estado) si quieres.`, variante_inactiva: variantLabel(inactive) };
    }
    return {
      success: false,
      error: `${product.name} no tiene la variante ${wanted}.${pool.length ? '' : ' No tiene variantes activas.'} Puedo crearla (preparar_crear_variante) si quieres.`,
      variantes_existentes: opciones,
    };
  }

  // ── Registro de acciones ──
  // Una propuesta es "vista" si la creó un mensaje ANTERIOR (otro request_id). Sin relojes de por medio.
  const seen = (a, ctx) => {
    const rid = a?.plan?.request_id;
    if (rid && ctx.requestId) return rid !== ctx.requestId;
    return !ctx.requestStartedAt || new Date(a.created_at).getTime() < ctx.requestStartedAt.getTime();
  };
  const live = (a) => new Date(a.expires_at).getTime() >= now().getTime();
  async function pendingActions(businessId) {
    const { data, error } = await db.from('assistant_actions').select('*').eq('business_id', businessId).eq('status', 'pending').order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)) || ((x.plan?.seq || 0) - (y.plan?.seq || 0)));
  }

  let seq = 0;
  async function savePending(ctx, kind, summary, plan, dedupe) {
    const key = dedupe || JSON.stringify({ kind, ...plan, before: undefined, label: undefined, motivo: undefined });
    // La misma propuesta dos veces (el modelo la repite) se reutiliza: nunca se ejecuta doble
    const open = await pendingActions(ctx.businessId);
    const same = open.find((a) => a.plan?.key === key && live(a));
    if (same) return { requiere_confirmacion: true, resumen: same.summary, ya_estaba_propuesta: true };
    const { error } = await db.from('assistant_actions').insert({
      business_id: ctx.businessId, kind, status: 'pending', summary,
      plan: { ...plan, key, request_id: ctx.requestId || null, seq: ++seq },
      expires_at: new Date(now().getTime() + ACTION_TTL_MS).toISOString(),
    });
    if (error) throw error;
    return { requiere_confirmacion: true, resumen: summary };
  }
  const finish = (id, businessId, fields) => db.from('assistant_actions').update(fields).eq('id', id).eq('business_id', businessId);

  // ── Lecturas para el modelo ──
  async function salesBetween(businessId, desde, hasta) {
    const rows = (await loadOrders(businessId, { desde, hasta })).filter((o) => o.status !== 'cancelado');
    const sum = (f) => rows.reduce((s, o) => s + Number(f(o) || 0), 0);
    return {
      pedidos: rows.length, total_neto: sum((o) => o.total_amount), descuentos: sum((o) => o.discount_amount), envios: sum((o) => o.shipping_cost),
      cobrado: sum((o) => (o.payment_status === 'pagado' ? o.total_amount : 0)),
      pendiente_de_pago: sum((o) => (o.payment_status !== 'pagado' ? o.total_amount : 0)),
      ticket_promedio: rows.length ? Math.round(sum((o) => o.total_amount) / rows.length) : 0,
    };
  }

  async function unpaidOrders(businessId) {
    const rows = (await loadOrders(businessId)).filter((o) => o.payment_status !== 'pagado' && o.status !== 'cancelado');
    const t = now().getTime();
    return rows.map((o) => {
      const horas = Math.floor((t - new Date(o.created_at).getTime()) / 3600000);
      return { codigo: orderCode(o.id), cliente: o.client_name || 'Cliente sin datos', total: Number(o.total_amount), origen: o.source, horas_sin_pagar: horas, vencido: o.source === 'web' && horas >= PAYMENT_WINDOW_H, vence_en_horas: o.source === 'web' && horas < PAYMENT_WINDOW_H ? PAYMENT_WINDOW_H - horas : null };
    }).sort((a, b) => b.horas_sin_pagar - a.horas_sin_pagar);
  }

  async function stockAlerts(businessId) {
    const products = (await loadProducts(businessId)).filter((p) => !p.is_bundle);
    const variants = await loadVariants(businessId, products.map((p) => p.id));
    const name = (v) => `${products.find((p) => p.id === v.product_id)?.name} ${variantLabel(v)}`;
    // Productos sin variantes activas: cuentan con su stock propio
    const simple = products.filter((p) => !variants.some((v) => v.product_id === p.id));
    return {
      productos: products,
      variantes: variants,
      agotadas: [...variants.filter((v) => v.stock === 0).map(name), ...simple.filter((p) => Number(p.stock) === 0).map((p) => p.name)],
      poco_stock: [
        ...variants.filter((v) => v.stock > 0 && v.stock <= (v.min_stock ?? 2)).map((v) => `${name(v)}: ${v.stock}`),
        ...simple.filter((p) => p.stock > 0 && p.stock <= (p.min_stock ?? 0)).map((p) => `${p.name}: ${p.stock}`),
      ],
    };
  }

  async function setsSummary(businessId, { includeInactive = true, nombre } = {}) {
    let sets = (await loadProducts(businessId, { includeInactive })).filter((p) => p.is_bundle);
    if (nombre) sets = matchProducts(sets, nombre);
    if (!sets.length) return [];
    const { componentsByBundle, variantsByProduct } = await loadBundles(db, businessId, sets.map((s) => s.id));
    return sets.map((s) => {
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
    });
  }

  async function resumenTienda(input, ctx) {
    const today = dayISO(now());
    const yesterday = dayISO(new Date(now().getTime() - 86400000));
    const month = `${today.slice(0, 7)}-01`;
    const [hoy, ayer, mes, pend, alerts, sets] = await Promise.all([
      salesBetween(ctx.businessId, today, today), salesBetween(ctx.businessId, yesterday, yesterday), salesBetween(ctx.businessId, month, today),
      unpaidOrders(ctx.businessId), stockAlerts(ctx.businessId), setsSummary(ctx.businessId, { includeInactive: false }),
    ]);
    return {
      hora: now().toLocaleTimeString('es-CO', { ...TZ, hour: '2-digit', minute: '2-digit', hour12: true }),
      hoy, ayer, mes,
      pendientes_de_pago: { total: pend.length, monto: pend.reduce((s, o) => s + o.total, 0), vencidos: pend.filter((o) => o.vencido).slice(0, 5), vencen_pronto: pend.filter((o) => o.vence_en_horas != null && o.vence_en_horas <= 6).slice(0, 5) },
      agotadas: { total: alerts.agotadas.length, ejemplos: alerts.agotadas.slice(0, 8) },
      poco_stock: { total: alerts.poco_stock.length, ejemplos: alerts.poco_stock.slice(0, 6) },
      sets: sets.map((s) => ({ set: s.set, disponibles: s.disponibles_total })),
    };
  }

  async function consultarStock(input, ctx) {
    const products = (await loadProducts(ctx.businessId)).filter((p) => !p.is_bundle);
    const scoped = input.producto ? matchProducts(products, input.producto) : products;
    if (input.producto && !scoped.length) return { encontrados: 0, mensaje: `No encontré "${text(input.producto)}".` };
    const variants = await loadVariants(ctx.businessId, scoped.map((p) => p.id));
    const rows = [];
    for (const p of scoped) {
      const vs = variants.filter((v) => v.product_id === p.id);
      if (!vs.length) {
        if (!input.color && !input.talla) rows.push({ producto: p.name, variante: '(sin variantes)', stock: p.stock, minimo: p.min_stock ?? 0 });
        continue;
      }
      for (const v of matchVariants(vs, input.color, input.talla)) rows.push({ producto: p.name, variante: variantLabel(v), stock: v.stock, minimo: v.min_stock ?? 2 });
    }
    const filtro = input.filtro || 'todos';
    const out = rows.filter((r) => (filtro === 'agotados' ? r.stock === 0 : filtro === 'poco_stock' ? r.stock > 0 && r.stock <= r.minimo : true));
    const descuadres = scoped.filter((p) => {
      const vs = variants.filter((v) => v.product_id === p.id);
      return vs.length && vs.reduce((s, v) => s + v.stock, 0) !== p.stock;
    }).map((p) => p.name);
    return {
      total_filas: out.length, filas: out.slice(0, 80),
      ...(scoped.length > 1 && input.producto ? { aviso: `Coinciden ${scoped.length} productos con "${text(input.producto)}".` } : {}),
      ...(descuadres.length ? { aviso_descuadre: `El total guardado no coincide con la suma de variantes en: ${descuadres.join(', ')}. Las cifras por variante son las reales.` } : {}),
    };
  }

  async function dropColors(ctx, name) {
    const catalog = await catalogFor(ctx.business?.slug);
    if (!catalog) return null;
    const n = norm(name).replace(/\s*drop$/, '');
    const drop = catalog.drops.find((d) => norm(d.nombre).replace(/\s*drop$/, '') === n);
    if (drop) return drop.colores;
    const capsula = catalog.capsulas.find((c) => norm(c.nombre) === n);
    return capsula ? capsula.colores : [];
  }

  async function buscarProductos(input, ctx) {
    let products = await loadProducts(ctx.businessId, { includeInactive: !!input.incluir_inactivos });
    if (input.texto) products = matchProducts(products, input.texto);
    if (input.genero) products = products.filter((p) => p.gender === input.genero || (input.genero !== 'unisex' && p.gender === 'unisex'));
    if (input.categoria) products = products.filter((p) => norm(p.category) === norm(input.categoria));
    const variants = await loadVariants(ctx.businessId, products.map((p) => p.id));
    let rows = products.map((p) => {
      const vs = variants.filter((v) => v.product_id === p.id);
      return {
        producto: p.name, categoria: p.category, genero: p.gender, precio: Number(p.price), costo: p.cost_price == null ? null : Number(p.cost_price),
        margen_pct: p.cost_price != null && p.price > 0 ? Number((((p.price - p.cost_price) / p.price) * 100).toFixed(1)) : null,
        es_set: !!p.is_bundle, activo: p.is_active, colores: [...new Set(vs.map((v) => attr(v.attributes, 'color')).filter(Boolean))],
        stock_total: p.is_bundle ? null : vs.length ? vs.reduce((s, v) => s + v.stock, 0) : p.stock,
      };
    });
    if (input.color) rows = rows.filter((r) => r.colores.some((c) => norm(c) === norm(input.color)));
    if (input.drop) {
      const colors = await dropColors(ctx, input.drop);
      if (colors === null) return { success: false, error: 'No tengo configurados los drops de esta tienda.' };
      if (!colors.length) return { success: false, error: `No encontré el drop o cápsula "${text(input.drop)}".` };
      rows = rows.filter((r) => r.colores.some((c) => colors.some((d) => norm(d) === norm(c))));
    }
    return { total: rows.length, productos: rows.slice(0, 60) };
  }

  async function catalogoDrops(input, ctx) {
    const catalog = await catalogFor(ctx.business?.slug);
    if (!catalog) return { success: false, error: 'Esta tienda no tiene drops ni cápsulas configurados.' };
    const products = await loadProducts(ctx.businessId);
    const variants = await loadVariants(ctx.businessId, products.map((p) => p.id));
    const count = (colors) => products.filter((p) => variants.some((v) => v.product_id === p.id && colors.some((c) => norm(c) === norm(attr(v.attributes, 'color'))))).length;
    return {
      coleccion: catalog.coleccion,
      capsulas: catalog.capsulas.map((c) => ({ ...c, productos: count(c.colores) })),
      drops: catalog.drops.map((d) => ({ ...d, productos: count(d.colores) })),
    };
  }

  async function consultarSets(input, ctx) {
    const sets = await setsSummary(ctx.businessId, { nombre: input.nombre });
    return sets.length ? { total: sets.length, sets } : { total: 0, mensaje: 'No hay sets con ese nombre.' };
  }

  async function consultarPedidos(input, ctx) {
    let q = db.from('orders')
      .select('id, created_at, status, payment_status, payment_method, total_amount, shipping_cost, discount_amount, client_name, client_phone, source, shipping_city, order_items(description, quantity, unit_price)')
      .eq('business_id', ctx.businessId).order('created_at', { ascending: false });
    if (input.pago) q = q.eq('payment_status', input.pago);
    if (input.estado && ORDER_STATUSES.includes(input.estado)) q = q.eq('status', input.estado);
    if (input.desde) q = q.gte('created_at', `${text(input.desde, 10)}T00:00:00-05:00`);
    if (input.hasta) q = q.lte('created_at', `${text(input.hasta, 10)}T23:59:59-05:00`);
    const { data, error } = await q.limit(200);
    if (error) throw error;
    let rows = data || [];
    if (input.codigo) rows = rows.filter((o) => orderCode(o.id) === text(input.codigo, 12).toUpperCase());
    if (input.cliente) rows = rows.filter((o) => norm(o.client_name).includes(norm(input.cliente)) || String(o.client_phone || '').includes(text(input.cliente)));
    const limit = Math.min(Math.max(Number(input.limite) || 15, 1), 50);
    const t = now().getTime();
    return {
      total: rows.length,
      pedidos: rows.slice(0, limit).map((o) => {
        const horas = Math.floor((t - new Date(o.created_at).getTime()) / 3600000);
        return {
          codigo: orderCode(o.id), fecha: o.created_at, origen: o.source, estado: o.status, pago: o.payment_status, metodo: o.payment_method,
          cliente: o.client_name || 'Cliente sin datos', total_neto: Number(o.total_amount), envio: Number(o.shipping_cost || 0), descuento: Number(o.discount_amount || 0),
          items: (o.order_items || []).map((i) => `${i.quantity}× ${i.description}`),
          ...(o.payment_status !== 'pagado' && o.status !== 'cancelado' ? { horas_sin_pagar: horas, vencido_24h: o.source === 'web' && horas >= PAYMENT_WINDOW_H } : {}),
        };
      }),
    };
  }

  function periodRange(periodo, desde, hasta) {
    const today = dayISO(now());
    const back = (n) => dayISO(new Date(now().getTime() - n * 86400000));
    if (periodo === 'ayer') return { desde: back(1), hasta: back(1), prev: { desde: back(2), hasta: back(2) } };
    if (periodo === 'semana') return { desde: back(6), hasta: today, prev: { desde: back(13), hasta: back(7) } };
    if (periodo === 'mes') {
      const d = new Date(`${today.slice(0, 7)}-01T12:00:00-05:00`);
      const prevStart = dayISO(new Date(d.getFullYear(), d.getMonth() - 1, 1, 12));
      const prevEnd = dayISO(new Date(d.getFullYear(), d.getMonth() - 1, Math.min(Number(today.slice(8)), 28), 12));
      return { desde: `${today.slice(0, 7)}-01`, hasta: today, prev: { desde: prevStart, hasta: prevEnd } };
    }
    if (periodo === 'anio') return { desde: `${today.slice(0, 4)}-01-01`, hasta: today };
    if (periodo === 'trimestre') return { desde: back(89), hasta: today };
    if (periodo === 'todo') return { desde: null, hasta: null };
    if (periodo === 'rango') return { desde: text(desde, 10) || today, hasta: text(hasta, 10) || today };
    return { desde: today, hasta: today, prev: { desde: back(1), hasta: back(1) } };
  }

  async function ventasTienda(input, ctx) {
    const r = periodRange(input.periodo, input.desde, input.hasta);
    const cur = await salesBetween(ctx.businessId, r.desde, r.hasta);
    const prev = r.prev ? await salesBetween(ctx.businessId, r.prev.desde, r.prev.hasta) : null;
    return { desde: r.desde, hasta: r.hasta, ...cur, ...(prev ? { periodo_anterior: { desde: r.prev.desde, hasta: r.prev.hasta, total_neto: prev.total_neto, pedidos: prev.pedidos } } : {}) };
  }

  async function masVendidos(input, ctx) {
    const r = periodRange(input.periodo || 'mes');
    const orders = (await loadOrders(ctx.businessId, { desde: r.desde, hasta: r.hasta, select: 'id, status, order_items(description, quantity, unit_price, product_id)' })).filter((o) => o.status !== 'cancelado');
    const acc = {};
    for (const o of orders) for (const i of o.order_items || []) {
      const k = i.description;
      acc[k] = acc[k] || { producto: i.description, unidades: 0, ingresos: 0 };
      acc[k].unidades += Number(i.quantity || 0);
      acc[k].ingresos += Number(i.quantity || 0) * Number(i.unit_price || 0);
    }
    const limit = Math.min(Math.max(Number(input.limite) || 10, 1), 30);
    return { desde: r.desde, hasta: r.hasta, ranking: Object.values(acc).sort((a, b) => b.unidades - a.unidades || b.ingresos - a.ingresos).slice(0, limit) };
  }

  async function clientesFrecuentes(input, ctx) {
    const r = periodRange(input.periodo || 'trimestre');
    const orders = (await loadOrders(ctx.businessId, { desde: r.desde, hasta: r.hasta })).filter((o) => o.status !== 'cancelado' && (o.client_name || o.client_phone));
    const acc = {};
    for (const o of orders) {
      const k = String(o.client_phone || '').replace(/\D/g, '') || norm(o.client_name);
      acc[k] = acc[k] || { cliente: o.client_name || o.client_phone, pedidos: 0, total: 0, ultima_compra: o.created_at };
      acc[k].pedidos += 1;
      acc[k].total += Number(o.total_amount || 0);
      if (o.created_at > acc[k].ultima_compra) acc[k].ultima_compra = o.created_at;
    }
    const limit = Math.min(Math.max(Number(input.limite) || 10, 1), 30);
    return { desde: r.desde, hasta: r.hasta, clientes: Object.values(acc).sort((a, b) => b.pedidos - a.pedidos || b.total - a.total).slice(0, limit) };
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
    if (!v.variant && (v.needs || v.success === false)) return v;
    // "hoy" = stock de ESA variante (o del producto sin variantes) leído de la base ahora
    const before = await readStock(ctx.businessId, p.id, v.variant ? v.variant.id : null);
    if (before === null) return { success: false, error: 'No pude leer el stock actual.' };
    if (before + qty < 0) return { success: false, error: `No se puede restar ${Math.abs(qty)}: ${p.name}${v.variant ? `, ${variantLabel(v.variant)}` : ''} tiene ${before}.` };
    const who = `${p.name}${v.variant ? `, ${variantLabel(v.variant)}` : ''}`;
    const summary = `${qty > 0 ? 'Sumar' : 'Restar'} ${Math.abs(qty)} a ${who} (hoy ${before} → quedaría ${before + qty}). ¿Confirmas?`;
    return savePending(ctx, 'stock', summary, { product_id: p.id, variant_id: v.variant ? v.variant.id : null, delta: qty, before, label: who, motivo: text(input.motivo, 80) || 'ajuste' });
  }

  async function prepararCrearVariante(input, ctx) {
    const color = text(input.color, 40);
    const talla = text(input.talla, 40);
    if (!color || !talla) return { success: false, error: 'Para crear una variante necesito el color y la talla.' };
    const stock = input.stock_inicial === undefined || input.stock_inicial === null ? 0 : Number(input.stock_inicial);
    if (!Number.isInteger(stock) || stock < 0 || stock > MAX_QTY) return { success: false, error: 'El stock inicial debe ser un entero mayor o igual a 0.' };
    const r = await resolveProduct(ctx.businessId, input.producto, { includeInactive: true });
    if (!r.product) return r;
    const p = r.product;
    if (p.is_bundle) return { success: false, error: `${p.name} es un set: sus variantes salen de sus piezas.` };
    const all = await loadVariants(ctx.businessId, [p.id], { includeInactive: true });
    const dup = matchVariants(all, color, talla)[0];
    if (dup) {
      return dup.is_active
        ? { success: false, error: `${p.name} ya tiene la variante ${variantLabel(dup)} (stock ${dup.stock}). Si llegaron unidades, la ajusto con preparar_ajuste_stock.` }
        : { success: false, error: `${p.name} ya tiene la variante ${variantLabel(dup)} pero DESACTIVADA (stock ${dup.stock}). Puedo activarla (preparar_estado) en vez de crear otra.` };
    }
    // Igual que el panel: con stock propio sin variantes, crear variantes borraría esas unidades al recalcular
    if (!all.some((x) => x.is_active) && Number(p.stock) > 0) {
      return { success: false, error: `${p.name} tiene ${p.stock} unidades guardadas sin variante. Para pasarlo a variantes primero hay que dejar ese stock en 0 (pídeme "resta ${p.stock} a ${p.name}") y luego crear cada variante con su stock real.` };
    }
    const label = `${p.name}, ${cap(color)} talla ${talla.toUpperCase()}`;
    const summary = `Crear la variante ${cap(color)} talla ${talla.toUpperCase()} de ${p.name} con stock inicial ${stock}. ¿Confirmas?`;
    return savePending(ctx, 'crear_variante', summary, { product_id: p.id, color, talla, stock, label }, JSON.stringify({ k: 'crear_variante', p: p.id, c: norm(color), t: norm(talla) }));
  }

  async function prepararPrecio(input, ctx) {
    const price = Number(input.precio);
    if (!Number.isFinite(price) || price <= 0 || price > 100000000) return { success: false, error: 'El precio debe ser mayor que 0.' };
    const r = await resolveProduct(ctx.businessId, input.producto, { includeInactive: true });
    if (!r.product) return r;
    const p = r.product;
    if (Number(p.price) === price) return { success: false, error: `${p.name} ya cuesta ${cop(price)}.` };
    return savePending(ctx, 'precio', `Cambiar el precio de ${p.name}: ${cop(p.price)} → ${cop(price)}. ¿Confirmas?`, { product_id: p.id, before: Number(p.price), after: price, label: p.name });
  }

  async function prepararEstado(input, ctx) {
    if (typeof input.activo !== 'boolean') return { success: false, error: 'Indica si se activa o se desactiva.' };
    const r = await resolveProduct(ctx.businessId, input.producto, { includeInactive: true });
    if (!r.product) return r;
    const p = r.product;
    if (input.color || input.talla) {
      const v = await resolveVariant(ctx.businessId, p, input.color, input.talla, { includeInactive: true });
      if (!v.variant) return v;
      if (v.variant.is_active === input.activo) return { success: false, error: `${p.name}, ${variantLabel(v.variant)} ya está ${input.activo ? 'activa' : 'desactivada'}.` };
      if (input.activo) {
        const active = (await loadVariants(ctx.businessId, [p.id])).length;
        // Igual que al crear: sin variantes activas el total es stock propio, y activar una lo reemplazaría
        if (!active && Number(p.stock) > 0) {
          return { success: false, error: `${p.name} tiene ${p.stock} unidades guardadas sin variante. Si activo ${variantLabel(v.variant)}, el total pasaría a ser solo el de las variantes y esas ${p.stock} se perderían. Primero hay que dejar ese stock en 0 (pídeme "resta ${p.stock} a ${p.name}") y luego activar o crear las variantes con su stock real.` };
        }
      }
      const summary = `${input.activo ? 'Activar' : 'Desactivar'} ${p.name}, ${variantLabel(v.variant)}${input.activo ? '' : ' (deja de venderse; conserva su historial)'}. ¿Confirmas?`;
      return savePending(ctx, 'estado_variante', summary, { product_id: p.id, variant_id: v.variant.id, before: v.variant.is_active, after: input.activo, label: `${p.name}, ${variantLabel(v.variant)}` });
    }
    if (p.is_active === input.activo) return { success: false, error: `${p.name} ya está ${input.activo ? 'activo' : 'desactivado'}.` };
    const summary = `${input.activo ? 'Activar' : 'Desactivar'} ${p.name}${input.activo ? ' (se verá en la tienda)' : ' (deja de verse en la tienda)'}. ¿Confirmas?`;
    return savePending(ctx, 'estado_producto', summary, { product_id: p.id, before: p.is_active, after: input.activo, label: p.name });
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
          if (hits.length !== 1 || !it.color || !it.talla) return { needs: 'variante', pregunta: `${p.name}: ¿qué color y talla?`, opciones: d.variants.map((v) => ({ variante: variantLabel(v), disponibles: v.stock })) };
          variantId = hits[0].id; label = `${p.name} (${variantLabel(hits[0])})`; available = hits[0].stock;
        } else available = d.simpleStock;
      } else {
        const v = await resolveVariant(ctx.businessId, p, it.color, it.talla);
        if (!v.variant && (v.needs || v.success === false)) return v;
        if (v.variant) { variantId = v.variant.id; label = `${p.name} (${variantLabel(v.variant)})`; available = v.variant.stock; } else available = p.stock;
      }
      if (qty > available) return { success: false, error: `Solo hay ${available} de ${label}.` };
      lines.push({ product_id: p.id, variant_id: variantId, description: label, quantity: qty, unit_price: Number(p.price) });
    }
    const totals = computeTotals(lines);
    const disc = parseDiscount(input.descuento === undefined || input.descuento === null ? undefined : Number(input.descuento), totals.subtotal);
    if (disc.error) return { success: false, error: disc.error };
    const total = computeTotals(lines, { discount: disc.discount }).total;
    const cliente = text(input.cliente_nombre, 120) || null;
    const summary = `Registrar pedido: ${lines.map((l) => `${l.quantity}× ${l.description} ${cop(l.unit_price)}`).join(', ')}. Subtotal ${cop(totals.subtotal)}`
      + `${disc.discount ? `, descuento ${cop(disc.discount)}` : ''}, total ${cop(total)}. Cliente: ${cliente || 'sin datos'}. Pago: ${input.pagado ? `pagado${input.metodo_pago ? ` (${input.metodo_pago})` : ''}` : 'pendiente'}. ¿Confirmas?`;
    return savePending(ctx, 'pedido', summary, {
      body: {
        delivery_type: 'retiro', items: lines, client_name: cliente, client_phone: text(input.cliente_telefono, 30) || null,
        discount_amount: disc.discount, notes: text(input.notas, 300) || null,
        ...(input.pagado ? { payment_status: 'pagado', payment_method: input.metodo_pago || 'efectivo' } : {}),
      },
      total,
    });
  }

  async function findOrder(ctx, codigo) {
    const code = text(codigo, 12).toUpperCase();
    const rows = await loadOrders(ctx.businessId, { select: 'id, status, client_name, total_amount' });
    return rows.find((o) => orderCode(o.id) === code) || null;
  }

  async function prepararEstadoPedido(input, ctx) {
    const estado = String(input.estado || '');
    if (!ORDER_STATUSES.includes(estado) || estado === 'recibido') return { success: false, error: 'Estado inválido.' };
    const o = await findOrder(ctx, input.codigo);
    if (!o) return { success: false, error: `No encontré el pedido ${text(input.codigo, 12)}.` };
    if (o.status === 'cancelado') return { success: false, error: `El pedido ${orderCode(o.id)} está cancelado y ya no cambia de estado.` };
    if (o.status === estado) return { success: false, error: `El pedido ${orderCode(o.id)} ya está ${estado}.` };
    const summary = estado === 'cancelado'
      ? `Cancelar el pedido ${orderCode(o.id)} (${o.client_name || 'sin datos'}, ${cop(o.total_amount)}) y devolver su stock. No se puede deshacer. ¿Confirmas?`
      : `Pasar el pedido ${orderCode(o.id)} de ${o.status} a ${estado}. ¿Confirmas?`;
    return savePending(ctx, 'estado_pedido', summary, { order_id: o.id, before: o.status, after: estado, label: orderCode(o.id) });
  }

  // Inverso de una acción aplicada: { kind, summary, plan } o { error }
  async function inverseOf(a, ctx) {
    const p = a.plan || {};
    if (a.kind === 'stock') {
      if (!p.variant_id && (await loadVariants(ctx.businessId, [p.product_id])).length) {
        return { error: `${p.label} ahora tiene variantes activas: ese ajuste fue al total y ya no se puede revertir así. Dime qué variante corregir.` };
      }
      const current = await readStock(ctx.businessId, p.product_id, p.variant_id);
      if (current === null) return { error: `${p.label} ya no existe.` };
      if (current - p.delta < 0) return { error: `${p.label} tiene ${current} y habría que restar ${p.delta}.` };
      return { summary: `Deshacer: ${p.delta > 0 ? 'restar' : 'sumar'} ${Math.abs(p.delta)} a ${p.label} (hoy ${current} → quedaría ${current - p.delta}).`, plan: { kind: 'stock', product_id: p.product_id, variant_id: p.variant_id, delta: -p.delta, before: current, label: p.label } };
    }
    if (a.kind === 'precio') {
      const { data: prod } = await db.from('products').select('price').eq('business_id', ctx.businessId).eq('id', p.product_id).maybeSingle();
      if (!prod) return { error: `${p.label} ya no existe.` };
      if (Number(prod.price) !== Number(p.after)) return { error: `El precio de ${p.label} cambió después (hoy ${cop(prod.price)}).` };
      return { summary: `Deshacer: precio de ${p.label} ${cop(prod.price)} → ${cop(p.before)}.`, plan: { kind: 'precio', product_id: p.product_id, before: Number(prod.price), after: p.before, label: p.label } };
    }
    if (a.kind === 'estado_producto' || a.kind === 'estado_variante') {
      return { summary: `Deshacer: ${p.before ? 'activar' : 'desactivar'} de nuevo ${p.label}.`, plan: { kind: a.kind, product_id: p.product_id, variant_id: p.variant_id || null, before: p.after, after: p.before, label: p.label } };
    }
    if (a.kind === 'crear_variante') {
      const variantId = a.result?.variant_id;
      if (!variantId) return { error: 'No encontré la variante creada.' };
      return { summary: `Deshacer: desactivar la variante creada ${p.label} (queda inactiva con su historial).`, plan: { kind: 'estado_variante', product_id: p.product_id, variant_id: variantId, before: true, after: false, label: p.label } };
    }
    if (a.kind === 'pedido') {
      const orderId = a.result?.order_id;
      const { data: o } = await db.from('orders').select('status').eq('business_id', ctx.businessId).eq('id', orderId).maybeSingle();
      if (!o) return { error: 'Ese pedido ya no existe.' };
      if (o.status === 'cancelado') return { error: 'Ese pedido ya está cancelado.' };
      return { summary: `Deshacer: cancelar el pedido ${orderCode(orderId)} y devolver su stock.`, plan: { kind: 'estado_pedido', order_id: orderId, before: o.status, after: 'cancelado', label: orderCode(orderId) } };
    }
    if (a.kind === 'estado_pedido') {
      if (p.after === 'cancelado') return { error: `El pedido ${p.label} se canceló: una cancelación no se puede deshacer.` };
      return { summary: `Deshacer: pedido ${p.label} de ${p.after} a ${p.before}.`, plan: { kind: 'estado_pedido', order_id: p.order_id, before: p.after, after: p.before, label: p.label } };
    }
    return { error: 'Esa acción no se puede deshacer automáticamente.' };
  }

  async function prepararDeshacer(input, ctx) {
    const { data, error } = await db.from('assistant_actions').select('*').eq('business_id', ctx.businessId).eq('status', 'applied').order('applied_at', { ascending: false }).limit(MAX_BATCH);
    if (error) throw error;
    const last = (data || [])[0];
    if (!last) return { success: false, error: 'No encontré una acción reciente del asistente para deshacer.' };
    if (last.kind === 'undo') return { success: false, error: 'Lo último que hice ya fue un deshacer; no deshago un deshacer.' };
    if (now().getTime() - new Date(last.applied_at).getTime() > UNDO_WINDOW_MS) return { success: false, error: 'Esa acción tiene más de 7 días; no la deshago automáticamente.' };
    // Toda la última confirmación (si fueron varias), de la más reciente a la más antigua
    const batch = last.result?.batch_id ? (data || []).filter((a) => a.result?.batch_id === last.result.batch_id && a.kind !== 'undo') : [last];
    const out = []; const errors = [];
    for (const a of batch) {
      const inv = await inverseOf(a, ctx);
      if (inv.error) { errors.push(`${stripAsk(a.summary)} → no se puede: ${inv.error}`); continue; }
      const r = await savePending(ctx, 'undo', `${inv.summary} ¿Confirmas?`, { ...inv.plan, undo_of: a.id }, JSON.stringify({ k: 'undo', of: a.id }));
      out.push(stripAsk(r.resumen));
    }
    if (!out.length) return { success: false, error: errors.join(' · ') || 'No se puede deshacer.' };
    return { requiere_confirmacion: true, resumen: `${out.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n¿Confirmas?`, ...(errors.length ? { no_se_puede: errors } : {}) };
  }

  // ── Ejecutar (solo desde confirmar_accion) ──
  const call = async (fn, { params = {}, body = {} }, ctx) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await fn({ params, body, query: {}, headers: { authorization: ctx.authorization }, businessId: ctx.businessId, business: ctx.business }, res);
    return res;
  };

  async function execute(action, ctx) {
    const p = action.plan || {};
    const isUndo = action.kind === 'undo';
    const kind = isUndo ? p.kind : action.kind;
    if (kind === 'stock') {
      const before = await readStock(ctx.businessId, p.product_id, p.variant_id);
      if (before === null) return { ok: false, error: `${p.label} ya no existe.` };
      const { error } = await db.rpc('adjust_stock', {
        p_business_id: ctx.businessId, p_product_id: p.product_id, p_variant_id: p.variant_id || null, p_change: p.delta, p_type: 'ajuste',
        p_reason: isUndo ? 'deshacer asistente' : `Asistente: ${p.motivo || 'ajuste'}`, p_ref_type: 'assistant_action', p_ref_id: action.id, p_user: null,
      });
      if (error) return { ok: false, error: String(error.message || '').includes('STOCK_INSUFICIENTE') ? 'no hay stock suficiente para ese ajuste.' : 'la base rechazó el ajuste de stock.' };
      const after = await readStock(ctx.businessId, p.product_id, p.variant_id);
      const { data: mv } = await db.from('inventory_movements').select('id').eq('business_id', ctx.businessId).eq('reference_id', action.id).order('created_at', { ascending: false }).limit(1);
      return { ok: true, result: { antes: before, despues_leido: after, cambio: p.delta, movement_id: mv?.[0]?.id || null }, message: `${p.label}: ${before} → ${after}` };
    }
    if (kind === 'crear_variante') {
      const all = await loadVariants(ctx.businessId, [p.product_id], { includeInactive: true });
      if (matchVariants(all, p.color, p.talla).length) return { ok: false, error: `${p.label} ya existe.` };
      const r = await call(controllers.variants.create, { params: { productId: p.product_id }, body: { attributes: { color: cap(p.color), talla: p.talla.toUpperCase() }, stock: p.stock } }, ctx);
      if (r.code >= 400) return { ok: false, error: r.body?.error || 'no se pudo crear la variante.' };
      const vid = r.body?.data?.id;
      const stock = await readStock(ctx.businessId, p.product_id, vid);
      return { ok: stock !== null, result: { variant_id: vid, stock_leido: stock }, message: `${p.label}: creada con stock ${stock}`, error: 'la variante no quedó creada.' };
    }
    if (kind === 'precio') {
      const r = await call(controllers.products.update, { params: { id: p.product_id }, body: { price: p.after } }, ctx);
      if (r.code >= 400) return { ok: false, error: r.body?.error || 'no se pudo cambiar el precio.' };
      const { data } = await db.from('products').select('price').eq('business_id', ctx.businessId).eq('id', p.product_id).maybeSingle();
      return { ok: Number(data?.price) === Number(p.after), result: { antes: p.before, despues_leido: Number(data?.price) }, message: `${p.label}: ${cop(p.before)} → ${cop(data?.price)}`, error: 'el precio no quedó como se esperaba.' };
    }
    if (kind === 'estado_producto') {
      const { data: cur } = await db.from('products').select('is_active').eq('business_id', ctx.businessId).eq('id', p.product_id).maybeSingle();
      if (!cur) return { ok: false, error: 'el producto ya no existe.' };
      if (cur.is_active !== p.after) {
        const r = await call(controllers.products.toggleProduct, { params: { id: p.product_id } }, ctx);
        if (r.code >= 400) return { ok: false, error: r.body?.error || 'no se pudo cambiar el estado.' };
      }
      const { data } = await db.from('products').select('is_active').eq('business_id', ctx.businessId).eq('id', p.product_id).maybeSingle();
      return { ok: data?.is_active === p.after, result: { antes: p.before, despues_leido: data?.is_active }, message: `${p.label}: ${data?.is_active ? 'activo' : 'desactivado'}`, error: 'el estado no quedó como se esperaba.' };
    }
    if (kind === 'estado_variante') {
      const r = await call(controllers.variants.update, { params: { productId: p.product_id, variantId: p.variant_id }, body: { is_active: p.after } }, ctx);
      if (r.code >= 400) return { ok: false, error: r.body?.error || 'no se pudo cambiar la variante.' };
      const { data } = await db.from('product_variants').select('is_active').eq('business_id', ctx.businessId).eq('id', p.variant_id).maybeSingle();
      return { ok: data?.is_active === p.after, result: { antes: p.before, despues_leido: data?.is_active }, message: `${p.label}: ${data?.is_active ? 'activa' : 'desactivada'}${r.body?.warning ? ` (${r.body.warning})` : ''}`, error: 'la variante no quedó como se esperaba.' };
    }
    if (kind === 'pedido') {
      const r = await call(controllers.orders.create, { body: p.body }, ctx);
      if (r.code >= 400) return { ok: false, error: r.body?.error || 'no se pudo crear el pedido.' };
      const o = r.body.data;
      return { ok: true, result: { order_id: o.id, codigo: orderCode(o.id), total_leido: Number(o.total_amount), descuento: Number(o.discount_amount || 0) }, message: `pedido ${orderCode(o.id)} creado, total ${cop(o.total_amount)}${r.body.warning ? ` (${r.body.warning})` : ''}` };
    }
    if (kind === 'estado_pedido') {
      const r = await call(controllers.orders.updateStatus, { params: { id: p.order_id }, body: { status: p.after } }, ctx);
      if (r.code >= 400) return { ok: false, error: r.body?.error || 'no se pudo cambiar el pedido.' };
      const { data } = await db.from('orders').select('status').eq('business_id', ctx.businessId).eq('id', p.order_id).maybeSingle();
      return { ok: data?.status === p.after, result: { antes: p.before, estado_leido: data?.status }, message: `pedido ${p.label}: ${p.before} → ${data?.status}${p.after === 'cancelado' ? ' (stock devuelto)' : ''}`, error: 'el pedido no quedó como se esperaba.' };
    }
    return { ok: false, error: 'tipo de acción desconocido.' };
  }

  async function confirmar(input, ctx) {
    if (!isAffirmative(ctx.userMessage)) {
      return { success: false, error: 'El usuario no respondió "sí" en su último mensaje: pregúntale si confirma.' };
    }
    const open = await pendingActions(ctx.businessId);
    const expired = open.filter((a) => !live(a));
    for (const a of expired) await finish(a.id, ctx.businessId, { status: 'expired' });
    const batch = open.filter((a) => live(a) && seen(a, ctx)).slice(0, MAX_BATCH);
    if (!batch.length) {
      const unseen = open.filter((a) => live(a) && !seen(a, ctx));
      if (unseen.length) return { success: false, error: 'Esas propuestas se acaban de preparar: muéstralas al usuario y espera su "sí".' };
      return { success: false, error: expired.length ? 'Las propuestas vencieron (30 min). Pídelas de nuevo.' : 'No hay nada pendiente por confirmar (ya se ejecutó, se canceló o venció).' };
    }
    const batchId = crypto.randomUUID();
    const resultados = [];
    for (const [i, a] of batch.entries()) {
      let out;
      try {
        out = await execute(a, ctx);
      } catch (err) {
        out = { ok: false, error: 'error inesperado al ejecutar.' };
      }
      if (out.ok) {
        await finish(a.id, ctx.businessId, { status: 'applied', applied_at: now().toISOString(), result: { ...out.result, batch_id: batchId }, ...(a.kind === 'undo' ? { undo_of: a.plan.undo_of } : {}) });
        if (a.kind === 'undo') await finish(a.plan.undo_of, ctx.businessId, { status: 'undone', undone_at: now().toISOString() });
        resultados.push({ n: i + 1, ok: true, resultado: `${out.message} (leído de la base)`, ...out.result });
      } else {
        await finish(a.id, ctx.businessId, { status: 'failed', result: { error: out.error, batch_id: batchId } });
        resultados.push({ n: i + 1, ok: false, accion: stripAsk(a.summary), error: `FALLÓ: ${out.error}` });
      }
    }
    // Lo que el modelo haya vuelto a preparar en este mismo turno ya no aplica
    await db.from('assistant_actions').update({ status: 'cancelled' }).eq('business_id', ctx.businessId).eq('status', 'pending');
    const ok = resultados.filter((r) => r.ok);
    const lines = resultados.map((r) => `${r.n}. ${r.ok ? r.resultado : `${r.accion} → ${r.error}`}`);
    return {
      success: ok.length > 0, todas_ok: ok.length === resultados.length, resultados,
      resultado: lines.join(' · '),
      ...(ok.length ? {} : { error: `FALLÓ: ${resultados.map((r) => r.error).join(' · ')} No se cambió nada.` }),
    };
  }

  async function cancelar(input, ctx) {
    const open = (await pendingActions(ctx.businessId)).filter(live);
    if (!open.length) return { success: false, error: 'No hay nada pendiente por cancelar.' };
    await db.from('assistant_actions').update({ status: 'cancelled' }).eq('business_id', ctx.businessId).eq('status', 'pending');
    return { success: true, resultado: `Cancelado: no se cambió nada (${open.length} propuesta${open.length === 1 ? '' : 's'} descartada${open.length === 1 ? '' : 's'}).` };
  }

  // Contexto vivo de la tienda, inyectado en cada turno (todo leído de la base)
  async function storeContext(business) {
    const businessId = business.id;
    const today = dayISO(now());
    const month = `${today.slice(0, 7)}-01`;
    const [hoy, mes, pend, alerts, sets, inactivos, open, catalog] = await Promise.all([
      salesBetween(businessId, today, today), salesBetween(businessId, month, today), unpaidOrders(businessId), stockAlerts(businessId),
      setsSummary(businessId, { includeInactive: false }),
      loadProducts(businessId, { includeInactive: true }).then((r) => r.filter((p) => !p.is_active).length),
      pendingActions(businessId).then((r) => r.filter(live)), catalogFor(business.slug).catch(() => null),
    ]);
    const vencidos = pend.filter((o) => o.vencido);
    const pronto = pend.filter((o) => o.vence_en_horas != null && o.vence_en_horas <= 6);
    const lines = [
      `Negocio: ${business.name} (tienda)`,
      `Ventas hoy: ${cop(hoy.total_neto)} neto en ${hoy.pedidos} pedido(s)${hoy.descuentos ? `, descuentos ${cop(hoy.descuentos)}` : ''} | Mes: ${cop(mes.total_neto)} en ${mes.pedidos} pedido(s)`,
      `Sin pagar: ${pend.length} (${cop(pend.reduce((s, o) => s + o.total, 0))})${vencidos.length ? `; vencidos (+${PAYMENT_WINDOW_H} h): ${vencidos.slice(0, 4).map((o) => `${o.codigo} ${o.cliente}`).join(', ')}` : ''}${pronto.length ? `; vencen en ≤6 h: ${pronto.slice(0, 4).map((o) => `${o.codigo} (${o.vence_en_horas} h)`).join(', ')}` : ''}`,
      `Productos: ${alerts.productos.length} activos, ${inactivos} inactivos, ${alerts.variantes.length} variantes activas`,
      `Agotadas (${alerts.agotadas.length}): ${alerts.agotadas.slice(0, 8).join(', ') || 'ninguna'}`,
      `Poco stock (${alerts.poco_stock.length}): ${alerts.poco_stock.slice(0, 6).join(', ') || 'ninguna'}`,
      `Sets activos: ${sets.map((s) => `${s.set} (${s.disponibles_total} disp.)`).join(', ') || 'ninguno'}`,
      catalog ? `Colección ${catalog.coleccion}: ${catalog.drops.map((d) => `${d.nombre} = ${d.colores.join('/')}`).join('; ')}` : null,
      open.length ? `PROPUESTAS ESPERANDO EL "SÍ" DEL USUARIO (un solo "sí" las ejecuta todas con confirmar_accion; "no" → cancelar_accion; NO las vuelvas a preparar):\n${open.map((a, i) => `${i + 1}. ${stripAsk(a.summary)}`).join('\n')}` : null,
    ].filter(Boolean);
    return lines.join('\n');
  }

  // Una propuesta vale solo para el mensaje siguiente: si el usuario habla de otra cosa (ni sí ni no), se descarta
  async function discardUnanswered(ctx) {
    if (isAffirmative(ctx.userMessage) || isNegative(ctx.userMessage)) return 0;
    const open = (await pendingActions(ctx.businessId)).filter((a) => seen(a, ctx));
    for (const a of open) await finish(a.id, ctx.businessId, { status: 'cancelled', result: { motivo: 'el usuario siguió con otra cosa' } });
    return open.length;
  }

  // Resúmenes de lo que quedó propuesto en ESTE mensaje (el servidor se asegura de que el usuario los vea)
  async function proposedIn(ctx) {
    return (await pendingActions(ctx.businessId)).filter((a) => live(a) && !seen(a, ctx)).map((a) => stripAsk(a.summary));
  }

  // Herramienta que el servidor obliga a usar en este turno (el modelo no decide si confirma o deshace)
  async function forcedToolFor(ctx) {
    const open = (await pendingActions(ctx.businessId)).filter((a) => live(a) && seen(a, ctx));
    if (open.length && isNegative(ctx.userMessage)) return 'cancelar_accion';
    // Un "sí" SIEMPRE pasa por confirmar_accion: si no hay nada pendiente lo dice (el modelo no puede inventar un "listo")
    if (isAffirmative(ctx.userMessage)) return 'confirmar_accion';
    if (isUndoIntent(ctx.userMessage)) return 'preparar_deshacer';
    return null;
  }

  const handlers = {
    resumen_tienda: resumenTienda, consultar_stock: consultarStock, buscar_productos_tienda: buscarProductos, consultar_sets: consultarSets,
    catalogo_drops: catalogoDrops, consultar_pedidos: consultarPedidos, ventas_tienda: ventasTienda, productos_mas_vendidos: masVendidos,
    clientes_frecuentes: clientesFrecuentes, consultar_envio: consultarEnvio,
    preparar_ajuste_stock: prepararAjuste, preparar_crear_variante: prepararCrearVariante, preparar_cambio_precio: prepararPrecio,
    preparar_estado: prepararEstado, preparar_pedido_manual: prepararPedido, preparar_estado_pedido: prepararEstadoPedido,
    preparar_deshacer: prepararDeshacer, confirmar_accion: confirmar, cancelar_accion: cancelar,
  };

  return {
    tools: STORE_TOOLS,
    prompt: STORE_PROMPT,
    forcedToolFor,
    discardUnanswered,
    proposedIn,
    storeContext,
    handles: (name) => Object.prototype.hasOwnProperty.call(handlers, name),
    // El input nunca trae un business_id que valga: el negocio sale de ctx (sesión)
    execute: (name, input, ctx) => handlers[name](input && typeof input === 'object' ? input : {}, ctx),
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

module.exports = {
  createStoreAssistant, storeAssistant, isAffirmative, isNegative, isUndoIntent, claimsWrite, matchProducts,
  STORE_TOOLS, STORE_PROMPT, GENERIC_TOOLS_HIDDEN_FOR_STORE,
};
