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
const WRITE_HINT = /\b(llegaron|llego|entraron|suma\w*|agrega\w*|anade\w*|quita\w*|resta\w*|descuenta\w*|vendi|vendimos|vendieron|registra\w*|sube\w*|baja\w*|cambia\w*|pon|ponle|ponlo|ponla|poner|activa\w*|desactiva\w*|crea\w*|cancela\w*|marca\w*|despacha\w*|hazme|haz)\b/;
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
  if (isNegative(m)) return { type: 'no' };
  if (isAffirmative(m)) return { type: 'yes' };
  if (isUndoIntent(m)) return { type: 'undo' };
  if (!WRITE_HINT.test(m)) {
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
10. tipo "no_puedo" si pide algo que el asistente no hace (borrar productos, fotos, pagos, otra cosa): respuesta corta diciendo que se hace en el panel.
11. tipo "charla" para saludo o comentario sin datos; "no_entendi" si no se entiende.

EJEMPLOS (mensaje → interpretar):
- "¿cuántas licra aria negras hay?" → {"tipo":"consulta","consulta":{"tipo":"stock","producto":"licra aria","color":"negras"}}
- "llegaron 3 top jana" → {"tipo":"acciones","acciones":[{"accion":"sumar_stock","producto":"top jana","cantidad":3}]}
- "súmale 1 al negro M y 2 al azul S de short liva" → {"tipo":"acciones","acciones":[{"accion":"sumar_stock","producto":"short liva","color":"negro","talla":"M","cantidad":1},{"accion":"sumar_stock","producto":"short liva","color":"azul","talla":"S","cantidad":2}]}
- "agrégale 2 variantes, azul S y negro M a camiseta elite" → {"tipo":"acciones","acciones":[{"accion":"crear_variante","producto":"camiseta elite","color":"azul","talla":"S"},{"accion":"crear_variante","producto":"camiseta elite","color":"negro","talla":"M"}]}
- (FOCO: Short Nila, Vino tinto talla M) "llegaron 3 de esas" → {"tipo":"acciones","acciones":[{"accion":"sumar_stock","producto":"Short Nila","color":"Vino tinto","talla":"M","cantidad":3}]}
- "pon agotado el short nila vino tinto" → {"tipo":"acciones","acciones":[{"accion":"fijar_stock","producto":"short nila","color":"vino tinto","stock_final":0}]}
- "sube el precio de las licras a 129900" → {"tipo":"acciones","acciones":[{"accion":"cambiar_precio","producto":"licras","precio":129900,"todos":true}]}
- "hazme un pedido de 2 tops jana verdes con 10 mil de descuento" → {"tipo":"acciones","acciones":[{"accion":"pedido","items":[{"producto":"top jana","color":"verde","cantidad":2}],"descuento":10000}]}
- "borra la falda vela" → {"tipo":"no_puedo","respuesta":"Borrar productos no lo hago yo: se hace en el panel, en Productos. Si quieres, la desactivo para que no se vea en la tienda."}`;

function validateIntent(x) {
  if (!x || typeof x !== 'object') return 'no es un objeto';
  if (!TIPOS.includes(x.tipo)) return 'tipo inválido';
  const s = (v, max = 120) => v === undefined || v === null || (typeof v === 'string' && v.length <= max);
  const n = (v) => v === undefined || v === null || (Number.isInteger(v) && v >= -100000 && v <= 100000000);
  if (x.tipo === 'acciones') {
    if (!Array.isArray(x.acciones) || !x.acciones.length || x.acciones.length > 10) return 'acciones vacías o demasiadas';
    for (const a of x.acciones) {
      if (!a || !ACCIONES.includes(a.accion)) return 'acción inválida';
      if (![a.producto, a.color, a.talla, a.codigo, a.cliente, a.telefono].every((v) => s(v))) return 'texto inválido';
      if (![a.cantidad, a.stock_final, a.precio, a.descuento].every(n)) return 'número inválido';
      if (a.accion === 'pedido' && (!Array.isArray(a.items) || !a.items.length || a.items.length > 20 || !a.items.every((i) => i && s(i.producto) && i.producto && n(i.cantidad)))) return 'pedido sin ítems válidos';
      if (a.accion !== 'pedido' && a.accion !== 'estado_pedido' && !a.producto) return 'falta el producto';
    }
  }
  if (x.tipo === 'consulta' && (!x.consulta || !CONSULTAS.includes(x.consulta.tipo))) return 'consulta inválida';
  if ((x.tipo === 'charla' || x.tipo === 'no_puedo') && !s(x.respuesta, 600)) return 'respuesta inválida';
  return null;
}

// ── Plantillas ────────────────────────────────────────────────────────────────
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
function greetingText(biz, hour) {
  const h = hour >= 5 && hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  return `${h} 👋 Soy el asistente de ${biz.name}. Pregúntame cómo van las ventas, qué se agotó o el stock de una prenda, o pídeme sumar stock, cambiar un precio o registrar un pedido.`;
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
  if (proposed.length) parts.push(`📝 Para confirmar:\n${proposed.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n¿Confirmas? (sí / no)`);
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
    const opciones = (needs.opciones || []).slice(0, 12).map((o) => (o.producto
      ? { label: o.producto, producto: o.producto, extra: o.precio ? cop(o.precio) : null }
      : { label: o.variante, color: o.color, talla: o.talla, extra: o.stock !== undefined ? `stock ${o.stock}` : null }));
    return { pregunta: needs.pregunta, campo: needs.needs, item_index: needs.item_index ?? null, opciones, queue, ...extra };
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
      default: return [null, null];
    }
  }

  // "las licras" (todos) → una acción por producto que coincide
  async function expand(actions, ctx) {
    const out = [];
    for (const a of actions) {
      if (a.todos && a.producto && ['cambiar_precio', 'activar', 'desactivar'].includes(a.accion)) {
        const products = (await store.lib.loadProducts(ctx.businessId, { includeInactive: true })).filter((p) => !p.is_bundle);
        const hits = matchProducts(products, a.producto);
        if (hits.length > 1) { for (const p of hits) out.push({ ...a, producto: p.name, todos: false }); continue; }
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
      const r = await store.execute(tool, input, ctx);
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
    if (q.plan.consulta) return runQuery({ ...q.plan.consulta, producto: opt.producto || q.plan.consulta.producto, color: opt.color || q.plan.consulta.color, talla: opt.talla || q.plan.consulta.talla }, ctx);
    if (!first) return { text: 'Listo, pero ya no tengo nada pendiente con eso.' };
    const a = JSON.parse(JSON.stringify(first));
    const target = q.plan.item_index !== null && q.plan.item_index !== undefined && a.items ? a.items[q.plan.item_index] : a;
    if (q.plan.campo === 'producto') { target.producto = opt.producto; delete a.todos; } else { target.color = opt.color; target.talla = opt.talla; }
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
          const q = { pregunta: `Hay ${hits.length} productos con "${c.producto}". ¿Cuál?`, campo: 'producto', opciones: hits.slice(0, 12).map((p) => ({ label: p.name, producto: p.name })), queue: [], consulta: { tipo: c.tipo || c.consulta, color: c.color, talla: c.talla } };
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
      default: return { text: 'No tengo esa consulta.' };
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
    const params = {
      model: ctx.model,
      max_tokens: caps.thinking ? 2000 : 400,
      system: [{ type: 'text', text: INTERPRET_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [INTERPRET_TOOL],
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
      const err = call ? validateIntent(call.input) : 'no llamó interpretar';
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
        : { text: `⚠️ ${r.error}` };
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
        const t = String(intent.respuesta || '').trim();
        // El modelo nunca afirma cambios: si su texto lo hace, se descarta
        out = { text: t && !claimsWrite(t) ? t : 'Eso no lo puedo hacer desde aquí; se hace en el panel.' };
      }
    }
    return { response: out.text, path, usage: { ...usage, cost_usd: costOf(model, usage) } };
  }

  return { handle, classify, validateIntent, modelCaps };
}

module.exports = { createStoreAgent, classify, validateIntent, modelCaps, costOf, matchOption, pickIndex, HAIKU, INTERPRET_PROMPT, INTERPRET_TOOL };
