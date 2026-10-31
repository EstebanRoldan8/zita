// Agente de TIENDA con modelo pequeño (Haiku por defecto). Principio: el modelo solo (1) entiende la intención
// y (2) devuelve una intención estructurada; el SERVIDOR hace lo determinista:
//  - enrutador por reglas (saludo, sí/no/deshacer, respuesta "2" a una pregunta, consultas frecuentes) → responde
//    con plantilla SIN llamar al modelo;
//  - resolución de producto/variante con tolerancia (tildes, mayúsculas, plurales, sinónimos de color y talla);
//    si hay varios candidatos, el servidor arma la pregunta numerada y la recuerda;
//  - propuestas: el servidor valida, calcula "hoy → quedaría", escribe el texto de confirmación y ejecuta tras el sí;
//  - una sola llamada al modelo por mensaje (más un reintento barato si la salida no es válida).
// business_id siempre de la sesión. Todo dato que se muestra se lee de la base.

const crypto = require('crypto');
const {
  storeAssistant, isAffirmative, isNegative, isUndoIntent, claimsWrite, matchProducts, norm, words, cop, stripAsk,
} = require('./assistantStore');

const HAIKU = 'claude-haiku-4-5-20251001';
const QUESTION_TTL_MS = 30 * 60 * 1000;
const FOCUS_TTL_MS = 2 * 60 * 60 * 1000;

// Lo que admite cada modelo: así se puede subir a Sonnet/Opus con la variable sin tocar código
function modelCaps(model) {
  const m = String(model || '');
  const noForcedTool = /(opus-5|sonnet-5-5|fable-5-1|mythos-5-1)/.test(m);
  const adaptiveThinking = /(opus-5|opus-4-[6-8]|sonnet-5|sonnet-4-6|haiku-5-5|fable|mythos)/.test(m);
  return {
    forcedTool: !noForcedTool,
    effort: adaptiveThinking,
    fallbacks: /(opus-5|sonnet-5-5|fable-5-1)/.test(m),
    thinking: adaptiveThinking,
  };
}

// Precio por millón de tokens (entrada, salida, lectura de caché, escritura de caché) para medir costo
const PRICES = {
  'claude-haiku-4-5': [1, 5, 0.1, 1.25],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-opus-5-5': [4, 20, 0.2, 5],
};
function costOf(model, u) {
  const key = Object.keys(PRICES).find((k) => String(model).startsWith(k));
  if (!key || !u) return null;
  const [i, o, cr, cw] = PRICES[key];
  return ((u.input || 0) * i + (u.output || 0) * o + (u.cache_read || 0) * cr + (u.cache_write || 0) * cw) / 1e6;
}

// ── Enrutador por reglas ──────────────────────────────────────────────────────
const clean = (s) => norm(s).replace(/[¡!¿?.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
const GREETING = /^(hola|holi|buenas|buenos dias|buenas tardes|buenas noches|hey|que mas|que hubo|quiubo|saludos)( \w+)?$/;
// Verbos de cambio ("llegaron", "súmale", "pon", "vendí"…): si aparecen, el mensaje va al modelo como acción.
// "¿cuánto he vendido?" NO es un cambio (vendido ≠ vendí).
const WRITE_HINT = /\b(llegaron|llego|entraron|entro|suma\w*|agrega\w*|anade\w*|quita\w*|resta\w*|descuenta\w*|vendi|vendimos|vendieron|registra\w*|sube\w*|baja\w*|cambia\w*|pon|ponle|ponlo|ponla|poner|activa\w*|desactiva\w*|crea\w*|cancela\w*|marca\w*|despacha\w*|hazme|haz|gaste|gastamos|pague|pagamos|compre|compramos|anota\w*|apunta\w*|borra\w*|elimina\w*|edita\w*|corrige|corregir|renombra\w*|envia\w*|manda\w*|recuerda\w*|oculta\w*|muestra el modulo)\b/;
function periodOf(m) {
  if (/\bayer\b/.test(m)) return 'ayer';
  if (/\bsemana\b/.test(m)) return 'semana';
  if (/\bmes\b/.test(m)) return 'mes';
  if (/\b(ano|anio|año)\b/.test(m)) return 'anio';
  return 'hoy';
}
const ORDINALS = { primer: 1, primero: 1, primera: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3, cuarto: 4, cuarta: 4, quinto: 5, quinta: 5 };
function pickIndex(m) {
  const n = m.match(/^(?:la |el |opcion |numero |la opcion |el numero )?(\d{1,2})$/);
  if (n) return Number(n[1]);
  const o = m.match(/^(?:la |el )?(primer|primero|primera|segundo|segunda|tercero|tercera|cuarto|cuarta|quinto|quinta)(?: opcion)?$/);
  return o ? ORDINALS[o[1]] : null;
}

// Clasifica el mensaje. state: { pregunta, hayPropuestas }
function classify(message, state = {}) {
  const m = clean(message);
  if (!m) return { type: 'empty' };
  if (state.pregunta) {
    const idx = pickIndex(m);
    if (idx) return { type: 'answer', index: idx };
    const opt = matchOption(m, state.pregunta.plan?.opciones || []);
    if (opt) return { type: 'answer', index: opt };
  }
  if (GREETING.test(m)) return { type: 'greeting' };
  // "cancela el pedido P-…", "anula el gasto de…" son pedidos de acción, no un "no" a lo pendiente
  if (isNegative(m) && !/^(cancel|anul)\w* (el|la|los|las|ese|esa|un|una) (pedido|gasto|egreso|ingreso|movimiento|venta|p-)/.test(m)) return { type: 'no' };
  if (isAffirmative(m)) return { type: 'yes' };
  if (isUndoIntent(m)) return { type: 'undo' };
  if (!WRITE_HINT.test(m)) {
    // Caja sin modelo: "¿cuánto hay en caja?" es el neto del período (no un saldo)
    if (/(cuanto hay en (la )?caja|como va la caja|como esta la caja|caja de (hoy|ayer|la semana|este mes|el mes)|cuanta plata hay|saldo de (la )?caja)/.test(m)) return { type: 'query', consulta: 'caja_resumen', periodo: /\bayer\b/.test(m) ? 'ayer' : /\bsemana\b/.test(m) ? 'semana' : /\bmes\b/.test(m) ? 'mes' : 'hoy' };
    if (/(como voy con la meta|como va la meta|cuanto me falta para la meta)/.test(m)) return { type: 'query', consulta: 'meta_progreso' };
    if (/(como vamos|como va (el dia|todo|hoy|la tienda)|como estamos|resumen|como nos (fue|va))/.test(m)) return { type: 'query', consulta: 'resumen_hoy' };
    if (/(poco stock|por agotar|casi agotad|bajo stock|stock bajo)/.test(m)) return { type: 'query', consulta: 'poco_stock' };
    if (/(agot(ad|o|aron|ó)|se acabo|se acabaron|sin stock|no hay stock|que falta)/.test(m)) return { type: 'query', consulta: 'agotados' };
    if (/(sin pagar|pendientes? de pago|no (me )?han pagado|por cobrar|pagos pendientes|falta(n)? por pagar)/.test(m)) return { type: 'query', consulta: 'sin_pagar' };
    if (/(mas vendid|lo que mas se vende|que se vende mas|top de ventas|mas se vendio)/.test(m)) return { type: 'query', consulta: 'mas_vendidos', periodo: periodOf(m) === 'hoy' ? 'mes' : periodOf(m) };
    if (/(cuanto (he|hemos|se ha|se han)? ?vendid|cuanto vendi|cuanto vendimos|ventas de (hoy|ayer|la semana|esta semana|este mes|el mes)|como van las ventas)/.test(m)) return { type: 'query', consulta: 'ventas', periodo: periodOf(m) };
    if (/(^cuant[oa]s?\b.*\b(hay|queda|quedan|tengo|tenemos|tienes)\b|stock de|stock del|que tallas|hay de|tienes de|quedan de|^(cuanto|cuanta|cuantos|cuantas) (hay )?de\b)/.test(m)) return { type: 'query', consulta: 'stock' };
  }
  return { type: 'model' };
}

// ¿El texto señala una de las opciones? ("la verde M", "top jana") → número de opción (1..n) o null
function matchOption(m, opciones) {
  const mw = words(m).filter((w) => w.length >= 1);
  if (!mw.length || mw.length > 6) return null;
  const hits = opciones.map((o, i) => ({ i: i + 1, w: words(`${o.label} ${o.color || ''} ${o.talla || ''}`) }))
    .filter((o) => mw.every((w) => o.w.some((x) => x === w || (w.length >= 3 && x.startsWith(w)))));
  return hits.length === 1 ? hits[0].i : null;
}

// ── Intención estructurada (lo único que hace el modelo) ──────────────────────
const ACCIONES = ['sumar_stock', 'restar_stock', 'fijar_stock', 'crear_variante', 'cambiar_precio', 'activar', 'desactivar', 'pedido', 'estado_pedido'];
const CONSULTAS = ['resumen_hoy', 'agotados', 'poco_stock', 'stock', 'sin_pagar', 'mas_vendidos', 'ventas', 'pedidos', 'sets', 'drops', 'envio', 'clientes', 'producto_info'];
const TIPOS = ['acciones', 'consulta', 'charla', 'no_puedo', 'no_entendi'];
const str = { type: 'string' };
const INTERPRET_TOOL = {
  name: 'interpretar',
  description: 'Devuelve la intención del mensaje del dueño de la tienda como datos. Siempre se llama.',
  input_schema: {
    type: 'object',
    properties: {
      tipo: { type: 'string', enum: TIPOS },
      acciones: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            accion: { type: 'string', enum: ACCIONES },
            producto: str, color: str, talla: str,
            cantidad: { type: 'integer' }, stock_final: { type: 'integer' }, precio: { type: 'integer' },
            todos: { type: 'boolean', description: 'true si habla en plural de varios productos ("las licras")' },
            codigo: str, estado: { type: 'string', enum: ['en_proceso', 'listo', 'enviado', 'entregado', 'cancelado'] },
            items: { type: 'array', items: { type: 'object', properties: { producto: str, color: str, talla: str, cantidad: { type: 'integer' } }, required: ['producto', 'cantidad'] } },
            descuento: { type: 'integer' }, cliente: str, telefono: str, pagado: { type: 'boolean' },
            metodo_pago: { type: 'string', enum: ['efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'otro'] },
          },
          required: ['accion'],
        },
      },
      consulta: {
        type: 'object',
        properties: { tipo: { type: 'string', enum: CONSULTAS }, producto: str, color: str, talla: str, periodo: { type: 'string', enum: ['hoy', 'ayer', 'semana', 'mes', 'anio'] }, ciudad: str, codigo: str },
        required: ['tipo'],
      },
      respuesta: { type: 'string', description: 'Solo para charla / no_puedo: 1-2 frases cortas.' },
    },
    required: ['tipo'],
  },
};

const INTERPRET_PROMPT = `Eres el intérprete del asistente de una TIENDA de ropa (productos con variantes color + talla, sets, pedidos).
NO respondes al usuario: llamas SIEMPRE la herramienta "interpretar" con lo que el dueño quiere. El sistema hace todo lo demás.

REGLAS:
1. tipo "acciones" si quiere CAMBIAR algo; una entrada por cosa (varias en un mensaje = varias acciones).
2. sumar_stock: "llegaron N", "súmale N", "agrega N" (cantidad positiva). restar_stock: "quita N", "se perdieron N". fijar_stock: "pon agotado" (stock_final 0) o "deja en N".
3. crear_variante: "agrégale la variante azul S" / "crea talla M negra" (cantidad = stock inicial si lo dicen). activar / desactivar: producto o variante.
4. cambiar_precio: precio en pesos enteros ("129900", "129 mil" = 129000). Si habla en plural de varios ("las licras") pon todos: true.
5. pedido: "vendí…", "hazme un pedido de…": items con producto, color, talla, cantidad; descuento en pesos ("10 mil" = 10000); cliente si lo dice.
6. estado_pedido: "marca P-XXXX como enviado", "cancela el pedido P-XXXX" (codigo tal cual).
7. Copia el producto, color y talla COMO LOS DIJO (sin inventar ni completar). Si falta algo, déjalo vacío: el sistema pregunta.
8. "esa", "esas", "ese producto" = el FOCO que te da el sistema.
9. tipo "consulta" si pregunta datos: resumen_hoy, agotados, poco_stock, stock (de un producto), sin_pagar, mas_vendidos, ventas (periodo), pedidos (codigo o cliente), sets, drops, envio (ciudad), clientes (frecuentes), producto_info (precio, costo, margen).
10. tipo "no_puedo" con "tema" si pide algo fuera de alcance (ver TEMAS abajo) o un dato que no está en tus consultas (tema "sin_consulta" + "donde").
11. tipo "charla" para saludo o comentario sin datos; "no_entendi" si no se entiende.
12. Abajo pueden venir más acciones y consultas del tema del mensaje (Caja, pedidos, productos, clientes…): úsalas igual.

EJEMPLOS (mensaje → interpretar):
- "¿cuántas licra aria negras hay?" → {"tipo":"consulta","consulta":{"tipo":"stock","producto":"licra aria","color":"negras"}}
- "llegaron 3 top jana" → {"tipo":"acciones","acciones":[{"accion":"sumar_stock","producto":"top jana","cantidad":3}]}
- "súmale 1 al negro M y 2 al azul S de short liva" → {"tipo":"acciones","acciones":[{"accion":"sumar_stock","producto":"short liva","color":"negro","talla":"M","cantidad":1},{"accion":"sumar_stock","producto":"short liva","color":"azul","talla":"S","cantidad":2}]}
- "agrégale 2 variantes, azul S y negro M a camiseta elite" → {"tipo":"acciones","acciones":[{"accion":"crear_variante","producto":"camiseta elite","color":"azul","talla":"S"},{"accion":"crear_variante","producto":"camiseta elite","color":"negro","talla":"M"}]}
- (FOCO: Short Nila, Vino tinto talla M) "llegaron 3 de esas" → {"tipo":"acciones","acciones":[{"accion":"sumar_stock","producto":"Short Nila","color":"Vino tinto","talla":"M","cantidad":3}]}
- "pon agotado el short nila vino tinto" → {"tipo":"acciones","acciones":[{"accion":"fijar_stock","producto":"short nila","color":"vino tinto","stock_final":0}]}
- "sube el precio de las licras a 129900" → {"tipo":"acciones","acciones":[{"accion":"cambiar_precio","producto":"licras","precio":129900,"todos":true}]}
- "hazme un pedido de 2 tops jana verdes con 10 mil de descuento" → {"tipo":"acciones","acciones":[{"accion":"pedido","items":[{"producto":"top jana","color":"verde","cantidad":2}],"descuento":10000}]}
- "súbeme fotos del top aria" → {"tipo":"no_puedo","tema":"fotos"}`;

// ── Capacidades por tema: el modelo recibe SOLO las del tema del mensaje (menos tokens, menos confusión) ──
// Las reglas eligen los temas; cada tema suma sus acciones/consultas al enum, sus campos al esquema y un bloque
// corto de instrucciones (con caché). Sin tema, el modelo ve lo de siempre (stock, precios, pedidos).
const DOMAIN_RULES = [
  ['caja', /\b(caja|ingres\w*|egres\w*|gast\w*|pague|pagamos|compre|compramos|entro|entraron|salio|salieron|plata|efectivo|nequi|daviplata|bancolombia|arriendo|nomina|sueldo|bolsas?|empaques?|meta|utilidad|ganancia|gane|neto|saldo|movimiento)\b/],
  ['pedidos', /\b(pedidos?|p-?[0-9a-f]{4,8}|pagad[oa]|pago|transportadora|guia|enviad[oa]|despach\w*|descuento|cancel\w*)\b/],
  ['productos', /\b(productos?|crea\w*|costo|costos|categoria|genero|descripcion|variantes?|sku|minimo|elimin\w*|borr\w*|renombr\w*|nombre|historial|movimientos)\b|\bcambi\w* (la |el )?(talla|color)\b/],
  ['sets', /\b(sets?|combos?)\b/],
  ['clientes', /\b(client[ae]s?|whatsapp|recordatorio|volver a comprar|vuelto|volvieron|inactivos|no compran|correo|email|celular)\b/],
  ['equipo', /\b(emplead\w*|vendedor\w*|equipo|comision)\b/],
  ['config', /\b(perfil|direccion|telefono del negocio|nombre del negocio|modulos?|menu|notificacion\w*)\b/],
  ['reportes', /\b(margen|rentab\w*|vend\w* (de|del)|se vendio|valor del inventario|vale|por categoria|inventario|reporte)\b/],
];
const TEMAS = ['fotos', 'whatsapp', 'plan', 'contrasena', 'tienda_config', 'exportar', 'usuarios', 'sin_consulta', 'otro'];
const DONDE = ['caja', 'analiticas', 'pedidos', 'productos', 'clientes', 'inicio'];
const int = { type: 'integer' };
const strOrInt = { type: ['string', 'integer'] };
const DOMAIN_FIELDS = {
  caja: { monto: int, categoria: str, descripcion: str, fecha: { type: 'string', description: 'hoy, ayer o YYYY-MM-DD' }, metodo: str, tipo_mov: { type: 'string', enum: ['ingreso', 'egreso'] }, buscar: str, nuevo_monto: int, nueva_categoria: str, nueva_descripcion: str, nueva_fecha: str },
  pedidos: { pago: { type: 'string', enum: ['pagado', 'pendiente', 'fallido', 'reembolsado'] }, metodo: str, transportadora: str, guia: str },
  productos: { nombre: str, costo: int, categoria: str, genero: { type: 'string', enum: ['mujer', 'hombre', 'unisex'] }, descripcion: str, variantes: { type: 'array', items: { type: 'object', properties: { color: str, talla: str, cantidad: int } } }, campo: str, valor: strOrInt, nuevo_color: str, nueva_talla: str, sku: str, stock_minimo: int },
  sets: { nombre: str, set: str, piezas: { type: 'array', items: { type: 'object', properties: { producto: str, cantidad: int } } } },
  clientes: { email: str, campo: str, valor: strOrInt, nombre: str },
  equipo: { empleado: str, nombre: str, email: str, comision: int, campo: str, valor: strOrInt, activo: { type: 'boolean' } },
  config: { campo: str, valor: str, modulo: str, activo: { type: 'boolean' } },
  reportes: {},
};
const QUERY_FIELDS = { texto: str, tipo_mov: { type: 'string', enum: ['ingreso', 'egreso'] }, categoria: str, dias: int, cliente: str, todos: { type: 'boolean' } };
const DOMAIN_PROMPTS = {
  caja: `CAJA = plata que entra o sale (no es stock). Montos en pesos enteros: "50mil"/"50 mil" = 50000, "2 millones" = 2000000; si dicen solo "200", pon 200 (el sistema pregunta).
- registrar_egreso: "gasté/pagué/compré X en Y" → monto, descripcion (en qué, tal cual), categoria solo si la dicen, metodo si lo dicen (efectivo, nequi…), fecha si no es hoy.
- registrar_ingreso: "entraron/recibí/me pagaron X" (plata) → igual. "entraron 5 top jana" es sumar_stock.
- editar_movimiento / anular_movimiento: corregir o borrar un ingreso/egreso → tipo_mov, buscar (texto o "ultimo"), monto (el actual si lo dicen), nuevo_monto / nueva_categoria / nueva_descripcion / nueva_fecha.
- meta_mensual: "pon la meta del mes en X" → monto.
- Consultas: caja_resumen ("cuánto gané", "cómo va la caja", periodo), caja_movimientos ("cuánto gasté en bolsas este mes": tipo_mov, texto, categoria, periodo), meta_progreso.
Ej: "gaste 50mil en bolsas" → {"tipo":"acciones","acciones":[{"accion":"registrar_egreso","monto":50000,"descripcion":"bolsas"}]}
"entraron 200 en efectivo" → {"tipo":"acciones","acciones":[{"accion":"registrar_ingreso","monto":200,"metodo":"efectivo"}]}
"cuanto gaste este mes en bolsas" → {"tipo":"consulta","consulta":{"tipo":"caja_movimientos","tipo_mov":"egreso","texto":"bolsas","periodo":"mes"}}
"borra el gasto de 50 mil de bolsas" → {"tipo":"acciones","acciones":[{"accion":"anular_movimiento","tipo_mov":"egreso","monto":50000,"buscar":"bolsas"}]}`,
  pedidos: `PEDIDOS (además de pedido y estado_pedido): pago_pedido (codigo, pago, metodo), envio_pedido (codigo, transportadora, guia), descuento_pedido (pedido YA creado: codigo, descuento), eliminar_pedido (borrar del todo; cancelar = estado_pedido cancelado).
Ej: "el p-1a2b3c4d ya pago por nequi" → {"tipo":"acciones","acciones":[{"accion":"pago_pedido","codigo":"P-1A2B3C4D","pago":"pagado","metodo":"nequi"}]}`,
  productos: `PRODUCTOS: crear_producto (nombre, precio, costo, categoria, genero, descripcion, variantes [{color,talla,cantidad}] o cantidad), editar_producto (producto + campo costo|nombre|categoria|genero|descripcion|stock_minimo|precio + valor; plural "las licras" → todos true), eliminar_producto (borrar del todo; ocultar = desactivar), editar_variante (producto, color, talla actuales + nuevo_color/nueva_talla/sku/stock_minimo), eliminar_variante. Consulta: historial_producto.
Ej: "cambia el costo de la licra aria a 70000" → {"tipo":"acciones","acciones":[{"accion":"editar_producto","producto":"licra aria","campo":"costo","valor":70000}]}
"crea un producto short prueba negro talla S 3 unidades a 80000" → {"tipo":"acciones","acciones":[{"accion":"crear_producto","nombre":"short prueba","precio":80000,"variantes":[{"color":"negro","talla":"S","cantidad":3}]}]}`,
  sets: `SETS: crear_set (nombre, precio, piezas [{producto,cantidad}]), editar_set (set + precio/nombre/piezas).
Ej: "arma el set playa con top aria y short nila a 130 mil" → {"tipo":"acciones","acciones":[{"accion":"crear_set","nombre":"set playa","precio":130000,"piezas":[{"producto":"top aria","cantidad":1},{"producto":"short nila","cantidad":1}]}]}`,
  clientes: `CLIENTES: crear_cliente (nombre, telefono, email), editar_cliente (cliente + campo nombre|telefono|email|notas + valor), eliminar_cliente, recordar_cliente (enviar por WhatsApp el mensaje de volver a comprar). Consultas: cliente_info (cliente), clientes_inactivos (dias; "qué clientes no han vuelto").
Ej: "agrega a ana gomez 3001234567 como cliente" → {"tipo":"acciones","acciones":[{"accion":"crear_cliente","nombre":"ana gomez","telefono":"3001234567"}]}`,
  equipo: `EQUIPO: crear_empleado (nombre, telefono, email, comision %), editar_empleado (empleado + campo nombre|telefono|email|comision|activo + valor / activo), eliminar_empleado. Consulta: empleados.`,
  config: `CONFIGURACIÓN: editar_perfil (campo nombre|dueno|telefono|direccion + valor), modulo (modulo + activo: mostrar/ocultar del menú), notificaciones (activo: avisos de WhatsApp al dueño).`,
  reportes: `REPORTES (lectura): ventas_producto ("cuánto vendí del set aria": producto, periodo), margen_categoria (periodo), valor_inventario. periodo: hoy, ayer, semana, mes, mes_pasado, anio, todo.`,
};
const TEMAS_PROMPT = `TEMAS de no_puedo: fotos, whatsapp (tokens/conexión), plan (suscripción/pagos de ZITA), contrasena, tienda_config (tarifas de envío, métodos de pago o textos de la tienda en línea), exportar (PDF/Excel), usuarios (roles), sin_consulta (dato que no está en tus consultas; pon "donde": caja|analiticas|pedidos|productos|clientes|inicio).`;

// Temas del mensaje (por reglas, sin modelo); como máximo 3 para que el contexto no crezca
function domainsOf(message) {
  const m = clean(message);
  return DOMAIN_RULES.filter(([, re]) => re.test(m)).map(([d]) => d).slice(0, 3);
}

// Herramienta "interpretar" y bloque de instrucciones para estos temas (orden fijo: el mismo tema = misma caché)
function interpretFor(domains, caps) {
  const ds = [...new Set(domains)].sort();
  const regs = (caps?.list || []).filter((c) => ds.includes(c.domain));
  const acciones = [...ACCIONES, ...regs.filter((c) => c.type === 'action').map((c) => c.name)];
  const consultas = [...CONSULTAS, ...regs.filter((c) => c.type === 'query').map((c) => c.name)];
  const tool = JSON.parse(JSON.stringify(INTERPRET_TOOL));
  const item = tool.input_schema.properties.acciones.items;
  item.properties.accion.enum = acciones;
  for (const d of ds) Object.assign(item.properties, DOMAIN_FIELDS[d] || {});
  const q = tool.input_schema.properties.consulta;
  q.properties.tipo.enum = consultas;
  q.properties.periodo.enum = ['hoy', 'ayer', 'semana', 'mes', 'mes_pasado', 'anio', 'todo'];
  if (ds.length) Object.assign(q.properties, QUERY_FIELDS);
  tool.input_schema.properties.tema = { type: 'string', enum: TEMAS };
  tool.input_schema.properties.donde = { type: 'string', enum: DONDE };
  const block = [...ds.map((d) => DOMAIN_PROMPTS[d]).filter(Boolean), TEMAS_PROMPT].join('\n\n');
  return { tool, block, acciones, consultas, domains: ds };
}

function validateIntent(x, allowed = { acciones: ACCIONES, consultas: CONSULTAS }) {
  if (!x || typeof x !== 'object') return 'no es un objeto';
  if (!TIPOS.includes(x.tipo)) return 'tipo inválido';
  const s = (v, max = 120) => v === undefined || v === null || (typeof v === 'string' && v.length <= max);
  const n = (v) => v === undefined || v === null || (Number.isInteger(v) && v >= -100000 && v <= 100000000000);
  const sn = (v, max = 300) => s(v, max) || n(v);
  if (x.tipo === 'acciones') {
    if (!Array.isArray(x.acciones) || !x.acciones.length || x.acciones.length > 10) return 'acciones vacías o demasiadas';
    for (const a of x.acciones) {
      if (!a || !allowed.acciones.includes(a.accion)) return 'acción inválida';
      if (![a.producto, a.color, a.talla, a.codigo, a.cliente, a.telefono, a.nombre, a.categoria, a.metodo, a.buscar, a.campo, a.set, a.empleado, a.modulo, a.email, a.sku, a.transportadora, a.guia, a.nuevo_color, a.nueva_talla, a.nueva_categoria, a.fecha, a.nueva_fecha].every((v) => s(v))) return 'texto inválido';
      if (![a.descripcion, a.nueva_descripcion].every((v) => s(v, 1000)) || !sn(a.valor, 1000)) return 'texto inválido';
      if (![a.cantidad, a.stock_final, a.precio, a.descuento, a.monto, a.nuevo_monto, a.costo, a.comision, a.stock_minimo].every(n)) return 'número inválido';
      for (const list of [a.variantes, a.piezas]) if (list !== undefined && (!Array.isArray(list) || list.length > 30)) return 'lista inválida';
      if (a.accion === 'pedido' && (!Array.isArray(a.items) || !a.items.length || a.items.length > 20 || !a.items.every((i) => i && s(i.producto) && i.producto && n(i.cantidad)))) return 'pedido sin ítems válidos';
      if (ACCIONES.includes(a.accion) && a.accion !== 'pedido' && a.accion !== 'estado_pedido' && !a.producto) return 'falta el producto';
    }
  }
  if (x.tipo === 'consulta' && (!x.consulta || !allowed.consultas.includes(x.consulta.tipo))) return 'consulta inválida';
  if ((x.tipo === 'charla' || x.tipo === 'no_puedo') && !s(x.respuesta, 600)) return 'respuesta inválida';
  if (x.tema !== undefined && !TEMAS.includes(x.tema)) return 'tema inválido';
  return null;
}

// ── Plantillas ────────────────────────────────────────────────────────────────
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
function greetingText(biz, hour) {
  const h = hour >= 5 && hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  return `${h} 👋 Soy el asistente de ${biz.name}. Pregúntame cómo van las ventas, cómo va la Caja o el stock de una prenda, o pídeme registrar un gasto o un ingreso, sumar stock, cambiar un precio o un costo, crear un producto o registrar un pedido.`;
}

function resumenText(r, hour) {
  const h = hour >= 5 && hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const trend = r.hoy.total_neto > r.ayer.total_neto ? '📈' : r.hoy.total_neto < r.ayer.total_neto ? '📉' : '➖';
  const lines = [`${h} ☀️`, `💰 Hoy: ${cop(r.hoy.total_neto)} en ${plural(r.hoy.pedidos, 'pedido', 'pedidos')} (ayer ${cop(r.ayer.total_neto)}) ${trend}`,
    `📅 Mes: ${cop(r.mes.total_neto)} en ${plural(r.mes.pedidos, 'pedido', 'pedidos')}${r.mes.descuentos ? `, descuentos ${cop(r.mes.descuentos)}` : ''}`];
  const p = r.pendientes_de_pago;
  if (p.total) lines.push(`🧾 Sin pagar: ${plural(p.total, 'pedido', 'pedidos')} (${cop(p.monto)})${p.vencidos.length ? `; ⚠️ vencidos (+24 h): ${p.vencidos.slice(0, 3).map((o) => `${o.codigo} ${o.cliente}`).join(', ')}` : ''}`);
  if (r.agotadas.total) lines.push(`📦 Agotadas: ${r.agotadas.total} (${r.agotadas.ejemplos.slice(0, 4).join(', ')})`);
  if (r.poco_stock.total) lines.push(`📉 Poco stock: ${r.poco_stock.total} (${r.poco_stock.ejemplos.slice(0, 3).join(', ')})`);
  const tip = p.vencidos.length ? `Escríbele a ${p.vencidos[0].cliente} por el ${p.vencidos[0].codigo} o cancélalo para liberar el stock.`
    : r.agotadas.total ? `Revisa si toca reponer ${r.agotadas.ejemplos[0]}.`
      : p.total ? 'Haz seguimiento a los pedidos sin pagar.' : 'Todo en orden por ahora.';
  lines.push(`💡 ${tip}`);
  return lines.join('\n');
}

function stockText(r, filtro) {
  if (!r.filas?.length) return filtro === 'agotados' ? '✅ No hay nada agotado.' : filtro === 'poco_stock' ? '✅ Nada con poco stock.' : (r.mensaje || 'No encontré stock para eso.');
  const head = filtro === 'agotados' ? `📦 Agotado (${r.total_filas}):` : filtro === 'poco_stock' ? `📉 Poco stock (${r.total_filas}):` : '📦 Stock:';
  const rows = r.filas.slice(0, 20).map((f) => `• ${f.producto}${f.variante && f.variante !== '(sin variantes)' ? ` — ${f.variante}` : ''}: ${f.stock}`);
  const more = r.total_filas > 20 ? `\n… y ${r.total_filas - 20} más.` : '';
  return `${head}\n${rows.join('\n')}${more}${r.aviso_descuadre ? `\n⚠️ ${r.aviso_descuadre}` : ''}`;
}

function unpaidText(r) {
  const rows = (r.pedidos || []).filter((o) => o.estado !== 'cancelado' && o.pago !== 'pagado');
  if (!rows.length) return '✅ No hay pedidos sin pagar.';
  return `🧾 Sin pagar (${rows.length}):\n${rows.slice(0, 10).map((o) => `• ${o.codigo} ${o.cliente} — ${cop(o.total_neto)}${o.horas_sin_pagar !== undefined ? ` (${o.horas_sin_pagar} h${o.vencido_24h ? ', vencido' : ''})` : ''}`).join('\n')}`;
}

const PERIOD_LABEL = { hoy: 'hoy', ayer: 'ayer', semana: 'esta semana (7 días)', mes: 'este mes', anio: 'este año' };
function salesText(r, periodo) {
  const prev = r.periodo_anterior ? ` · antes: ${cop(r.periodo_anterior.total_neto)} ${r.total_neto >= r.periodo_anterior.total_neto ? '📈' : '📉'}` : '';
  return `💰 Ventas ${PERIOD_LABEL[periodo] || periodo}: ${cop(r.total_neto)} neto en ${plural(r.pedidos, 'pedido', 'pedidos')}${prev}\n`
    + `Cobrado ${cop(r.cobrado)} · pendiente ${cop(r.pendiente_de_pago)}${r.descuentos ? ` · descuentos ${cop(r.descuentos)}` : ''}${r.pedidos ? ` · ticket promedio ${cop(r.ticket_promedio)}` : ''}`;
}

function topText(r) {
  if (!r.ranking?.length) return 'Todavía no hay ventas en ese período.';
  return `🏆 Más vendidos (${r.desde} a ${r.hasta}):\n${r.ranking.slice(0, 8).map((x, i) => `${i + 1}. ${x.producto} — ${x.unidades} u. (${cop(x.ingresos)})`).join('\n')}`;
}

function questionText(q) {
  return `${q.pregunta}\n${q.opciones.map((o, i) => `${i + 1}. ${o.label}${o.extra ? ` (${o.extra})` : ''}`).join('\n')}\nResponde con el número.`;
}

function proposalsText(proposed, errors = [], intro = '') {
  const parts = [];
  if (intro) parts.push(intro);
  if (errors.length) parts.push(errors.map((e) => `⚠️ ${e}`).join('\n'));
  if (proposed.length) {
    // Algo delicado (🔐): un "sí" no basta, hay que escribir "confirmo"
    const footer = proposed.some((x) => String(x).startsWith('🔐'))
      ? '🔐 Es delicado: para hacerlo escribe «confirmo» (un «sí» no basta), o «no» para cancelar.'
      : '¿Confirmas? (sí / no)';
    parts.push(`📝 Para confirmar:\n${proposed.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n${footer}`);
  }
  return parts.join('\n\n');
}

// ── Agente ────────────────────────────────────────────────────────────────────
function createStoreAgent(deps = {}) {
  const store = deps.store || storeAssistant();
  const { db, now, finish } = store.lib;
  const callModel = deps.callModel; // (params, caps) => response

  async function openQuestion(businessId) {
    const { data } = await db.from('assistant_actions').select('*').eq('business_id', businessId).eq('status', 'pending').eq('kind', 'pregunta');
    const live = (data || []).filter((a) => new Date(a.expires_at).getTime() >= now().getTime());
    return live.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
  }
  async function closeQuestions(businessId) {
    await db.from('assistant_actions').update({ status: 'cancelled' }).eq('business_id', businessId).eq('status', 'pending').eq('kind', 'pregunta');
  }
  async function saveQuestion(ctx, q) {
    await closeQuestions(ctx.businessId);
    await db.from('assistant_actions').insert({
      business_id: ctx.businessId, kind: 'pregunta', status: 'pending', summary: q.pregunta.slice(0, 500),
      plan: { ...q, request_id: ctx.requestId }, expires_at: new Date(now().getTime() + QUESTION_TTL_MS).toISOString(),
    });
  }
  async function focus(businessId) {
    const { data } = await db.from('assistant_actions').select('plan, created_at').eq('business_id', businessId).eq('kind', 'foco').order('created_at', { ascending: false }).limit(1);
    const f = (data || [])[0];
    return f && now().getTime() - new Date(f.created_at).getTime() < FOCUS_TTL_MS ? f.plan : null;
  }
  async function setFocus(ctx, f) {
    if (!f?.producto) return;
    // El foco va al modelo como texto: un "id:<uuid>" (opción elegida) se guarda con el nombre del producto
    if (/^id:/i.test(String(f.producto))) {
      const hit = matchProducts(await store.lib.loadProducts(ctx.businessId, { includeInactive: true }), f.producto)[0];
      if (!hit) return;
      f = { ...f, producto: hit.name };
    }
    await db.from('assistant_actions').insert({ business_id: ctx.businessId, kind: 'foco', status: 'cancelled', summary: `foco: ${f.producto}`, plan: { producto: f.producto, color: f.color || null, talla: f.talla || null } });
  }
  const focusLabel = (f) => (f ? [f.producto, f.color, f.talla && `talla ${String(f.talla).toUpperCase()}`].filter(Boolean).join(', ') : null);

  // Todo lo que un "sí" ejecutaría ahora (propuestas vivas de este negocio)
  async function pendingSummaries(ctx) {
    return (await store.lib.pendingActions(ctx.businessId)).filter((a) => store.lib.live(a)).map((a) => stripAsk(a.summary));
  }

  // Color y talla mencionados en el texto, entre los que tiene el producto ("negras" → Negro, "talla m" → M)
  async function variantHints(ctx, product, message) {
    const vs = await store.lib.loadVariants(ctx.businessId, [product.id]);
    const mw = words(message).map((w) => store.lib.canonColor(w));
    const text2 = ` ${mw.join(' ')} `;
    const colors = [...new Set(vs.map((v) => v.attributes && Object.entries(v.attributes).find(([k]) => norm(k) === 'color')?.[1]).filter(Boolean))];
    const color = colors.filter((c) => text2.includes(` ${store.lib.canonColor(c)} `)).sort((a, b) => b.length - a.length)[0] || null;
    const tallas = [...new Set(vs.map((v) => v.attributes && Object.entries(v.attributes).find(([k]) => norm(k) === 'talla')?.[1]).filter(Boolean))];
    const raw = ` ${norm(message).replace(/[^a-z0-9 ]/g, ' ')} `;
    // "talla m", "la m", "en S": una talla corta suelta en el texto cuenta (en español casi nunca aparece sola)
    const talla = tallas.find((t) => raw.includes(` ${store.lib.canonTalla(t)} `)) || null;
    return { color, talla };
  }

  // Pregunta numerada a partir de un "needs" de la capa de datos
  function questionFrom(needs, queue, extra = {}) {
    // Opciones con "value" (capacidades del registro: categoría, monto, movimiento, cliente…) → se guardan en needs.campo
    const opciones = (needs.opciones || []).slice(0, 12).map((o) => (o.value !== undefined
      ? { label: o.label, value: o.value, set: o.set || null, extra: o.extra || null }
      : o.producto
        // Con id: la opción elegida identifica ESE producto aunque haya otro con el mismo nombre
        ? { label: o.producto, producto: o.id ? `id:${o.id}` : o.producto, extra: o.precio ? cop(o.precio) : null }
        : { label: o.variante, color: o.color, talla: o.talla, extra: o.stock !== undefined ? `stock ${o.stock}` : null }));
    const campo = needs.needs === 'campo' ? needs.campo : (needs.campo === 'producto' || needs.needs === 'producto' ? 'producto' : needs.needs);
    return { pregunta: needs.pregunta, campo, item_index: needs.item_index ?? null, opciones, queue, ...extra };
  }

  // Intención → entradas de las herramientas de datos (todas validan y arman el resumen "hoy → quedaría")
  function toInput(a) {
    const base = { producto: a.producto, color: a.color || undefined, talla: a.talla || undefined };
    switch (a.accion) {
      case 'sumar_stock': return ['preparar_ajuste_stock', { ...base, cantidad: Math.abs(a.cantidad || 0) }];
      case 'restar_stock': return ['preparar_ajuste_stock', { ...base, cantidad: -Math.abs(a.cantidad || 0) }];
      case 'fijar_stock': return ['preparar_ajuste_stock', { ...base, stock_final: a.stock_final ?? 0 }];
      case 'crear_variante': return ['preparar_crear_variante', { ...base, stock_inicial: a.cantidad ?? a.stock_final ?? 0 }];
      case 'cambiar_precio': return ['preparar_cambio_precio', { producto: a.producto, precio: a.precio }];
      case 'activar': return ['preparar_estado', { ...base, activo: true }];
      case 'desactivar': return ['preparar_estado', { ...base, activo: false }];
      case 'pedido': return ['preparar_pedido_manual', {
        items: (a.items || []).map((i) => ({ producto: i.producto, color: i.color || undefined, talla: i.talla || undefined, cantidad: i.cantidad })),
        descuento: a.descuento ?? undefined, cliente_nombre: a.cliente || undefined, cliente_telefono: a.telefono || undefined,
        pagado: a.pagado || undefined, metodo_pago: a.metodo_pago || undefined,
      }];
      case 'estado_pedido': return ['preparar_estado_pedido', { codigo: a.codigo, estado: a.estado }];
      // El resto: capacidades del registro (Caja, pedidos, productos, sets, clientes, equipo, configuración)
      default: return store.caps().isAction(a.accion) ? [`cap:${a.accion}`, a] : [null, null];
    }
  }

  // "las licras" (todos) → una acción por producto que coincide. Un cambio de precio o costo a VARIOS productos a la vez
  // es masivo: cada propuesta lleva confirmación reforzada ("confirmo")
  async function expand(actions, ctx) {
    const out = [];
    for (const a of actions) {
      if (a.todos && a.producto && ['cambiar_precio', 'activar', 'desactivar', 'editar_producto'].includes(a.accion)) {
        const products = (await store.lib.loadProducts(ctx.businessId, { includeInactive: true })).filter((p) => !p.is_bundle);
        const hits = matchProducts(products, a.producto);
        if (hits.length > 1) {
          const masivo = a.accion === 'cambiar_precio' || (a.accion === 'editar_producto' && ['precio', 'costo'].includes(norm(a.campo || '')));
          for (const p of hits) out.push({ ...a, producto: p.name, todos: false, ...(masivo ? { masivo: true } : {}) });
          continue;
        }
      }
      out.push(a);
    }
    return out;
  }

  async function runActions(actions, ctx) {
    const errors = [];
    const list = await expand(actions, ctx);
    for (const [i, a] of list.entries()) {
      const [tool, input] = toInput(a);
      if (!tool) { errors.push('No entendí una de las acciones.'); continue; }
      const r = tool.startsWith('cap:')
        ? await store.caps().prepare(tool.slice(4), input, ctx)
        : await store.execute(tool, a.masivo ? { ...input, masivo: true } : input, ctx);
      if (r.requiere_confirmacion) {
        await setFocus(ctx, { producto: a.producto || a.items?.[0]?.producto, color: a.color || a.items?.[0]?.color, talla: a.talla || a.items?.[0]?.talla });
        continue;
      }
      if (r.needs) {
        const q = questionFrom(r, list.slice(i), { errors });
        await saveQuestion(ctx, q);
        const proposed = await store.proposedIn(ctx);
        return { text: proposalsText(proposed, errors) + (proposed.length || errors.length ? '\n\n' : '') + questionText(q) };
      }
      errors.push(r.error || 'No se pudo preparar esa acción.');
    }
    const proposed = await pendingSummaries(ctx);
    if (!proposed.length && !errors.length) return { text: 'No hay nada que cambiar con eso.' };
    return { text: proposalsText(proposed, errors) };
  }

  // Respuesta a una pregunta numerada: aplica la opción y sigue con la cola
  async function answer(q, index, ctx) {
    const opt = q.plan.opciones[index - 1];
    await finish(q.id, ctx.businessId, { status: 'cancelled', result: { respondida: index } });
    if (!opt) return { text: `Esa opción no existe: responde un número del 1 al ${q.plan.opciones.length}.` };
    const [first, ...rest] = q.plan.queue || [];
    if (q.plan.consulta) {
      const c = { ...q.plan.consulta };
      if (opt.value !== undefined && q.plan.campo) c[q.plan.campo] = opt.value;
      else { c.producto = opt.producto || c.producto; c.color = opt.color || c.color; c.talla = opt.talla || c.talla; }
      return runQuery(c, ctx);
    }
    if (!first) return { text: 'Listo, pero ya no tengo nada pendiente con eso.' };
    const a = JSON.parse(JSON.stringify(first));
    const target = q.plan.item_index !== null && q.plan.item_index !== undefined && a.items ? a.items[q.plan.item_index] : a;
    if (opt.value !== undefined && q.plan.campo) { target[q.plan.campo] = opt.value; Object.assign(target, opt.set || {}); } else if (q.plan.campo === 'producto') { target.producto = opt.producto; delete a.todos; } else { target.color = opt.color; target.talla = opt.talla; }
    return runActions([a, ...rest], ctx);
  }

  async function runQuery(c, ctx, hour) {
    const ex = (name, input) => store.execute(name, input, ctx);
    switch (c.tipo || c.consulta) {
      case 'resumen_hoy': return { text: resumenText(await ex('resumen_tienda', {}), hour) };
      case 'agotados': return { text: stockText(await ex('consultar_stock', { filtro: 'agotados' }), 'agotados') };
      case 'poco_stock': return { text: stockText(await ex('consultar_stock', { filtro: 'poco_stock' }), 'poco_stock') };
      case 'sin_pagar': return { text: unpaidText(await ex('consultar_pedidos', { pago: 'pendiente', limite: 30 })) };
      case 'mas_vendidos': return { text: topText(await ex('productos_mas_vendidos', { periodo: c.periodo === 'semana' || c.periodo === 'anio' ? c.periodo : 'mes' })) };
      case 'ventas': return { text: salesText(await ex('ventas_tienda', { periodo: c.periodo || 'hoy' }), c.periodo || 'hoy') };
      case 'stock': case 'producto_info': {
        if (!c.producto) return { text: '¿De qué producto?' };
        const products = (await store.lib.loadProducts(ctx.businessId)).filter((p) => !p.is_bundle);
        const hits = matchProducts(products, c.producto);
        if (!hits.length) return { text: `No encontré un producto que se llame "${c.producto}".` };
        if (hits.length > 1 && !c.todos) {
          const q = { pregunta: `Hay ${hits.length} productos con "${c.producto}". ¿Cuál?`, campo: 'producto', opciones: hits.slice(0, 12).map((p) => ({ label: p.name, producto: `id:${p.id}` })), queue: [], consulta: { tipo: c.tipo || c.consulta, color: c.color, talla: c.talla } };
          await saveQuestion(ctx, q);
          return { text: questionText(q) };
        }
        await setFocus(ctx, { producto: hits[0].name, color: c.color, talla: c.talla });
        if ((c.tipo || c.consulta) === 'producto_info') {
          const info = await ex('buscar_productos_tienda', { texto: hits[0].name, incluir_inactivos: true });
          const p = info.productos?.[0];
          return { text: p ? `🏷️ ${p.producto}: precio ${cop(p.precio)}${p.costo != null ? `, costo ${cop(p.costo)}, margen ${p.margen_pct}%` : ', sin costo cargado'}${p.stock_total != null ? `, stock ${p.stock_total}` : ''}${p.activo ? '' : ' (inactivo)'}.` : 'No encontré ese producto.' };
        }
        return { text: stockText(await ex('consultar_stock', { producto: hits[0].name, color: c.color, talla: c.talla }), 'todos') };
      }
      case 'pedidos': {
        const r = await ex('consultar_pedidos', { codigo: c.codigo, cliente: c.cliente || c.producto, limite: 10 });
        if (!r.pedidos?.length) return { text: 'No encontré pedidos con eso.' };
        return { text: `🧾 Pedidos:\n${r.pedidos.map((o) => `• ${o.codigo} ${o.cliente} — ${cop(o.total_neto)} · ${o.estado} · ${o.pago}${o.descuento ? ` · desc. ${cop(o.descuento)}` : ''}`).join('\n')}` };
      }
      case 'sets': {
        const r = await ex('consultar_sets', {});
        if (!r.sets?.length) return { text: 'No hay sets.' };
        return { text: `🎁 Sets:\n${r.sets.map((s) => `• ${s.set}${s.activo ? '' : ' (inactivo)'} — ${cop(s.precio)}, ${s.disponibles_total} disp.${s.margen_pct != null ? `, margen ${s.margen_pct}%` : ''}`).join('\n')}` };
      }
      case 'drops': {
        const r = await ex('catalogo_drops', {});
        if (r.success === false) return { text: r.error };
        return { text: `🌀 Colección ${r.coleccion}:\n${r.drops.map((d) => `• ${d.nombre} (${d.colores.join(', ')}): ${d.productos} productos`).join('\n')}` };
      }
      case 'envio': {
        const r = await ex('consultar_envio', { ciudad: c.ciudad });
        const t = r.tarifas;
        return { text: r.costo !== undefined ? `🚚 Envío a ${r.ciudad}: ${cop(r.costo)} (${r.zona}).` : `🚚 Envío: ${t.ciudad_local} ${cop(t.local)}, nacional ${cop(t.nacional)}${t.gratis_desde ? `, gratis desde ${cop(t.gratis_desde)}` : ''}.` };
      }
      case 'clientes': {
        const r = await ex('clientes_frecuentes', { periodo: 'trimestre' });
        if (!r.clientes?.length) return { text: 'Todavía no hay clientes con varias compras.' };
        return { text: `⭐ Clientes frecuentes:\n${r.clientes.slice(0, 8).map((x, i) => `${i + 1}. ${x.cliente} — ${plural(x.pedidos, 'pedido', 'pedidos')}, ${cop(x.total)}`).join('\n')}` };
      }
      default: {
        const tipo = c.tipo || c.consulta;
        if (!store.caps().isQuery(tipo)) return { text: 'No tengo esa consulta.' };
        const r = await store.caps().run(tipo, c, ctx);
        if (r.question) {
          const q = questionFrom(r.question, [], { consulta: { ...c, tipo } });
          await saveQuestion(ctx, q);
          return { text: questionText(q) };
        }
        return { text: r.text };
      }
    }
  }

  // Una llamada al modelo (y un reintento barato si la salida no es válida)
  async function interpret(ctx, history, usage) {
    const caps = modelCaps(ctx.model);
    const f = await focus(ctx.businessId);
    const hist = history.slice(-4).map((m) => ({ role: m.role, content: String(m.content).slice(0, 300) }));
    while (hist.length && hist[0].role !== 'user') hist.shift();
    const userContent = `${f ? `FOCO: ${focusLabel(f)}\n` : ''}<mensaje_usuario>\n${String(ctx.userMessage).slice(0, 1000)}\n</mensaje_usuario>`;
    const messages = [...hist, { role: 'user', content: userContent }];
    // Solo las capacidades del tema del mensaje, más el del último mensaje del usuario que tuvo tema (para seguir
    // la conversación: "agrega a Carlos como vendedor" → "sí" → "desactiva a carlos")
    const prevDomains = hist.filter((m) => m.role === 'user').map((m) => domainsOf(m.content)).reverse().find((d) => d.length) || [];
    const spec = interpretFor([...domainsOf(ctx.userMessage), ...prevDomains].slice(0, 3), store.caps());
    usage.domains = spec.domains;
    const params = {
      model: ctx.model,
      max_tokens: caps.thinking ? 2000 : 400,
      system: [
        { type: 'text', text: INTERPRET_PROMPT, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: spec.block, cache_control: { type: 'ephemeral' } },
      ],
      tools: [spec.tool],
      tool_choice: caps.forcedTool ? { type: 'tool', name: 'interpretar' } : { type: 'auto' },
      messages,
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await callModel(params, caps);
      const u = res.usage || {};
      usage.calls += 1;
      usage.input += u.input_tokens || 0;
      usage.output += u.output_tokens || 0;
      usage.cache_read += u.cache_read_input_tokens || 0;
      usage.cache_write += u.cache_creation_input_tokens || 0;
      const call = (res.content || []).find((b) => b.type === 'tool_use' && b.name === 'interpretar');
      const err = call ? validateIntent(call.input, spec) : 'no llamó interpretar';
      if (!err) return call.input;
      // Reintento: append-only (se devuelve lo que dijo el modelo y se le explica el error)
      params.messages = [...params.messages, { role: 'assistant', content: res.content },
        call
          ? { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: `Inválido: ${err}. Corrige y llama interpretar de nuevo.` }] }
          : { role: 'user', content: 'Responde SOLO llamando la herramienta interpretar.' }];
    }
    return null;
  }

  async function handle({ businessId, business, userMessage, history, authorization, model }) {
    const usage = { model, calls: 0, input: 0, output: 0, cache_read: 0, cache_write: 0 };
    const ctx = { businessId, business: { ...business, id: businessId }, authorization, requestId: crypto.randomUUID(), userMessage: String(userMessage || ''), model };
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', hour: '2-digit', hourCycle: 'h23' }).format(now()));
    const q = await openQuestion(businessId);
    const pending = (await store.lib.pendingActions(businessId)).filter((a) => store.lib.live(a));
    const route = classify(userMessage, { pregunta: q, hayPropuestas: pending.length > 0 });
    let out; let path = route.type;

    // Lo que no es respuesta a la pregunta abierta la descarta; lo que no es sí/no descarta las propuestas
    if (q && route.type !== 'answer') await closeQuestions(businessId);
    if (!['yes', 'no', 'answer'].includes(route.type)) await store.discardUnanswered(ctx);

    if (route.type === 'answer') out = await answer(q, route.index, ctx);
    else if (route.type === 'greeting') out = { text: greetingText(business, hour) };
    else if (route.type === 'yes') {
      const r = await store.execute('confirmar_accion', {}, ctx);
      out = r.success
        ? { text: `✅ Hecho:\n${r.resultados.map((x) => `${x.n}. ${x.ok ? x.resultado : `${x.accion} → ${x.error}`}`).join('\n')}`, wrote: true }
        : { text: r.needs_confirmo ? `🔐 ${r.error}` : `⚠️ ${r.error}` };
    } else if (route.type === 'no') {
      const r = await store.execute('cancelar_accion', {}, ctx);
      out = { text: r.success ? `👌 ${r.resultado}` : 'No había nada pendiente. ¿Qué necesitas?' };
    } else if (route.type === 'undo') {
      const r = await store.execute('preparar_deshacer', {}, ctx);
      out = { text: r.requiere_confirmacion ? `↩️ Para dejarlo como estaba:\n${r.resumen.replace(/\n¿Confirmas\?$/, '')}\n¿Confirmas? (sí / no)` : `⚠️ ${r.error}` };
    } else if (route.type === 'query') {
      if (route.consulta === 'stock') {
        // "stock de X": el servidor busca el producto en el texto; si no lo encuentra, el modelo lo interpreta
        const products = (await store.lib.loadProducts(businessId)).filter((p) => !p.is_bundle);
        const mw = words(userMessage);
        const hits = products.filter((p) => { const nw = words(p.name); return nw.length && nw.every((w) => mw.includes(w)); });
        if (hits.length) {
          const longest = Math.max(...hits.map((p) => words(p.name).length));
          const best = hits.filter((p) => words(p.name).length === longest);
          if (best.length === 1) {
            const { color, talla } = await variantHints(ctx, best[0], userMessage);
            out = await runQuery({ tipo: 'stock', producto: best[0].name, color, talla }, ctx, hour);
          }
        }
      } else out = await runQuery({ tipo: route.consulta, periodo: route.periodo }, ctx, hour);
      if (!out) path = 'model';
    }

    if (!out) {
      path = 'model';
      const intent = await interpret(ctx, history || [], usage);
      if (!intent) out = { text: 'No te entendí bien 🙈. ¿Me lo dices de otra forma? Por ejemplo: «llegaron 3 Short Nila negro M» o «¿qué se agotó?».' };
      else if (intent.tipo === 'acciones') out = await runActions(intent.acciones, ctx);
      else if (intent.tipo === 'consulta') out = await runQuery(intent.consulta, ctx, hour);
      else if (intent.tipo === 'no_entendi') out = { text: 'No te entendí bien 🙈. ¿Me lo dices de otra forma?' };
      else {
        // Fuera de alcance: el texto lo pone el servidor (dónde se hace en el panel); el modelo solo eligió el tema
        const fixed = intent.tipo === 'no_puedo' ? store.caps().outOfScope(intent.tema, intent.donde) : null;
        const t = String(intent.respuesta || '').trim();
        // El modelo nunca afirma cambios: si su texto lo hace, se descarta
        out = { text: fixed || (t && !claimsWrite(t) ? t : 'Eso no lo puedo hacer desde aquí; se hace en el panel.') };
      }
    }
    return { response: out.text, path, usage: { ...usage, cost_usd: costOf(model, usage) } };
  }

  return { handle, classify, validateIntent, modelCaps };
}

module.exports = { createStoreAgent, classify, validateIntent, modelCaps, costOf, matchOption, pickIndex, domainsOf, interpretFor, HAIKU, INTERPRET_PROMPT, INTERPRET_TOOL };
