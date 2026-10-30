// Registro de capacidades del asistente de TIENDA: cada acción o consulta del panel se declara UNA vez.
// Por capacidad: dominio (para darle al modelo solo lo relevante), riesgo (N = confirmación normal con "sí",
// R = reforzada: repite antes → después y exige escribir "confirmo", L = solo lectura), permiso del plan,
// campos con validación, preparación (resuelve entidades en el servidor y arma el texto de confirmación),
// ejecución con el controlador del panel (token del usuario), lectura de verificación y deshacer.
// El modelo nunca escribe: solo devuelve la intención estructurada. business_id siempre de la sesión (ctx).

const { PLANS } = require('../config/plans');
const { INCOME_CATEGORIES, EXPENSE_CATEGORIES } = require('../utils/cashCategories');
const { snapshotCost } = require('../utils/bundles');

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const PAYMENT_STATUSES = ['pendiente', 'pagado', 'fallido', 'reembolsado'];
const PAYMENT_METHODS = ['efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'wompi', 'otro'];
const GENDERS = ['mujer', 'hombre', 'unisex'];
const MODULES = ['clientes', 'empleados', 'productos', 'pedidos', 'caja', 'analiticas', 'citas', 'servicios'];
const RECALL_COOLDOWN_DAYS = 7;
const RECALL_MAX_PER_DAY = 10;
const LOCKED_DISCOUNT = ['cancelado', 'entregado'];

const INCOME_LABEL = { productos: 'Productos (ventas)', servicios: 'Servicios', otro: 'Otro' };
const EXPENSE_LABEL = { materias_primas: 'Materias primas (insumos, empaques, bolsas)', servicios: 'Servicios (luz, internet, envíos, publicidad)', arriendo: 'Arriendo', nomina: 'Nómina', otro: 'Otro' };
// Palabras claras → categoría; si no hay coincidencia el servidor pregunta con opciones numeradas
const EXPENSE_HINTS = [
  [/\b(bolsa|empaque|etiqueta|marquilla|tela|insumo|material|hilo|mercancia|cinta|sticker|caja de carton|cajas)\w*/, 'materias_primas'],
  [/\b(arriendo|alquiler|local)\b/, 'arriendo'],
  [/\b(nomina|sueldo|salario|quincena|prima)\w*/, 'nomina'],
  [/\b(luz|agua|internet|celular|gas|envio|envios|domicilio|domicilios|mensajeria|transporte|servientrega|interrapidisimo|coordinadora|contador|publicidad|pauta|ads|instagram|facebook|hosting|dominio|software)\b/, 'servicios'],
];
const INCOME_HINTS = [
  [/\b(venta|ventas|vendi|vendimos|ropa|producto|productos|pedido|pedidos|prenda)\b/, 'productos'],
  [/\b(servicio|servicios|asesoria|arreglo|confeccion)\b/, 'servicios'],
];
const CATEGORY_WORDS = {
  ingreso: { productos: 'productos', producto: 'productos', ventas: 'productos', venta: 'productos', servicios: 'servicios', servicio: 'servicios', otro: 'otro', otros: 'otro' },
  egreso: {
    materias_primas: 'materias_primas', 'materias primas': 'materias_primas', 'materia prima': 'materias_primas', insumos: 'materias_primas',
    servicios: 'servicios', servicio: 'servicios', arriendo: 'arriendo', nomina: 'nomina', otro: 'otro', otros: 'otro',
  },
};

function createCapabilities(lib) {
  const { db, now, ctl, call, text, norm, dayISO, orderCode, savePending } = lib;
  // Pesos con el signo antes del símbolo: -$13.406 (no $-13.406)
  const cop = (n) => (Number(n) < 0 ? `-${lib.cop(-Number(n))}` : lib.cop(n));

  // ── Utilidades ──────────────────────────────────────────────────────────────
  const today = () => dayISO(now());
  const daysAgo = (n) => dayISO(new Date(now().getTime() - n * 86400000));
  const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  const dateLabel = (d) => (d === today() ? 'hoy' : d === daysAgo(1) ? 'ayer' : `${Number(d.slice(8, 10))} de ${MONTHS[Number(d.slice(5, 7)) - 1]}`);
  const int = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  const isPosInt = (v, max = 1e9) => Number.isInteger(v) && v > 0 && v <= max;
  const R = (s) => `🔐 ${s}`;
  const planOf = (ctx) => ctx.business?.plan || 'estandar';
  const hasFeature = (ctx, f) => !f || (PLANS[planOf(ctx)]?.features || []).includes(f);

  // "hoy" | "ayer" | "antier" | YYYY-MM-DD | DD/MM → fecha (no futura, máximo un año atrás) o null
  function parseFecha(v) {
    const s = norm(v || 'hoy');
    let d = null;
    if (!s || s === 'hoy') d = today();
    else if (s === 'ayer') d = daysAgo(1);
    else if (s === 'antier' || s === 'anteayer') d = daysAgo(2);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = s;
    else {
      const m = s.match(/^(\d{1,2})[/-](\d{1,2})$/);
      if (m) d = `${today().slice(0, 4)}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    if (!d || Number.isNaN(new Date(`${d}T12:00:00-05:00`).getTime())) return null;
    if (d > today() || d < daysAgo(366)) return null;
    return d;
  }

  async function ok(fn, input, ctx) {
    const r = await call(fn, input, ctx);
    if (r.code >= 400) return { error: r.body?.error || 'el panel rechazó el cambio.' };
    return { data: r.body?.data ?? r.body, body: r.body };
  }

  // Resumen de Caja del mes (MISMO controlador y cálculo que la pantalla de Caja)
  async function cashMonth(ctx, ym) {
    const r = await ok(ctl.cash.getSummary, { query: { month: ym } }, ctx);
    if (r.error) return { neto: null };
    const d = r.data || {};
    return { neto: d.net ?? d.ingresos ?? 0, d };
  }

  // Pregunta numerada (el agente la guarda y aplica la opción al campo indicado)
  const ask = (campo, pregunta, opciones) => ({ needs: 'campo', campo, pregunta, opciones });

  // ── Caja ────────────────────────────────────────────────────────────────────
  function resolveCategory(tipo, a) {
    const words = CATEGORY_WORDS[tipo];
    const given = norm(a.categoria || '').replace(/_/g, ' ');
    if (given && words[given]) return words[given];
    if (given && words[given.replace(/ /g, '_')]) return words[given.replace(/ /g, '_')];
    const hay = ` ${norm([a.categoria, a.descripcion].filter(Boolean).join(' '))} `;
    for (const [re, cat] of tipo === 'egreso' ? EXPENSE_HINTS : INCOME_HINTS) if (re.test(hay)) return cat;
    return null;
  }

  function movementDescription(a) {
    const desc = text(a.descripcion, 160) || (a.categoria && !CATEGORY_WORDS.ingreso[norm(a.categoria)] && !CATEGORY_WORDS.egreso[norm(a.categoria)] ? text(a.categoria, 80) : '');
    const metodo = text(a.metodo, 30);
    return [desc, metodo && `pago: ${metodo}`].filter(Boolean).join(' · ').slice(0, 200) || null;
  }

  function prepareMovement(tipo) {
    return async (a, ctx) => {
      if (tipo === 'egreso' && planOf(ctx) === 'lite') return { success: false, error: 'Tu plan Lite no incluye egresos en Caja. Con el plan Estándar puedes registrarlos.' };
      const monto = int(a.monto);
      if (!isPosInt(monto, 1e10)) return { success: false, error: `Dime el monto del ${tipo}, por ejemplo «${tipo === 'egreso' ? 'gasté 50 mil en bolsas' : 'entraron 200 mil en efectivo'}».` };
      // "entraron 200": casi siempre son miles, pero no se adivina
      if (monto < 1000 && !a.monto_confirmado) {
        return ask('monto', `¿El ${tipo} fue de ${cop(monto * 1000)} o de ${cop(monto)}?`, [
          { label: cop(monto * 1000), value: monto * 1000, set: { monto_confirmado: true } },
          { label: cop(monto), value: monto, set: { monto_confirmado: true } },
        ]);
      }
      const date = parseFecha(a.fecha);
      if (!date) return { success: false, error: 'La fecha no es válida (ni futura ni de hace más de un año). Usa «hoy», «ayer» o día/mes.' };
      const category = resolveCategory(tipo, a);
      if (!category) {
        // Lo más común primero: en una tienda un ingreso casi siempre es venta de productos
        const cats = tipo === 'egreso' ? EXPENSE_CATEGORIES : ['productos', ...INCOME_CATEGORIES.filter((c) => c !== 'productos')];
        const labels = tipo === 'egreso' ? EXPENSE_LABEL : INCOME_LABEL;
        return ask('categoria', `¿En qué categoría de Caja va ${a.descripcion ? `«${text(a.descripcion, 40)}»` : `este ${tipo}`}?`, cats.map((c) => ({ label: labels[c], value: c })));
      }
      const description = movementDescription(a);
      const body = { amount: monto, category, description, date };
      if (tipo === 'ingreso' && category === 'otro') body.custom_category = text(a.descripcion || a.categoria, 40) || null;
      const ym = date.slice(0, 7);
      const { neto } = await cashMonth(ctx, ym);
      const label = (tipo === 'egreso' ? EXPENSE_LABEL : INCOME_LABEL)[category].replace(/ \(.*\)$/, '');
      const after = neto === null ? null : neto + (tipo === 'egreso' ? -monto : monto);
      const summary = `Registrar ${tipo} de ${cop(monto)} · ${label}${description ? ` · «${description}»` : ''} · ${dateLabel(date)}.`
        + `${neto === null ? '' : ` Neto de ${monthLabel(ym)}: ${cop(neto)} → ${cop(after)}.`} ¿Confirmas?`;
      return savePending(ctx, `registrar_${tipo}`, summary, { tipo, body, mes: ym, label: `${tipo} ${cop(monto)} (${label})` });
    };
  }

  async function readMovement(ctx, tipo, id) {
    const table = tipo === 'egreso' ? 'expenses' : 'income';
    const { data } = await db.from(table).select('*').eq('business_id', ctx.businessId).eq('id', id).maybeSingle();
    return data || null;
  }

  function executeMovement(tipo) {
    return async (p, action, ctx) => {
      const { neto: before } = await cashMonth(ctx, p.mes);
      const r = await ok(tipo === 'egreso' ? ctl.cash.createExpense : ctl.cash.createIncome, { body: p.body }, ctx);
      if (r.error) return { ok: false, error: r.error };
      const row = r.data?.id ? await readMovement(ctx, tipo, r.data.id) : null;
      if (!row) return { ok: false, error: `el ${tipo} no quedó guardado.` };
      const { neto: after } = await cashMonth(ctx, p.mes);
      return {
        ok: Number(row.amount) === Number(p.body.amount),
        result: { movimiento_id: row.id, tipo, neto_antes: before, neto_despues: after },
        message: `${tipo} de ${cop(row.amount)} registrado${before !== null ? ` · neto de ${monthLabel(p.mes)} ${cop(before)} → ${cop(after)}` : ''}`,
        error: `el ${tipo} no quedó como se esperaba.`,
      };
    };
  }

  const inverseCreateMovement = async (action) => {
    const id = action.result?.movimiento_id;
    if (!id) return { error: 'No encontré el movimiento registrado.' };
    const p = action.plan;
    return { summary: `Deshacer: borrar el ${p.tipo} de ${cop(p.body.amount)} (${p.label}).`, plan: { kind: 'anular_movimiento', tipo: p.tipo, id, mes: p.mes, label: p.label } };
  };

  // Movimiento manual a editar o anular: por id (respuesta a una pregunta), texto, monto o fecha
  async function findMovement(a, ctx) {
    if (a.id_movimiento) {
      const [tipo, id] = String(a.id_movimiento).split(':');
      const row = await readMovement(ctx, tipo, id);
      return row ? { tipo, row } : { error: 'Ese movimiento ya no existe.' };
    }
    const tipos = a.tipo_mov === 'ingreso' || a.tipo_mov === 'egreso' ? [a.tipo_mov] : ['egreso', 'ingreso'];
    const since = daysAgo(90);
    const rows = [];
    for (const tipo of tipos) {
      const table = tipo === 'egreso' ? 'expenses' : 'income';
      const { data, error } = await db.from(table).select('*').eq('business_id', ctx.businessId).gte('date', since).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      for (const r of data || []) rows.push({ tipo, row: r });
    }
    const monto = int(a.monto);
    const date = a.fecha ? parseFecha(a.fecha) : null;
    const q = norm(a.buscar || '').replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length >= 3 && !['ultimo', 'ultima', 'egreso', 'ingreso', 'gasto', 'movimiento', 'registro'].includes(w));
    const hits = rows.filter(({ row }) => (!monto || Number(row.amount) === monto) && (!date || row.date === date)
      && q.every((w) => norm(`${row.description || ''} ${row.custom_category || ''} ${row.category}`).includes(w)));
    if (!hits.length) return { error: 'No encontré ese movimiento en los últimos 90 días. Dime el monto o la descripción.' };
    // Solo manuales (no de pedidos, ventas rápidas ni costos automáticos), del más reciente al más antiguo
    const manual = hits.filter(({ tipo, row }) => !row.order_id && (tipo === 'egreso' ? row.category !== 'costo_producto' : (row.source || 'manual') === 'manual'))
      .sort((x, y) => String(y.row.created_at).localeCompare(String(x.row.created_at)));
    if (!manual.length) {
      const o = hits[0].row;
      return { error: o.order_id ? `Ese movimiento viene del pedido ${orderCode(o.order_id)}: se cambia desde el pedido (su pago o su estado), no desde Caja.` : 'Ese movimiento lo creó el sistema (venta rápida o costo automático): se corrige desde la venta, no desde Caja.' };
    }
    if (manual.length === 1 || /\bultim/.test(norm(a.buscar || ''))) return manual[0];
    return ask('id_movimiento', '¿Cuál movimiento?', manual.slice(0, 8).map(({ tipo, row }) => ({
      label: `${tipo === 'egreso' ? 'Egreso' : 'Ingreso'} ${cop(row.amount)} · ${row.description || row.custom_category || row.category} · ${dateLabel(row.date)}`, value: `${tipo}:${row.id}`,
    })));
  }

  const movLabel = (tipo, row) => `${tipo} de ${cop(row.amount)} «${row.description || row.custom_category || row.category}» del ${dateLabel(row.date)}`;

  async function prepareEditMovement(a, ctx) {
    const f = await findMovement(a, ctx);
    if (f.needs || f.error) return f.needs ? f : { success: false, error: f.error };
    const { tipo, row } = f;
    const after = {};
    const nm = int(a.nuevo_monto);
    if (nm !== null) { if (!isPosInt(nm, 1e10)) return { success: false, error: 'El nuevo monto debe ser mayor que 0.' }; after.amount = nm; }
    if (a.nueva_categoria) {
      const c = resolveCategory(tipo, { categoria: a.nueva_categoria });
      if (!c) return { success: false, error: `Categorías de ${tipo}: ${(tipo === 'egreso' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).join(', ')}.` };
      after.category = c;
    }
    if (a.nueva_descripcion) after.description = text(a.nueva_descripcion, 200);
    if (a.nueva_fecha) { const d = parseFecha(a.nueva_fecha); if (!d) return { success: false, error: 'La nueva fecha no es válida.' }; after.date = d; }
    const keys = Object.keys(after).filter((k) => String(after[k]) !== String(row[k]));
    if (!keys.length) return { success: false, error: '¿Qué quieres cambiarle (monto, categoría, descripción o fecha)?' };
    const before = Object.fromEntries(keys.map((k) => [k, row[k]]));
    const ym = (after.date || row.date).slice(0, 7);
    const { neto } = await cashMonth(ctx, ym);
    const delta = after.amount !== undefined ? (after.amount - Number(row.amount)) * (tipo === 'egreso' ? -1 : 1) : 0;
    const NAMES = { amount: 'monto', category: 'categoría', description: 'descripción', date: 'fecha' };
    const show = (k, v) => (k === 'amount' ? cop(v) : k === 'date' ? dateLabel(v) : `«${v || '—'}»`);
    const summary = R(`Editar el ${movLabel(tipo, row)}: ${keys.map((k) => `${NAMES[k]} ${show(k, before[k])} → ${show(k, after[k])}`).join(', ')}.${neto !== null && delta ? ` Neto de ${monthLabel(ym)}: ${cop(neto)} → ${cop(neto + delta)}.` : ''} ¿Confirmas?`);
    return savePending(ctx, 'editar_movimiento', summary, { risk: 'R', tipo, id: row.id, before, after: Object.fromEntries(keys.map((k) => [k, after[k]])), mes: ym, label: movLabel(tipo, row) });
  }

  async function executeEditMovement(p, action, ctx) {
    const row = await readMovement(ctx, p.tipo, p.id);
    if (!row) return { ok: false, error: 'el movimiento ya no existe.' };
    if (row.order_id) return { ok: false, error: 'ese movimiento ahora es de un pedido.' };
    const r = await ok(p.tipo === 'egreso' ? ctl.cash.updateExpense : ctl.cash.updateIncome, { params: { id: p.id }, body: p.after }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const fresh = await readMovement(ctx, p.tipo, p.id);
    const same = fresh && Object.entries(p.after).every(([k, v]) => String(fresh[k]) === String(v));
    return { ok: !!same, result: { antes: p.before, despues_leido: fresh && Object.fromEntries(Object.keys(p.after).map((k) => [k, fresh[k]])) }, message: `${p.tipo} actualizado (${Object.keys(p.after).join(', ')})`, error: 'el movimiento no quedó como se esperaba.' };
  }

  async function prepareDeleteMovement(a, ctx) {
    const f = await findMovement(a, ctx);
    if (f.needs || f.error) return f.needs ? f : { success: false, error: f.error };
    const { tipo, row } = f;
    const { neto } = await cashMonth(ctx, row.date.slice(0, 7));
    const delta = Number(row.amount) * (tipo === 'egreso' ? 1 : -1);
    const summary = R(`Anular (borrar) el ${movLabel(tipo, row)}.${neto !== null ? ` Neto de ${monthLabel(row.date.slice(0, 7))}: ${cop(neto)} → ${cop(neto + delta)}.` : ''} Puedo deshacerlo después. ¿Confirmas?`);
    return savePending(ctx, 'anular_movimiento', summary, { risk: 'R', tipo, id: row.id, mes: row.date.slice(0, 7), label: movLabel(tipo, row) });
  }

  async function executeDeleteMovement(p, action, ctx) {
    const row = await readMovement(ctx, p.tipo, p.id);
    if (!row) return { ok: false, error: 'el movimiento ya no existe.' };
    if (row.order_id) return { ok: false, error: 'ese movimiento es de un pedido: se cambia desde el pedido.' };
    const r = await ok(p.tipo === 'egreso' ? ctl.cash.deleteExpense : ctl.cash.deleteIncome, { params: { id: p.id } }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const gone = !(await readMovement(ctx, p.tipo, p.id));
    const copia = { amount: Number(row.amount), category: row.category, description: row.description, date: row.date, ...(p.tipo === 'ingreso' ? { custom_category: row.custom_category, client_id: row.client_id } : {}) };
    return { ok: gone, result: { copia, tipo: p.tipo }, message: `${p.label}: borrado`, error: 'el movimiento sigue ahí.' };
  }

  const inverseDeleteMovement = async (action) => {
    const c = action.result?.copia;
    if (!c) return { error: 'No guardé la copia de ese movimiento.' };
    const tipo = action.result.tipo || action.plan.tipo;
    return { summary: `Deshacer: volver a registrar el ${tipo} de ${cop(c.amount)} «${c.description || c.category}» del ${dateLabel(c.date)}.`, plan: { kind: `registrar_${tipo}`, tipo, body: c, mes: c.date.slice(0, 7), label: `${tipo} ${cop(c.amount)}` } };
  };

  const inverseEditMovement = async (action) => {
    const p = action.plan;
    const row = await readMovement({ businessId: action.business_id }, p.tipo, p.id);
    if (!row) return { error: 'Ese movimiento ya no existe.' };
    return { summary: `Deshacer: dejar el ${p.tipo} como estaba (${Object.keys(p.before).join(', ')}).`, plan: { kind: 'editar_movimiento', tipo: p.tipo, id: p.id, before: p.after, after: p.before, mes: p.mes, label: p.label } };
  };

  // Consultas de Caja
  function cashPeriodQuery(periodo) {
    const t = today();
    if (periodo === 'ayer') return { query: { period: 'day', date: daysAgo(1) }, label: 'ayer' };
    if (periodo === 'semana') return { query: { period: 'week' }, label: 'esta semana' };
    if (periodo === 'mes') return { query: { month: t.slice(0, 7) }, label: `en ${monthLabel(t.slice(0, 7))}` };
    if (periodo === 'mes_pasado') {
      const d = new Date(`${t.slice(0, 7)}-15T12:00:00-05:00`); d.setMonth(d.getMonth() - 1);
      const ym = dayISO(d).slice(0, 7);
      return { query: { month: ym }, label: `en ${monthLabel(ym)}` };
    }
    return { query: { period: 'day', date: t }, label: 'hoy' };
  }

  async function runCashSummary(c, ctx) {
    const { query, label } = cashPeriodQuery(c.periodo || 'hoy');
    const r = await ok(ctl.cash.getSummary, { query }, ctx);
    if (r.error) return { text: `⚠️ ${r.error}` };
    const d = r.data || {};
    const note = 'Ojo: es el neto del período (ingresos − egresos), no un saldo ni un arqueo de caja.';
    if (d.income_total === undefined) return { text: `💰 Caja ${label}: ingresos ${cop(d.ingresos)}. ${note}` };
    return {
      text: `💰 Caja ${label}: ingresos ${cop(d.income_total)} · egresos ${cop(d.expense_total)} (costo de ventas ${cop(d.costo_ventas)}, operativos ${cop(d.egresos_operativos)}) → neto ${cop(d.net)}${d.income_total ? ` · margen ${d.margen_porcentaje}%` : ''}.\n${note}`,
    };
  }

  async function runCashMovements(c, ctx) {
    const tipo = c.tipo_mov === 'ingreso' ? 'ingreso' : 'egreso';
    if (tipo === 'egreso' && planOf(ctx) === 'lite') return { text: 'Tu plan Lite no incluye egresos en Caja.' };
    const { query, label } = cashPeriodQuery(c.periodo || 'mes');
    const r = await ok(tipo === 'egreso' ? ctl.cash.getExpenses : ctl.cash.getIncome, { query }, ctx);
    if (r.error) return { text: `⚠️ ${r.error}` };
    let rows = Array.isArray(r.data) ? r.data : [];
    const cat = c.categoria ? resolveCategory(tipo, { categoria: c.categoria }) : null;
    const words = norm(c.texto || (cat ? '' : c.categoria) || '').replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length >= 3);
    if (cat) rows = rows.filter((x) => x.category === cat);
    if (words.length) rows = rows.filter((x) => words.every((w) => norm(`${x.description || ''} ${x.custom_category || ''} ${x.category}`).includes(w.replace(/s$/, ''))));
    const total = rows.reduce((s, x) => s + Number(x.amount), 0);
    const what = cat ? ` en ${(tipo === 'egreso' ? EXPENSE_LABEL : INCOME_LABEL)[cat].replace(/ \(.*\)$/, '')}` : words.length ? ` en «${words.join(' ')}»` : '';
    if (!rows.length) return { text: `No encontré ${tipo}s${what} ${label}.` };
    return { text: `${tipo === 'egreso' ? '💸 Gastaste' : '💵 Entraron'} ${cop(total)}${what} ${label} (${rows.length} movimiento${rows.length === 1 ? '' : 's'}):\n${rows.slice(0, 8).map((x) => `• ${dateLabel(x.date)} — ${cop(x.amount)} · ${x.description || x.custom_category || x.category}`).join('\n')}${rows.length > 8 ? `\n… y ${rows.length - 8} más` : ''}` };
  }

  async function prepareGoal(a, ctx) {
    const monto = int(a.monto);
    if (!isPosInt(monto, 1e11)) return { success: false, error: 'Dime la meta de ingresos del mes en pesos, por ejemplo «pon la meta en 5 millones».' };
    const r = await ok(ctl.settings.getGoal, {}, ctx);
    const before = r.data?.income_goal != null ? Number(r.data.income_goal) : null;
    if (before === monto) return { success: false, error: `La meta del mes ya es ${cop(monto)}.` };
    const ym = today().slice(0, 7);
    return savePending(ctx, 'meta_mensual', `Meta de ingresos de ${monthLabel(ym)}: ${before === null ? 'sin meta' : cop(before)} → ${cop(monto)}. ¿Confirmas?`, { mes: ym, before, after: monto, label: `meta ${monthLabel(ym)}` });
  }
  async function executeGoal(p, action, ctx) {
    const r = await ok(ctl.settings.updateGoal, { body: { month: `${p.mes}-01`, income_goal: p.after } }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const g = await ok(ctl.settings.getGoal, {}, ctx);
    const now2 = g.data?.income_goal != null ? Number(g.data.income_goal) : null;
    return { ok: now2 === p.after, result: { antes: p.before, despues_leido: now2 }, message: `meta de ${monthLabel(p.mes)}: ${p.before === null ? 'sin meta' : cop(p.before)} → ${cop(now2)}`, error: 'la meta no quedó como se esperaba.' };
  }
  const inverseGoal = async (action) => {
    const p = action.plan;
    if (p.before === null) return { error: 'Antes no había meta: el panel no permite dejarla vacía. Pon otra meta si quieres cambiarla.' };
    return { summary: `Deshacer: meta de ${monthLabel(p.mes)} ${cop(p.after)} → ${cop(p.before)}.`, plan: { kind: 'meta_mensual', mes: p.mes, before: p.after, after: p.before, label: p.label } };
  };
  async function runGoal(c, ctx) {
    const g = await ok(ctl.settings.getGoal, {}, ctx);
    const goal = g.data?.income_goal != null ? Number(g.data.income_goal) : null;
    const ym = today().slice(0, 7);
    const { d } = await cashMonth(ctx, ym);
    const ingresos = d ? (d.income_total ?? d.ingresos ?? 0) : 0;
    if (goal === null) return { text: `🎯 No tienes meta para ${monthLabel(ym)}. Llevas ${cop(ingresos)} en ingresos. Si quieres, dime «pon la meta del mes en 5 millones».` };
    return { text: `🎯 Meta de ${monthLabel(ym)}: ${cop(goal)} · llevas ${cop(ingresos)} (${Math.round((ingresos / goal) * 100)}%). Te faltan ${cop(Math.max(goal - ingresos, 0))}.` };
  }

  // ── Pedidos ─────────────────────────────────────────────────────────────────
  async function orderByCode(ctx, codigo) {
    const code = text(codigo, 12).toUpperCase().replace(/^P(\w)/, 'P-$1');
    if (!/^P-[0-9A-F]{4,8}$/.test(code)) return null;
    const { data, error } = await db.from('orders').select('id, status, client_name, total_amount, discount_amount, shipping_cost, payment_status, payment_method, shipping_carrier, tracking_code').eq('business_id', ctx.businessId);
    if (error) throw error;
    const hits = (data || []).filter((o) => orderCode(o.id).startsWith(code));
    return hits.length === 1 ? hits[0] : null;
  }
  const orderLabel = (o) => `${orderCode(o.id)} (${o.client_name || 'sin cliente'}, ${cop(o.total_amount)})`;

  async function preparePayment(a, ctx) {
    const o = await orderByCode(ctx, a.codigo);
    if (!o) return { success: false, error: `No encontré el pedido ${text(a.codigo, 12) || '(falta el código, por ejemplo P-1A2B3C4D)'}.` };
    if (o.status === 'cancelado') return { success: false, error: `El pedido ${orderCode(o.id)} está cancelado: su pago ya no cambia.` };
    const pago = norm(a.pago || 'pagado');
    if (!PAYMENT_STATUSES.includes(pago)) return { success: false, error: `Estado de pago: ${PAYMENT_STATUSES.join(', ')}.` };
    const metodo = a.metodo ? norm(a.metodo) : null;
    if (metodo && !PAYMENT_METHODS.includes(metodo)) return { success: false, error: `Método de pago: ${PAYMENT_METHODS.join(', ')}.` };
    if ((o.payment_status || 'pendiente') === pago && (!metodo || metodo === o.payment_method)) return { success: false, error: `El pedido ${orderCode(o.id)} ya está ${pago}.` };
    const extra = pago === 'pagado' && o.payment_status !== 'pagado' ? ' (entra a Caja)' : o.payment_status === 'pagado' && pago !== 'pagado' ? ' (sale de Caja)' : '';
    return savePending(ctx, 'pago_pedido', `Pago del pedido ${orderLabel(o)}: ${o.payment_status || 'pendiente'}${o.payment_method ? ` (${o.payment_method})` : ''} → ${pago}${metodo ? ` (${metodo})` : ''}${extra}. ¿Confirmas?`, { order_id: o.id, before: { payment_status: o.payment_status || 'pendiente', payment_method: o.payment_method }, after: { payment_status: pago, ...(metodo ? { payment_method: metodo } : {}) }, label: orderCode(o.id) });
  }
  async function executePayment(p, action, ctx) {
    const r = await ok(ctl.orders.updatePayment, { params: { id: p.order_id }, body: p.after }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const { data } = await db.from('orders').select('payment_status, payment_method').eq('business_id', ctx.businessId).eq('id', p.order_id).maybeSingle();
    return { ok: data?.payment_status === p.after.payment_status, result: { antes: p.before, despues_leido: data }, message: `pedido ${p.label}: pago ${p.before.payment_status} → ${data?.payment_status}${data?.payment_method ? ` (${data.payment_method})` : ''}`, error: 'el pago no quedó como se esperaba.' };
  }
  const inversePayment = async (action) => {
    const p = action.plan;
    return { summary: `Deshacer: pago del pedido ${p.label} de vuelta a ${p.before.payment_status}.`, plan: { kind: 'pago_pedido', order_id: p.order_id, before: p.after, after: { payment_status: p.before.payment_status, ...(p.before.payment_method ? { payment_method: p.before.payment_method } : {}) }, label: p.label } };
  };

  async function prepareShipping(a, ctx) {
    const o = await orderByCode(ctx, a.codigo);
    if (!o) return { success: false, error: `No encontré el pedido ${text(a.codigo, 12) || '(falta el código)'}.` };
    if (o.status === 'cancelado') return { success: false, error: `El pedido ${orderCode(o.id)} está cancelado.` };
    const after = {};
    if (a.transportadora) after.shipping_carrier = text(a.transportadora, 100);
    if (a.guia) after.tracking_code = text(a.guia, 100);
    if (!Object.keys(after).length) return { success: false, error: 'Dime la transportadora y/o la guía.' };
    const before = { shipping_carrier: o.shipping_carrier || null, tracking_code: o.tracking_code || null };
    return savePending(ctx, 'envio_pedido', `Envío del pedido ${orderLabel(o)}: ${after.shipping_carrier ? `transportadora ${before.shipping_carrier || '—'} → ${after.shipping_carrier}` : ''}${after.shipping_carrier && after.tracking_code ? ', ' : ''}${after.tracking_code ? `guía ${before.tracking_code || '—'} → ${after.tracking_code}` : ''}. ¿Confirmas?`, { order_id: o.id, before, after, label: orderCode(o.id) });
  }
  async function executeShipping(p, action, ctx) {
    const r = await ok(ctl.orders.updateShipping, { params: { id: p.order_id }, body: p.after }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const { data } = await db.from('orders').select('shipping_carrier, tracking_code').eq('business_id', ctx.businessId).eq('id', p.order_id).maybeSingle();
    const same = data && Object.entries(p.after).every(([k, v]) => (data[k] || null) === (v || null));
    return { ok: !!same, result: { antes: p.before, despues_leido: data }, message: `pedido ${p.label}: envío ${data?.shipping_carrier || '—'} · guía ${data?.tracking_code || '—'}`, error: 'el envío no quedó como se esperaba.' };
  }
  const inverseShipping = async (action) => {
    const p = action.plan;
    if (Object.keys(p.after).some((k) => !p.before[k])) return { error: 'Antes no había transportadora o guía: el panel no permite dejarlas vacías. Corrígelas con el dato bueno.' };
    return { summary: `Deshacer: envío del pedido ${p.label} como estaba.`, plan: { kind: 'envio_pedido', order_id: p.order_id, before: p.after, after: p.before, label: p.label } };
  };

  async function prepareOrderDiscount(a, ctx) {
    const o = await orderByCode(ctx, a.codigo);
    if (!o) return { success: false, error: `No encontré el pedido ${text(a.codigo, 12) || '(falta el código)'}.` };
    if (LOCKED_DISCOUNT.includes(o.status)) return { success: false, error: `El pedido ${orderCode(o.id)} está ${o.status}: su descuento ya no cambia.` };
    const d = int(a.descuento);
    if (!Number.isInteger(d) || d < 0) return { success: false, error: 'El descuento debe ser un número entero de pesos (0 para quitarlo).' };
    const prev = Number(o.discount_amount || 0);
    if (prev === d) return { success: false, error: `El pedido ${orderCode(o.id)} ya tiene ${cop(d)} de descuento.` };
    const total = Number(o.total_amount) + prev - d;
    if (total < 0) return { success: false, error: 'El descuento no puede ser mayor que el subtotal más el envío.' };
    return savePending(ctx, 'descuento_pedido', `Descuento del pedido ${orderLabel(o)}: ${cop(prev)} → ${cop(d)} (total ${cop(o.total_amount)} → ${cop(total)}). ¿Confirmas?`, { order_id: o.id, before: prev, after: d, label: orderCode(o.id) });
  }
  async function executeOrderDiscount(p, action, ctx) {
    const r = await ok(ctl.orders.updateDiscount, { params: { id: p.order_id }, body: { discount_amount: p.after } }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const { data } = await db.from('orders').select('discount_amount, total_amount').eq('business_id', ctx.businessId).eq('id', p.order_id).maybeSingle();
    return { ok: Number(data?.discount_amount) === p.after, result: { antes: p.before, despues_leido: Number(data?.discount_amount), total_leido: Number(data?.total_amount) }, message: `pedido ${p.label}: descuento ${cop(p.before)} → ${cop(data?.discount_amount)}, total ${cop(data?.total_amount)}`, error: 'el descuento no quedó como se esperaba.' };
  }
  const inverseOrderDiscount = async (action) => {
    const p = action.plan;
    return { summary: `Deshacer: descuento del pedido ${p.label} ${cop(p.after)} → ${cop(p.before)}.`, plan: { kind: 'descuento_pedido', order_id: p.order_id, before: p.after, after: p.before, label: p.label } };
  };

  async function prepareDeleteOrder(a, ctx) {
    const o = await orderByCode(ctx, a.codigo);
    if (!o) return { success: false, error: `No encontré el pedido ${text(a.codigo, 12) || '(falta el código)'}.` };
    return savePending(ctx, 'eliminar_pedido', R(`Eliminar del todo el pedido ${orderLabel(o)} (estado ${o.status}, pago ${o.payment_status || 'pendiente'}). Su stock vuelve al inventario y sale de Caja. No se puede deshacer. Si solo quieres anularlo, dime «cancela el pedido ${orderCode(o.id)}». ¿Confirmas?`), { risk: 'R', order_id: o.id, label: orderCode(o.id) });
  }
  async function executeDeleteOrder(p, action, ctx) {
    const r = await ok(ctl.orders.deleteOrder, { params: { id: p.order_id } }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const { data } = await db.from('orders').select('id').eq('business_id', ctx.businessId).eq('id', p.order_id).maybeSingle();
    return { ok: !data, result: { eliminado: !data }, message: `pedido ${p.label}: eliminado (stock devuelto)`, error: 'el pedido sigue ahí.' };
  }

  // ── Productos y variantes ───────────────────────────────────────────────────
  async function productByName(ctx, name, opts = { includeInactive: true }) {
    const r = await lib.resolveProduct(ctx.businessId, name, opts);
    if (r.product) return { product: r.product };
    if (r.needs) return { needs: { ...r, campo: 'producto' } };
    return { error: r.error };
  }
  const cap1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  async function prepareCreateProduct(a, ctx) {
    const nombre = text(a.nombre || a.producto, 120);
    if (!nombre) return { success: false, error: 'Dime el nombre del producto.' };
    const precio = int(a.precio);
    if (!isPosInt(precio, 1e8)) return { success: false, error: `¿A qué precio vendes «${nombre}»?` };
    const costo = int(a.costo);
    if (costo !== null && !(Number.isInteger(costo) && costo >= 0)) return { success: false, error: 'El costo debe ser un entero en pesos.' };
    const genero = a.genero ? norm(a.genero) : null;
    if (genero && !GENDERS.includes(genero)) return { success: false, error: 'Género: mujer, hombre o unisex.' };
    const all = await lib.loadProducts(ctx.businessId, { includeInactive: true });
    if (all.some((p) => norm(p.name) === norm(nombre))) return { success: false, error: `Ya existe un producto llamado «${nombre}». Si llegaron unidades, dime «llegaron N de ${nombre}».` };
    let variantes = Array.isArray(a.variantes) ? a.variantes.slice(0, 30) : [];
    if (!variantes.length && (a.color || a.talla)) variantes = [{ color: a.color, talla: a.talla, cantidad: a.cantidad }];
    const vs = [];
    for (const v of variantes) {
      const color = text(v.color, 40); const talla = text(v.talla, 20);
      if (!color || !talla) return { success: false, error: 'Cada variante necesita color y talla (por ejemplo «negro talla S, 3 unidades»).' };
      const qty = int(v.cantidad) ?? 0;
      if (!Number.isInteger(qty) || qty < 0 || qty > 10000) return { success: false, error: 'La cantidad de cada variante debe ser un entero mayor o igual a 0.' };
      if (vs.some((x) => norm(x.color) === norm(color) && norm(x.talla) === norm(talla))) return { success: false, error: `La variante ${color} ${talla} está repetida.` };
      vs.push({ color: cap1(color), talla: talla.toUpperCase(), cantidad: qty });
    }
    const stock = vs.length ? 0 : (int(a.cantidad) ?? 0);
    if (!Number.isInteger(stock) || stock < 0) return { success: false, error: 'La cantidad debe ser un entero mayor o igual a 0.' };
    const body = { name: nombre, price: precio, stock, has_variants: false, ...(costo !== null ? { cost_price: costo } : {}), ...(a.categoria ? { category: text(a.categoria, 60) } : {}), ...(genero ? { gender: genero } : {}), ...(a.descripcion ? { description: text(a.descripcion, 1000) } : {}) };
    const detalle = [costo !== null && `costo ${cop(costo)}`, body.category, genero].filter(Boolean).join(', ');
    const summary = `Crear el producto «${nombre}» a ${cop(precio)}${detalle ? ` (${detalle})` : ''}${vs.length ? ` con ${vs.length} variante${vs.length === 1 ? '' : 's'}: ${vs.map((v) => `${v.color} talla ${v.talla} × ${v.cantidad}`).join(', ')}` : ` con stock ${stock}`}. ¿Confirmas?`;
    return savePending(ctx, 'crear_producto', summary, { body, variantes: vs, label: nombre }, JSON.stringify({ k: 'crear_producto', n: norm(nombre) }));
  }
  async function executeCreateProduct(p, action, ctx) {
    const r = await ok(ctl.products.create, { body: p.body }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const productId = r.data?.id;
    if (!productId) return { ok: false, error: 'el producto no quedó creado.' };
    const ids = []; const fails = [];
    for (const v of p.variantes || []) {
      const vr = await ok(ctl.variants.create, { params: { productId }, body: { attributes: { color: v.color, talla: v.talla }, stock: v.cantidad } }, ctx);
      if (vr.error) fails.push(`${v.color} ${v.talla}: ${vr.error}`); else ids.push(vr.data.id);
    }
    const { data: prod } = await db.from('products').select('id, name, price, stock').eq('business_id', ctx.businessId).eq('id', productId).maybeSingle();
    return {
      ok: !!prod && !fails.length,
      result: { product_id: productId, variant_ids: ids, stock_leido: prod?.stock },
      message: `producto «${prod?.name}» creado a ${cop(prod?.price)} · stock ${prod?.stock}${ids.length ? ` en ${ids.length} variante${ids.length === 1 ? '' : 's'}` : ''}`,
      error: fails.length ? `se creó el producto pero fallaron variantes: ${fails.join('; ')}` : 'el producto no quedó creado.',
    };
  }
  const inverseCreateProduct = async (action) => {
    const id = action.result?.product_id;
    if (!id) return { error: 'No encontré el producto creado.' };
    return { summary: `Deshacer: eliminar el producto recién creado «${action.plan.label}».`, plan: { kind: 'eliminar_producto', product_id: id, label: action.plan.label } };
  };

  const PRODUCT_FIELDS = {
    costo: { col: 'cost_price', show: (v) => (v == null ? 'sin costo' : cop(v)) },
    nombre: { col: 'name', show: (v) => `«${v}»` },
    categoria: { col: 'category', show: (v) => v || 'sin categoría' },
    genero: { col: 'gender', show: (v) => v || 'sin género' },
    descripcion: { col: 'description', show: (v) => (v ? `«${String(v).slice(0, 60)}${String(v).length > 60 ? '…' : ''}»` : 'sin descripción') },
    stock_minimo: { col: 'min_stock', show: (v) => String(v ?? 0) },
  };
  function parseProductValue(campo, valor) {
    if (campo === 'costo' || campo === 'stock_minimo') {
      const n = int(valor);
      return Number.isInteger(n) && n >= 0 && n <= 1e8 ? { value: n } : { error: `El ${campo === 'costo' ? 'costo' : 'stock mínimo'} debe ser un entero mayor o igual a 0.` };
    }
    if (campo === 'genero') { const g = norm(valor); return GENDERS.includes(g) ? { value: g } : { error: 'Género: mujer, hombre o unisex.' }; }
    const t = text(String(valor ?? ''), campo === 'descripcion' ? 1000 : campo === 'nombre' ? 120 : 60);
    return t ? { value: t } : { error: `Dime el nuevo valor de ${campo}.` };
  }
  async function prepareEditProduct(a, ctx) {
    const campo = norm(a.campo || '').replace(/ /g, '_');
    if (campo === 'precio') return lib.prepararPrecio({ producto: a.producto, precio: a.valor, masivo: a.masivo }, ctx);
    const f = PRODUCT_FIELDS[campo];
    if (!f) return { success: false, error: 'Puedo cambiar: precio, costo, nombre, categoría, género, descripción o stock mínimo.' };
    const r = await productByName(ctx, a.producto);
    if (r.needs) return r.needs;
    if (r.error) return { success: false, error: r.error };
    const p = r.product;
    const v = parseProductValue(campo, a.valor);
    if (v.error) return { success: false, error: v.error };
    if (campo === 'nombre') {
      const all = await lib.loadProducts(ctx.businessId, { includeInactive: true });
      if (all.some((x) => x.id !== p.id && norm(x.name) === norm(v.value))) return { success: false, error: `Ya existe otro producto llamado «${v.value}».` };
    }
    const before = p[f.col] ?? null;
    if (String(before ?? '') === String(v.value)) return { success: false, error: `${p.name} ya tiene ${campo} ${f.show(v.value)}.` };
    let extra = '';
    if (campo === 'costo' && Number(p.price) > 0) {
      const m = (c) => (c == null ? '—' : `${Math.round(((Number(p.price) - Number(c)) / Number(p.price)) * 100)}%`);
      extra = ` (margen ${m(before)} → ${m(v.value)})`;
    }
    const summary = `${a.masivo ? '🔐 ' : ''}Cambiar ${campo.replace('_', ' ')} de ${p.name}: ${f.show(before)} → ${f.show(v.value)}${extra}. ¿Confirmas?`;
    return savePending(ctx, 'editar_producto', summary, { ...(a.masivo ? { risk: 'R' } : {}), product_id: p.id, campo, col: f.col, before, after: v.value, label: p.name });
  }
  async function executeEditProduct(p, action, ctx) {
    const r = await ok(ctl.products.update, { params: { id: p.product_id }, body: { [p.col]: p.after } }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const { data } = await db.from('products').select(p.col).eq('business_id', ctx.businessId).eq('id', p.product_id).maybeSingle();
    const got = data ? data[p.col] : undefined;
    const f = PRODUCT_FIELDS[p.campo];
    return { ok: String(got ?? '') === String(p.after ?? ''), result: { antes: p.before, despues_leido: got }, message: `${p.label}: ${p.campo.replace('_', ' ')} ${f.show(p.before)} → ${f.show(got)}`, error: 'el cambio no quedó como se esperaba.' };
  }
  const inverseEditProduct = async (action) => {
    const p = action.plan;
    if (p.before === null && ['cost_price', 'category', 'gender', 'description'].includes(p.col)) {
      return { summary: `Deshacer: ${p.label} vuelve a quedar ${PRODUCT_FIELDS[p.campo].show(null)}.`, plan: { kind: 'editar_producto', product_id: p.product_id, campo: p.campo, col: p.col, before: p.after, after: null, label: p.label } };
    }
    return { summary: `Deshacer: ${p.campo.replace('_', ' ')} de ${p.label} ${PRODUCT_FIELDS[p.campo].show(p.after)} → ${PRODUCT_FIELDS[p.campo].show(p.before)}.`, plan: { kind: 'editar_producto', product_id: p.product_id, campo: p.campo, col: p.col, before: p.after, after: p.before, label: p.label } };
  };

  async function prepareDeleteProduct(a, ctx) {
    const r = await productByName(ctx, a.producto);
    if (r.needs) return r.needs;
    if (r.error) return { success: false, error: r.error };
    const p = r.product;
    const vs = await lib.loadVariants(ctx.businessId, [p.id], { includeInactive: true });
    const { count } = await db.from('order_items').select('id', { count: 'exact', head: true }).eq('business_id', ctx.businessId).eq('product_id', p.id);
    const summary = R(`Eliminar DEL TODO el producto «${p.name}»${p.is_bundle ? ' (set)' : ''}: ${vs.length} variante${vs.length === 1 ? '' : 's'}, stock ${p.stock}${count ? `, aparece en ${count} línea${count === 1 ? '' : 's'} de pedidos (quedan sin producto enlazado)` : ''}. Desaparece del panel y de la tienda. No se puede deshacer. Si solo quieres ocultarlo, dime «desactiva ${p.name}». ¿Confirmas?`);
    return savePending(ctx, 'eliminar_producto', summary, { risk: 'R', product_id: p.id, label: p.name });
  }
  async function executeDeleteProduct(p, action, ctx) {
    const r = await ok(ctl.products.deleteProduct, { params: { id: p.product_id } }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const { data } = await db.from('products').select('id').eq('business_id', ctx.businessId).eq('id', p.product_id).maybeSingle();
    return { ok: !data, result: { eliminado: !data }, message: `«${p.label}»: eliminado`, error: 'el producto sigue ahí.' };
  }

  async function prepareEditVariant(a, ctx) {
    const r = await productByName(ctx, a.producto);
    if (r.needs) return r.needs;
    if (r.error) return { success: false, error: r.error };
    const p = r.product;
    const v = await lib.resolveVariant(ctx.businessId, p, a.color, a.talla, { includeInactive: true });
    if (!v.variant) return v.needs ? { ...v, campo: 'variante' } : v;
    const cur = v.variant;
    const attrs = { ...(cur.attributes || {}) };
    const key = (name) => Object.keys(attrs).find((k) => norm(k) === name) || name;
    const changes = [];
    if (a.nuevo_color) { const c = cap1(text(a.nuevo_color, 40)); changes.push(`color ${attrs[key('color')] || '—'} → ${c}`); attrs[key('color')] = c; }
    if (a.nueva_talla) { const t = text(a.nueva_talla, 20).toUpperCase(); changes.push(`talla ${attrs[key('talla')] || '—'} → ${t}`); attrs[key('talla')] = t; }
    const body = {};
    if (changes.length) body.attributes = attrs;
    if (a.sku) { body.sku = text(a.sku, 64); changes.push(`SKU ${cur.sku || '—'} → ${body.sku}`); }
    const sm = int(a.stock_minimo);
    if (sm !== null) { if (!Number.isInteger(sm) || sm < 0) return { success: false, error: 'El stock mínimo debe ser un entero mayor o igual a 0.' }; body.min_stock = sm; changes.push(`stock mínimo ${cur.min_stock ?? 2} → ${sm}`); }
    if (!changes.length) return { success: false, error: '¿Qué le cambio a la variante (color, talla, SKU o stock mínimo)? Para el stock dime «llegaron N» o «deja en N».' };
    const label = `${p.name}, ${lib.variantLabel(cur)}`;
    return savePending(ctx, 'editar_variante', `Editar la variante ${label}: ${changes.join(', ')}${body.attributes ? ' (las fotos del color se mueven con ella si nadie más usa ese color)' : ''}. ¿Confirmas?`, { product_id: p.id, variant_id: cur.id, body, before: { attributes: cur.attributes, sku: cur.sku ?? null, min_stock: cur.min_stock ?? null }, label });
  }
  async function executeEditVariant(p, action, ctx) {
    const r = await ok(ctl.variants.update, { params: { productId: p.product_id, variantId: p.variant_id }, body: p.body }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const { data } = await db.from('product_variants').select('attributes, sku, min_stock').eq('business_id', ctx.businessId).eq('id', p.variant_id).maybeSingle();
    const same = data && (!p.body.attributes || JSON.stringify(data.attributes) === JSON.stringify(p.body.attributes)) && (p.body.min_stock === undefined || data.min_stock === p.body.min_stock);
    const notes = [r.body?.photos?.message, r.body?.warning].filter(Boolean).join(' ');
    return { ok: !!same, result: { antes: p.before, despues_leido: data }, message: `${p.label} → ${lib.variantLabel({ attributes: data?.attributes })}${notes ? ` (${notes})` : ''}`, error: 'la variante no quedó como se esperaba.' };
  }
  const inverseEditVariant = async (action) => {
    const p = action.plan;
    const body = {};
    if (p.body.attributes) body.attributes = p.before.attributes;
    if (p.body.sku && p.before.sku) body.sku = p.before.sku;
    if (p.body.min_stock !== undefined && p.before.min_stock !== null) body.min_stock = p.before.min_stock;
    if (!Object.keys(body).length) return { error: 'Esa variante no tenía un valor anterior que se pueda restaurar.' };
    return { summary: `Deshacer: la variante ${p.label} vuelve a como estaba.`, plan: { kind: 'editar_variante', product_id: p.product_id, variant_id: p.variant_id, body, before: { attributes: p.body.attributes || p.before.attributes, sku: p.body.sku ?? null, min_stock: p.body.min_stock ?? null }, label: p.label } };
  };

  async function prepareDeleteVariant(a, ctx) {
    const r = await productByName(ctx, a.producto);
    if (r.needs) return r.needs;
    if (r.error) return { success: false, error: r.error };
    const v = await lib.resolveVariant(ctx.businessId, r.product, a.color, a.talla, { includeInactive: true });
    if (!v.variant) return v.needs ? { ...v, campo: 'variante' } : v;
    const label = `${r.product.name}, ${lib.variantLabel(v.variant)}`;
    return savePending(ctx, 'eliminar_variante', R(`Eliminar DEL TODO la variante ${label} (stock ${v.variant.stock}). Solo se puede si nunca se usó (sin stock, pedidos ni movimientos); si no, te propongo desactivarla. No se puede deshacer. ¿Confirmas?`), { risk: 'R', product_id: r.product.id, variant_id: v.variant.id, label });
  }
  async function executeDeleteVariant(p, action, ctx) {
    const r = await ok(ctl.variants.remove, { params: { productId: p.product_id, variantId: p.variant_id } }, ctx);
    if (r.error) return { ok: false, error: `${r.error} Si quieres que deje de venderse, dime «desactiva ${p.label}».` };
    const { data } = await db.from('product_variants').select('id').eq('business_id', ctx.businessId).eq('id', p.variant_id).maybeSingle();
    return { ok: !data, result: { eliminada: !data }, message: `${p.label}: eliminada`, error: 'la variante sigue ahí.' };
  }

  // ── Sets ────────────────────────────────────────────────────────────────────
  async function resolvePieces(ctx, piezas) {
    const out = [];
    for (const it of (Array.isArray(piezas) ? piezas : []).slice(0, 8)) {
      const r = await lib.resolveProduct(ctx.businessId, it.producto, { includeInactive: false });
      if (!r.product) return { error: r.error || `«${text(it.producto, 40)}» coincide con varios productos: dime el nombre completo.` };
      if (r.product.is_bundle) return { error: `${r.product.name} es un set: un set se arma con productos sueltos.` };
      const q = int(it.cantidad) ?? 1;
      if (!Number.isInteger(q) || q < 1 || q > 10) return { error: 'La cantidad de cada pieza debe estar entre 1 y 10.' };
      out.push({ product: r.product, quantity: q });
    }
    return { pieces: out };
  }
  async function prepareCreateSet(a, ctx) {
    const nombre = text(a.nombre || a.set, 120);
    if (!nombre) return { success: false, error: 'Dime el nombre del set.' };
    const precio = int(a.precio);
    if (!isPosInt(precio, 1e8)) return { success: false, error: `¿A qué precio vendes el set «${nombre}»?` };
    const pz = await resolvePieces(ctx, a.piezas);
    if (pz.error) return { success: false, error: pz.error };
    if (pz.pieces.length < 2) return { success: false, error: 'Un set necesita al menos 2 productos (por ejemplo «Top Aria + Licra Aria»).' };
    const suma = pz.pieces.reduce((s, x) => s + Number(x.product.price) * x.quantity, 0);
    const summary = `Crear el set «${nombre}» a ${cop(precio)} con ${pz.pieces.map((x) => `${x.quantity}× ${x.product.name}`).join(' + ')} (sueltos suman ${cop(suma)}). ¿Confirmas?`;
    return savePending(ctx, 'crear_set', summary, { body: { name: nombre, price: precio, components: pz.pieces.map((x) => ({ product_id: x.product.id, quantity: x.quantity })) }, label: nombre });
  }
  async function executeCreateSet(p, action, ctx) {
    const r = await ok(ctl.bundles.create, { body: p.body }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const id = r.data?.id || r.data?.set?.id;
    const { data } = id ? await db.from('products').select('id, name, price, is_bundle').eq('business_id', ctx.businessId).eq('id', id).maybeSingle() : { data: null };
    return { ok: !!data?.is_bundle, result: { product_id: data?.id }, message: `set «${data?.name}» creado a ${cop(data?.price)}`, error: 'el set no quedó creado.' };
  }
  const inverseCreateSet = async (action) => (action.result?.product_id
    ? { summary: `Deshacer: eliminar el set recién creado «${action.plan.label}».`, plan: { kind: 'eliminar_producto', product_id: action.result.product_id, label: action.plan.label } }
    : { error: 'No encontré el set creado.' });

  async function prepareEditSet(a, ctx) {
    const sets = (await lib.loadProducts(ctx.businessId, { includeInactive: true })).filter((p) => p.is_bundle);
    const hits = lib.matchProducts(sets, a.set || a.producto);
    if (!hits.length) return { success: false, error: `No encontré un set que se llame «${text(a.set || a.producto, 40)}».` };
    if (hits.length > 1) return ask('set', '¿Cuál set?', hits.slice(0, 10).map((s) => ({ label: s.name, value: `id:${s.id}` })));
    const s = hits[0];
    const body = {}; const changes = [];
    const precio = int(a.precio);
    if (precio !== null) { if (!isPosInt(precio, 1e8)) return { success: false, error: 'El precio debe ser mayor que 0.' }; if (precio !== Number(s.price)) { body.price = precio; changes.push(`precio ${cop(s.price)} → ${cop(precio)}`); } }
    if (a.nombre && norm(a.nombre) !== norm(s.name)) { body.name = text(a.nombre, 120); changes.push(`nombre «${s.name}» → «${body.name}»`); }
    const { data: comps } = await db.from('product_bundle_components').select('component_product_id, quantity').eq('business_id', ctx.businessId).eq('bundle_product_id', s.id);
    const beforeComps = (comps || []).map((c) => ({ product_id: c.component_product_id, quantity: c.quantity }));
    if (Array.isArray(a.piezas) && a.piezas.length) {
      const pz = await resolvePieces(ctx, a.piezas);
      if (pz.error) return { success: false, error: pz.error };
      if (pz.pieces.length < 2) return { success: false, error: 'Un set necesita al menos 2 productos.' };
      body.components = pz.pieces.map((x) => ({ product_id: x.product.id, quantity: x.quantity }));
      changes.push(`piezas → ${pz.pieces.map((x) => `${x.quantity}× ${x.product.name}`).join(' + ')}`);
    }
    if (!changes.length) return { success: false, error: '¿Qué le cambio al set (precio, nombre o piezas)?' };
    return savePending(ctx, 'editar_set', `Editar el set «${s.name}»: ${changes.join(', ')}. ¿Confirmas?`, { product_id: s.id, body, before: { price: Number(s.price), name: s.name, components: beforeComps }, label: s.name });
  }
  async function executeEditSet(p, action, ctx) {
    const r = await ok(ctl.bundles.update, { params: { id: p.product_id }, body: p.body }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const { data } = await db.from('products').select('name, price').eq('business_id', ctx.businessId).eq('id', p.product_id).maybeSingle();
    const same = data && (p.body.price === undefined || Number(data.price) === p.body.price) && (p.body.name === undefined || data.name === p.body.name);
    return { ok: !!same, result: { antes: p.before, despues_leido: data }, message: `set «${data?.name}»: ${cop(data?.price)}`, error: 'el set no quedó como se esperaba.' };
  }
  const inverseEditSet = async (action) => {
    const p = action.plan;
    const body = {};
    if (p.body.price !== undefined) body.price = p.before.price;
    if (p.body.name !== undefined) body.name = p.before.name;
    if (p.body.components) body.components = p.before.components;
    return { summary: `Deshacer: el set «${p.label}» vuelve a como estaba.`, plan: { kind: 'editar_set', product_id: p.product_id, body, before: { price: p.body.price, name: p.body.name, components: p.body.components }, label: p.label } };
  };

  // ── Clientes ────────────────────────────────────────────────────────────────
  const digits = (s) => String(s || '').replace(/\D/g, '');
  async function clientByName(ctx, q) {
    if (q && String(q).includes(':') && /^cli:/.test(q)) {
      const { data } = await db.from('clients').select('id, name, phone, email, notes').eq('business_id', ctx.businessId).eq('id', String(q).slice(4)).maybeSingle();
      return data ? { client: data } : { error: 'Ese cliente ya no existe.' };
    }
    const { data: all, error } = await db.from('clients').select('id, name, phone, email, notes, archived').eq('business_id', ctx.businessId).limit(2000);
    if (error) throw error;
    // Los archivados (eliminados desde el panel) no cuentan, igual que en la lista de Clientes
    const data = (all || []).filter((c) => !c.archived);
    const n = norm(q); const d = digits(q);
    if (!n) return { error: 'Dime el nombre o el teléfono del cliente.' };
    const exact = (data || []).filter((c) => norm(c.name) === n || (d.length >= 7 && digits(c.phone).endsWith(d.slice(-10))));
    const hits = exact.length ? exact : (data || []).filter((c) => n.split(' ').every((w) => norm(c.name).includes(w)));
    if (!hits.length) return { error: `No encontré un cliente «${text(q, 40)}».` };
    if (hits.length > 1) return { needs: ask('cliente', '¿Cuál cliente?', hits.slice(0, 10).map((c) => ({ label: `${c.name}${c.phone ? ` (${c.phone})` : ''}`, value: `cli:${c.id}` }))) };
    return { client: hits[0] };
  }

  async function prepareCreateClient(a, ctx) {
    const nombre = text(a.nombre || a.cliente, 120);
    const tel = digits(a.telefono);
    if (!nombre) return { success: false, error: 'Dime el nombre del cliente.' };
    if (tel.length < 7) return { success: false, error: `Para crear a ${nombre} necesito su teléfono (el panel lo exige).` };
    const email = a.email ? text(a.email, 120) : null;
    return savePending(ctx, 'crear_cliente', `Crear el cliente ${nombre} (${tel}${email ? `, ${email}` : ''}). ¿Confirmas?`, { body: { name: nombre, phone: tel, ...(email ? { email } : {}) }, label: nombre });
  }
  async function executeCreateClient(p, action, ctx) {
    const r = await ok(ctl.clients.create, { body: p.body }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const id = r.data?.id;
    const { data } = id ? await db.from('clients').select('id, name, phone').eq('business_id', ctx.businessId).eq('id', id).maybeSingle() : { data: null };
    return { ok: !!data, result: { client_id: data?.id }, message: `cliente ${data?.name} creado (${data?.phone})`, error: 'el cliente no quedó creado.' };
  }
  const inverseCreateClient = async (action) => (action.result?.client_id
    ? { summary: `Deshacer: eliminar el cliente recién creado ${action.plan.label}.`, plan: { kind: 'eliminar_cliente', client_id: action.result.client_id, label: action.plan.label } }
    : { error: 'No encontré el cliente creado.' });

  const CLIENT_FIELDS = { nombre: 'name', telefono: 'phone', email: 'email', notas: 'notes' };
  async function prepareEditClient(a, ctx) {
    const r = await clientByName(ctx, a.cliente);
    if (r.needs) return r.needs;
    if (r.error) return { success: false, error: r.error };
    const col = CLIENT_FIELDS[norm(a.campo || '')];
    if (!col) return { success: false, error: 'Puedo cambiarle al cliente: nombre, teléfono, email o notas.' };
    const value = col === 'phone' ? digits(a.valor) : text(String(a.valor ?? ''), col === 'notes' ? 500 : 120);
    if (!value || (col === 'phone' && value.length < 7)) return { success: false, error: `Dime el nuevo ${a.campo}.` };
    const c = r.client;
    if (String(c[col] ?? '') === value) return { success: false, error: `${c.name} ya tiene ese ${a.campo}.` };
    return savePending(ctx, 'editar_cliente', `Cambiar ${a.campo} de ${c.name}: ${c[col] || '—'} → ${value}. ¿Confirmas?`, { client_id: c.id, col, campo: norm(a.campo), before: c[col] ?? null, after: value, current: { name: c.name, phone: c.phone, email: c.email, notes: c.notes }, label: c.name });
  }
  async function executeEditClient(p, action, ctx) {
    const { data: cur } = await db.from('clients').select('name, phone, email, notes').eq('business_id', ctx.businessId).eq('id', p.client_id).maybeSingle();
    if (!cur) return { ok: false, error: 'el cliente ya no existe.' };
    const r = await ok(ctl.clients.update, { params: { id: p.client_id }, body: { ...cur, [p.col]: p.after } }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const { data } = await db.from('clients').select(p.col).eq('business_id', ctx.businessId).eq('id', p.client_id).maybeSingle();
    return { ok: String(data?.[p.col] ?? '') === String(p.after ?? ''), result: { antes: p.before, despues_leido: data?.[p.col] }, message: `${p.label}: ${p.campo} ${p.before || '—'} → ${data?.[p.col] || '—'}`, error: 'el cliente no quedó como se esperaba.' };
  }
  const inverseEditClient = async (action) => {
    const p = action.plan;
    if (p.before === null && p.col === 'name') return { error: 'No había valor anterior.' };
    return { summary: `Deshacer: ${p.campo} de ${p.label} vuelve a ${p.before || '—'}.`, plan: { ...p, kind: 'editar_cliente', before: p.after, after: p.before } };
  };

  async function prepareDeleteClient(a, ctx) {
    const r = await clientByName(ctx, a.cliente);
    if (r.needs) return r.needs;
    if (r.error) return { success: false, error: r.error };
    const c = r.client;
    // Igual que el panel: "eliminar" archiva (sale de la lista de Clientes; sus datos y pedidos se conservan)
    return savePending(ctx, 'eliminar_cliente', R(`Eliminar al cliente ${c.name}${c.phone ? ` (${c.phone})` : ''} de la lista de Clientes (queda archivado: sus datos y pedidos se conservan, pero el panel no tiene cómo traerlo de vuelta). ¿Confirmas?`), { risk: 'R', client_id: c.id, label: c.name });
  }
  async function executeDeleteClient(p, action, ctx) {
    const r = await ok(ctl.clients.destroy, { params: { id: p.client_id } }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const { data } = await db.from('clients').select('id, archived').eq('business_id', ctx.businessId).eq('id', p.client_id).maybeSingle();
    const gone = !data || data.archived === true;
    return { ok: gone, result: { archivado: gone }, message: `cliente ${p.label}: eliminado de la lista (archivado)`, error: 'el cliente sigue en la lista.' };
  }

  // "Volver a comprar" por WhatsApp: envía un mensaje real. Antispam del asistente (el panel no tiene uno):
  // máximo uno por cliente cada RECALL_COOLDOWN_DAYS días y RECALL_MAX_PER_DAY por negocio al día.
  async function recallsBy(ctx, sinceIso) {
    const { data, error } = await db.from('assistant_actions').select('plan, applied_at').eq('business_id', ctx.businessId).eq('kind', 'recordar_cliente').eq('status', 'applied').gte('applied_at', sinceIso);
    if (error) throw error;
    return data || [];
  }
  async function prepareRecall(a, ctx) {
    const r = await clientByName(ctx, a.cliente);
    if (r.needs) return r.needs;
    if (r.error) return { success: false, error: r.error };
    const c = r.client;
    if (!c.phone) return { success: false, error: `${c.name} no tiene teléfono registrado.` };
    const recent = await recallsBy(ctx, new Date(now().getTime() - RECALL_COOLDOWN_DAYS * 86400000).toISOString());
    if (recent.some((x) => x.plan?.client_id === c.id)) return { success: false, error: `A ${c.name} ya le escribí en los últimos ${RECALL_COOLDOWN_DAYS} días: espera para no saturarlo.` };
    const todayCount = (await recallsBy(ctx, `${today()}T00:00:00-05:00`)).length;
    if (todayCount >= RECALL_MAX_PER_DAY) return { success: false, error: `Hoy ya envié ${RECALL_MAX_PER_DAY} recordatorios (límite diario para evitar spam). Sigue mañana o desde el panel.` };
    return savePending(ctx, 'recordar_cliente', R(`Enviar por WhatsApp a ${c.name} (${c.phone}) el mensaje de «volver a comprar» que tienes en Configuración. Se envía de verdad y no se puede deshacer. ¿Confirmas?`), { risk: 'R', client_id: c.id, label: c.name });
  }
  async function executeRecall(p, action, ctx) {
    const r = await ok(ctl.clients.recallClient, { params: { id: p.client_id } }, ctx);
    if (r.error) return { ok: false, error: r.error };
    return { ok: true, result: { client_id: p.client_id, enviado: true }, message: `recordatorio enviado a ${p.label}` };
  }

  async function runClientInfo(c, ctx) {
    const r = await clientByName(ctx, c.cliente || c.texto);
    if (r.needs) return { question: r.needs, consulta: c };
    if (r.error) return { text: r.error };
    const cl = r.client;
    const { data: orders } = await db.from('orders').select('id, created_at, status, total_amount, client_phone, client_id, client_name').eq('business_id', ctx.businessId);
    const mine = (orders || []).filter((o) => o.status !== 'cancelado' && (o.client_id === cl.id || (cl.phone && digits(o.client_phone).slice(-10) === digits(cl.phone).slice(-10))));
    const total = mine.reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const last = mine.sort((a2, b) => String(b.created_at).localeCompare(String(a2.created_at)))[0];
    return { text: `👤 ${cl.name}${cl.phone ? ` · ${cl.phone}` : ''}${cl.email ? ` · ${cl.email}` : ''}\n${mine.length ? `${mine.length} pedido${mine.length === 1 ? '' : 's'} por ${cop(total)} · último ${dateLabel(dayISO(new Date(last.created_at)))} (${orderCode(last.id)})` : 'Sin pedidos registrados.'}${cl.notes ? `\nNotas: ${cl.notes}` : ''}` };
  }

  async function runInactiveClients(c, ctx) {
    const dias = Math.min(Math.max(int(c.dias) || 60, 7), 730);
    const { data, error } = await db.from('orders').select('created_at, status, total_amount, client_name, client_phone').eq('business_id', ctx.businessId);
    if (error) throw error;
    const acc = {};
    for (const o of data || []) {
      if (o.status === 'cancelado' || !(o.client_name || o.client_phone)) continue;
      const k = digits(o.client_phone).slice(-10) || norm(o.client_name);
      acc[k] = acc[k] || { cliente: o.client_name || o.client_phone, pedidos: 0, total: 0, ultima: o.created_at };
      acc[k].pedidos += 1; acc[k].total += Number(o.total_amount || 0);
      if (o.created_at > acc[k].ultima) acc[k].ultima = o.created_at;
    }
    const limit = new Date(now().getTime() - dias * 86400000).toISOString();
    const list = Object.values(acc).filter((x) => x.ultima < limit).sort((x, y) => y.total - x.total);
    if (!list.length) return { text: `Todos tus clientes con pedidos han comprado en los últimos ${dias} días. 🎉` };
    return { text: `⏳ Clientes que no compran hace más de ${dias} días (${list.length}):\n${list.slice(0, 10).map((x) => `• ${x.cliente} — última compra ${dateLabel(dayISO(new Date(x.ultima)))}, ${x.pedidos} pedido${x.pedidos === 1 ? '' : 's'} por ${cop(x.total)}`).join('\n')}${list.length > 10 ? `\n… y ${list.length - 10} más` : ''}\nPuedo enviarle a uno el mensaje de «volver a comprar» por WhatsApp.` };
  }

  // ── Equipo ──────────────────────────────────────────────────────────────────
  async function employeeByName(ctx, q) {
    if (/^emp:/.test(String(q || ''))) {
      const { data } = await db.from('employees').select('id, name, phone, email, commission_percent, is_active').eq('business_id', ctx.businessId).eq('id', String(q).slice(4)).maybeSingle();
      return data ? { employee: data } : { error: 'Ese empleado ya no existe.' };
    }
    const { data, error } = await db.from('employees').select('id, name, phone, email, commission_percent, is_active').eq('business_id', ctx.businessId);
    if (error) throw error;
    const n = norm(q);
    const hits = (data || []).filter((e) => norm(e.name) === n).length ? (data || []).filter((e) => norm(e.name) === n) : (data || []).filter((e) => n && n.split(' ').every((w) => norm(e.name).includes(w)));
    if (!hits.length) return { error: `No encontré un empleado «${text(q, 40)}».` };
    if (hits.length > 1) return { needs: ask('empleado', '¿Cuál empleado?', hits.map((e) => ({ label: `${e.name}${e.is_active ? '' : ' (inactivo)'}`, value: `emp:${e.id}` }))) };
    return { employee: hits[0] };
  }
  async function prepareCreateEmployee(a, ctx) {
    const nombre = text(a.nombre || a.empleado, 120);
    if (!nombre) return { success: false, error: 'Dime el nombre del empleado.' };
    const com = int(a.comision);
    if (com !== null && !(Number.isInteger(com) && com >= 0 && com <= 100)) return { success: false, error: 'La comisión debe ser un porcentaje entre 0 y 100.' };
    const body = { name: nombre, ...(a.telefono ? { phone: digits(a.telefono) } : {}), ...(a.email ? { email: text(a.email, 120) } : {}), ...(com !== null ? { commission_percent: com } : {}) };
    return savePending(ctx, 'crear_empleado', `Crear el empleado ${nombre}${body.phone ? ` (${body.phone})` : ''}${com !== null ? `, comisión ${com}%` : ''}. ¿Confirmas?`, { body, label: nombre });
  }
  async function executeCreateEmployee(p, action, ctx) {
    const r = await ok(ctl.employees.create, { body: p.body }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const id = r.data?.id;
    const { data } = id ? await db.from('employees').select('id, name').eq('business_id', ctx.businessId).eq('id', id).maybeSingle() : { data: null };
    return { ok: !!data, result: { employee_id: data?.id }, message: `empleado ${data?.name} creado`, error: 'el empleado no quedó creado.' };
  }
  const inverseCreateEmployee = async (action) => (action.result?.employee_id
    ? { summary: `Deshacer: desactivar el empleado recién creado ${action.plan.label}.`, plan: { kind: 'editar_empleado', employee_id: action.result.employee_id, col: 'is_active', campo: 'activo', before: true, after: false, label: action.plan.label } }
    : { error: 'No encontré el empleado creado.' });

  const EMP_FIELDS = { nombre: 'name', telefono: 'phone', email: 'email', comision: 'commission_percent', activo: 'is_active' };
  async function prepareEditEmployee(a, ctx) {
    const r = await employeeByName(ctx, a.empleado);
    if (r.needs) return r.needs;
    if (r.error) return { success: false, error: r.error };
    const campo = norm(a.campo || (a.activo !== undefined ? 'activo' : ''));
    const col = EMP_FIELDS[campo];
    if (!col) return { success: false, error: 'Puedo cambiarle al empleado: nombre, teléfono, email, comisión o activarlo/desactivarlo.' };
    let value;
    if (col === 'is_active') value = typeof a.activo === 'boolean' ? a.activo : /^(si|true|activo|activar)$/.test(norm(a.valor));
    else if (col === 'commission_percent') { value = int(a.valor); if (!(Number.isInteger(value) && value >= 0 && value <= 100)) return { success: false, error: 'La comisión debe estar entre 0 y 100.' }; } else value = col === 'phone' ? digits(a.valor) : text(String(a.valor ?? ''), 120);
    if (value === '' || value === null) return { success: false, error: `Dime el nuevo ${campo}.` };
    const e = r.employee;
    if (String(e[col]) === String(value)) return { success: false, error: `${e.name} ya tiene ese ${campo}.` };
    const show = (v) => (col === 'is_active' ? (v ? 'activo' : 'inactivo') : col === 'commission_percent' ? `${v}%` : v || '—');
    return savePending(ctx, 'editar_empleado', `Empleado ${e.name}: ${campo} ${show(e[col])} → ${show(value)}. ¿Confirmas?`, { employee_id: e.id, col, campo, before: e[col] ?? null, after: value, label: e.name });
  }
  async function executeEditEmployee(p, action, ctx) {
    const r = await ok(ctl.employees.update, { params: { id: p.employee_id }, body: { [p.col]: p.after } }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const { data } = await db.from('employees').select(p.col).eq('business_id', ctx.businessId).eq('id', p.employee_id).maybeSingle();
    return { ok: String(data?.[p.col]) === String(p.after), result: { antes: p.before, despues_leido: data?.[p.col] }, message: `empleado ${p.label}: ${p.campo} → ${data?.[p.col]}`, error: 'el empleado no quedó como se esperaba.' };
  }
  const inverseEditEmployee = async (action) => {
    const p = action.plan;
    if (p.before === null) return { error: 'No había valor anterior.' };
    return { summary: `Deshacer: empleado ${p.label}, ${p.campo} vuelve a como estaba.`, plan: { ...p, kind: 'editar_empleado', before: p.after, after: p.before } };
  };
  async function prepareDeleteEmployee(a, ctx) {
    const r = await employeeByName(ctx, a.empleado);
    if (r.needs) return r.needs;
    if (r.error) return { success: false, error: r.error };
    return savePending(ctx, 'eliminar_empleado', R(`Eliminar al empleado ${r.employee.name} del equipo. No se puede deshacer; si solo dejará de trabajar, mejor dime «desactiva a ${r.employee.name}». ¿Confirmas?`), { risk: 'R', employee_id: r.employee.id, label: r.employee.name });
  }
  async function executeDeleteEmployee(p, action, ctx) {
    const r = await ok(ctl.employees.deleteEmployee, { params: { id: p.employee_id } }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const { data } = await db.from('employees').select('id, is_active').eq('business_id', ctx.businessId).eq('id', p.employee_id).maybeSingle();
    return { ok: !data || data.is_active === false, result: { eliminado: true }, message: `empleado ${p.label}: eliminado`, error: 'el empleado sigue activo.' };
  }
  async function runEmployees(c, ctx) {
    const { data } = await db.from('employees').select('name, phone, commission_percent, is_active').eq('business_id', ctx.businessId);
    if (!data?.length) return { text: 'No tienes empleados registrados.' };
    return { text: `👥 Equipo (${data.length}):\n${data.map((e) => `• ${e.name}${e.is_active ? '' : ' (inactivo)'}${e.phone ? ` · ${e.phone}` : ''}${e.commission_percent != null ? ` · comisión ${e.commission_percent}%` : ''}`).join('\n')}` };
  }

  // ── Configuración del negocio ───────────────────────────────────────────────
  const PROFILE_FIELDS = { nombre: 'name', dueno: 'owner_name', telefono: 'phone', direccion: 'address' };
  async function prepareProfile(a, ctx) {
    const campo = norm(a.campo || '').replace('ñ', 'n');
    const col = PROFILE_FIELDS[campo];
    if (!col) return { success: false, error: 'Del perfil puedo cambiar: nombre del negocio, dueño, teléfono o dirección.' };
    const value = text(String(a.valor ?? ''), 160);
    if (!value) return { success: false, error: `Dime el nuevo ${campo}.` };
    const { data: b } = await db.from('businesses').select('name, owner_name, phone, address').eq('id', ctx.businessId).maybeSingle();
    if (!b) return { success: false, error: 'No pude leer el perfil.' };
    if (String(b[col] ?? '') === value) return { success: false, error: `El ${campo} ya es «${value}».` };
    return savePending(ctx, 'editar_perfil', R(`Cambiar el ${campo === 'dueno' ? 'nombre del dueño' : campo} del negocio: «${b[col] || '—'}» → «${value}». ¿Confirmas?`), { risk: 'R', col, campo, before: b[col] ?? null, after: value, label: `perfil (${campo})` });
  }
  async function executeProfile(p, action, ctx) {
    const { data: b } = await db.from('businesses').select('name').eq('id', ctx.businessId).maybeSingle();
    const r = await ok(ctl.settings.updateProfile, { body: { name: p.col === 'name' ? p.after : b?.name, [p.col]: p.after } }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const { data } = await db.from('businesses').select(p.col).eq('id', ctx.businessId).maybeSingle();
    return { ok: String(data?.[p.col] ?? '') === String(p.after), result: { antes: p.before, despues_leido: data?.[p.col] }, message: `perfil: ${p.campo} «${p.before || '—'}» → «${data?.[p.col]}»`, error: 'el perfil no quedó como se esperaba.' };
  }
  const inverseProfile = async (action) => {
    const p = action.plan;
    if (p.before === null || p.before === '') return { error: 'No había valor anterior.' };
    return { summary: `Deshacer: ${p.campo} del negocio vuelve a «${p.before}».`, plan: { ...p, kind: 'editar_perfil', risk: undefined, before: p.after, after: p.before } };
  };

  async function prepareModule(a, ctx) {
    // "pedido", "Pedidos", "analítica" → la clave del módulo (singular o plural, sin tildes)
    const modulo = norm(a.modulo || '').replace(/s$/, '');
    const key = MODULES.find((m) => m.replace(/s$/, '') === modulo);
    if (!key) return { success: false, error: `Módulos: ${MODULES.join(', ')}.` };
    if (typeof a.activo !== 'boolean') return { success: false, error: '¿Lo activo o lo oculto?' };
    const { data: b } = await db.from('businesses').select('modules').eq('id', ctx.businessId).maybeSingle();
    const mods = { ...(b?.modules || {}) };
    const before = mods[key] !== false;
    if (before === a.activo) return { success: false, error: `El módulo ${key} ya está ${a.activo ? 'visible' : 'oculto'}.` };
    return savePending(ctx, 'modulo', R(`${a.activo ? 'Mostrar' : 'Ocultar'} el módulo ${key} en el menú del panel (${before ? 'visible' : 'oculto'} → ${a.activo ? 'visible' : 'oculto'}). ¿Confirmas?`), { risk: 'R', modulo: key, before, after: a.activo, label: `módulo ${key}` });
  }
  async function executeModule(p, action, ctx) {
    const { data: b } = await db.from('businesses').select('modules').eq('id', ctx.businessId).maybeSingle();
    const modules = { ...(b?.modules || {}), [p.modulo]: p.after };
    const r = await ok(ctl.businesses.updateModules, { body: { modules } }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const { data } = await db.from('businesses').select('modules').eq('id', ctx.businessId).maybeSingle();
    const got = data?.modules?.[p.modulo] !== false;
    return { ok: got === p.after, result: { antes: p.before, despues_leido: got }, message: `módulo ${p.modulo}: ${got ? 'visible' : 'oculto'}`, error: 'el módulo no quedó como se esperaba.' };
  }
  const inverseModule = async (action) => ({ summary: `Deshacer: módulo ${action.plan.modulo} vuelve a ${action.plan.before ? 'visible' : 'oculto'}.`, plan: { ...action.plan, kind: 'modulo', risk: undefined, before: action.plan.after, after: action.plan.before } });

  async function prepareNotify(a, ctx) {
    if (typeof a.activo !== 'boolean') return { success: false, error: '¿Activo o desactivo las notificaciones de WhatsApp?' };
    const { data: b } = await db.from('businesses').select('whatsapp_notify').eq('id', ctx.businessId).maybeSingle();
    const before = !!b?.whatsapp_notify;
    if (before === a.activo) return { success: false, error: `Las notificaciones de WhatsApp ya están ${a.activo ? 'activas' : 'apagadas'}.` };
    return savePending(ctx, 'notificaciones', R(`${a.activo ? 'Activar' : 'Apagar'} las notificaciones de WhatsApp al dueño (${before ? 'activas' : 'apagadas'} → ${a.activo ? 'activas' : 'apagadas'}). ¿Confirmas?`), { risk: 'R', before, after: a.activo, label: 'notificaciones WhatsApp' });
  }
  async function executeNotify(p, action, ctx) {
    const r = await ok(ctl.settings.updateWhatsappNotify, { body: { whatsapp_notify: p.after } }, ctx);
    if (r.error) return { ok: false, error: r.error };
    const { data } = await db.from('businesses').select('whatsapp_notify').eq('id', ctx.businessId).maybeSingle();
    return { ok: !!data?.whatsapp_notify === p.after, result: { antes: p.before, despues_leido: !!data?.whatsapp_notify }, message: `notificaciones de WhatsApp: ${data?.whatsapp_notify ? 'activas' : 'apagadas'}`, error: 'no quedó como se esperaba.' };
  }
  const inverseNotify = async (action) => ({ summary: `Deshacer: notificaciones de WhatsApp ${action.plan.before ? 'activas' : 'apagadas'} otra vez.`, plan: { ...action.plan, kind: 'notificaciones', risk: undefined, before: action.plan.after, after: action.plan.before } });

  // ── Reportes (lectura curada, acotada al negocio) ───────────────────────────
  // Rango de fechas de un período (mes_pasado además de los de periodRange)
  function rangeOf(periodo) {
    if (periodo === 'mes_pasado') {
      const d = new Date(`${today().slice(0, 7)}-15T12:00:00-05:00`); d.setMonth(d.getMonth() - 1);
      const ym = dayISO(d).slice(0, 7);
      const last = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
      return { desde: `${ym}-01`, hasta: `${ym}-${String(last).padStart(2, '0')}` };
    }
    return lib.periodRange(periodo || 'mes');
  }
  async function ordersIn(ctx, periodo) {
    const r = rangeOf(periodo);
    const rows = await lib.loadOrders(ctx.businessId, { desde: r.desde, hasta: r.hasta, select: 'id, status, created_at, order_items(product_id, variant_id, description, quantity, unit_price, bundle_snapshot)' });
    return { range: r, orders: rows.filter((o) => o.status !== 'cancelado') };
  }
  const PERIOD_TXT = { hoy: 'hoy', ayer: 'ayer', semana: 'en los últimos 7 días', mes: 'este mes', mes_pasado: 'el mes pasado', anio: 'este año', todo: 'desde el inicio' };

  async function runProductSales(c, ctx) {
    if (!c.producto) return { text: '¿De qué producto o set?' };
    const products = await lib.loadProducts(ctx.businessId, { includeInactive: true });
    const hits = lib.matchProducts(products, c.producto);
    if (!hits.length) return { text: `No encontré un producto o set «${text(c.producto, 40)}».` };
    if (hits.length > 1 && !c.todos) return { question: ask('producto', `Hay ${hits.length} con «${text(c.producto, 30)}». ¿Cuál?`, hits.slice(0, 10).map((p) => ({ label: p.name, value: `id:${p.id}` }))), consulta: c };
    const ids = new Set(hits.map((p) => p.id));
    const periodo = c.periodo || 'mes';
    const { orders } = await ordersIn(ctx, periodo);
    const byVar = {}; let units = 0; let revenue = 0; let n = 0;
    for (const o of orders) {
      let inOrder = false;
      for (const i of o.order_items || []) {
        if (!ids.has(i.product_id)) continue;
        inOrder = true;
        units += Number(i.quantity || 0); revenue += Number(i.quantity || 0) * Number(i.unit_price || 0);
        byVar[i.description] = (byVar[i.description] || 0) + Number(i.quantity || 0);
      }
      if (inOrder) n += 1;
    }
    const name = hits.length === 1 ? hits[0].name : `«${c.producto}»`;
    if (!units) return { text: `${name}: sin ventas ${PERIOD_TXT[periodo] || ''}.` };
    const top = Object.entries(byVar).sort((x, y) => y[1] - x[1]).slice(0, 6);
    return { text: `📦 ${name} ${PERIOD_TXT[periodo] || ''}: ${units} unidad${units === 1 ? '' : 'es'} en ${n} pedido${n === 1 ? '' : 's'}, ${cop(revenue)} (antes de descuentos y envío).${top.length > 1 ? `\n${top.map(([d, q]) => `• ${d}: ${q}`).join('\n')}` : ''}` };
  }

  async function runMarginByCategory(c, ctx) {
    const periodo = c.periodo || 'mes';
    const products = await lib.loadProducts(ctx.businessId, { includeInactive: true });
    const byId = Object.fromEntries(products.map((p) => [p.id, p]));
    const { orders } = await ordersIn(ctx, periodo);
    const acc = {};
    let sinCosto = 0;
    for (const o of orders) for (const i of o.order_items || []) {
      const p = byId[i.product_id];
      const cat = p?.is_bundle ? 'Sets' : (p?.category || 'Sin categoría');
      const qty = Number(i.quantity || 0);
      let cost = null;
      if (i.bundle_snapshot) { const s = snapshotCost(i.bundle_snapshot, qty); cost = s.hasCost ? s.cost : null; } else if (p?.cost_price != null) cost = Number(p.cost_price) * qty;
      acc[cat] = acc[cat] || { ventas: 0, costo: 0, sin: 0 };
      acc[cat].ventas += qty * Number(i.unit_price || 0);
      if (cost === null) { acc[cat].sin += 1; sinCosto += 1; } else acc[cat].costo += cost;
    }
    const rows = Object.entries(acc).sort((x, y) => y[1].ventas - x[1].ventas);
    if (!rows.length) return { text: `Sin ventas ${PERIOD_TXT[periodo] || ''}.` };
    return { text: `📊 Margen por categoría ${PERIOD_TXT[periodo] || ''} (precio de lista menos costo cargado; sin descuentos ni envío):\n${rows.map(([k, v]) => `• ${k}: ventas ${cop(v.ventas)}, costo ${cop(v.costo)} → margen ${v.ventas ? Math.round(((v.ventas - v.costo) / v.ventas) * 100) : 0}%${v.sin ? ` (${v.sin} línea${v.sin === 1 ? '' : 's'} sin costo)` : ''}`).join('\n')}${sinCosto ? '\nLas líneas sin costo cargado cuentan con costo 0: cárgalo con «cambia el costo de X a N».' : ''}` };
  }

  async function runInventoryValue(c, ctx) {
    const products = (await lib.loadProducts(ctx.businessId)).filter((p) => !p.is_bundle);
    const acc = {}; let units = 0; let atCost = 0; let atPrice = 0; let sin = 0;
    for (const p of products) {
      const s = Math.max(Number(p.stock) || 0, 0);
      const cat = p.category || 'Sin categoría';
      acc[cat] = acc[cat] || { unidades: 0, costo: 0, venta: 0 };
      acc[cat].unidades += s; acc[cat].venta += s * Number(p.price || 0);
      units += s; atPrice += s * Number(p.price || 0);
      if (p.cost_price == null) { if (s) sin += 1; } else { acc[cat].costo += s * Number(p.cost_price); atCost += s * Number(p.cost_price); }
    }
    return { text: `🏷️ Inventario activo: ${units} unidades · a costo ${cop(atCost)} · a precio de venta ${cop(atPrice)}.\n${Object.entries(acc).sort((x, y) => y[1].venta - x[1].venta).map(([k, v]) => `• ${k}: ${v.unidades} u, costo ${cop(v.costo)}, venta ${cop(v.venta)}`).join('\n')}${sin ? `\n${sin} producto${sin === 1 ? '' : 's'} con stock no tienen costo cargado.` : ''}` };
  }

  async function runMovements(c, ctx) {
    if (!c.producto) return { text: '¿De qué producto quieres ver el historial?' };
    const r = await productByName(ctx, c.producto);
    if (r.needs) return { question: r.needs, consulta: c };
    if (r.error) return { text: r.error };
    const res = await ok(ctl.products.getHistory, { query: { product_id: r.product.id, limit: '10' } }, ctx);
    if (res.error) return { text: `⚠️ ${res.error}` };
    const rows = res.body?.data || [];
    if (!rows.length) return { text: `${r.product.name}: sin movimientos de inventario.` };
    return { text: `🗂️ Últimos movimientos de ${r.product.name}:\n${rows.map((m) => `• ${dateLabel(dayISO(new Date(m.created_at)))} ${m.quantity_change > 0 ? '+' : ''}${m.quantity_change}${m.variant ? ` (${lib.variantLabel(m.variant)})` : ''} → quedó ${m.stock_after} · ${m.origen}${m.pedido ? ` ${m.pedido}` : ''}`).join('\n')}` };
  }

  // ── Fuera de alcance (respuesta del servidor; el modelo solo elige el tema) ──
  const OUT_OF_SCOPE = {
    fotos: 'Las fotos no las puedo subir por chat: se suben en el panel, en Productos → editar el producto → Fotos (o Fotos por color).',
    whatsapp: 'La conexión y los tokens de WhatsApp no los toco por seguridad: se cambian en Configuración → WhatsApp.',
    plan: 'El plan, los pagos y la facturación de ZITA están en el panel, en Mi suscripción.',
    contrasena: 'La contraseña no la manejo por seguridad: se cambia desde el inicio de sesión («¿Olvidaste tu contraseña?»).',
    tienda_config: 'El envío, los métodos de pago y los textos de la tienda en línea no se cambian desde el panel: se ajustan con ayuda del desarrollador.',
    exportar: 'El PDF y el Excel de Caja se descargan en el panel, en Caja → Exportar.',
    usuarios: 'El panel no tiene usuarios ni roles aparte: cada negocio entra con su cuenta. Para tu equipo de ventas usa Empleados.',
  };
  const WHERE = { caja: 'Caja', analiticas: 'Analíticas', pedidos: 'Pedidos', productos: 'Productos (Inventario)', clientes: 'Clientes', inicio: 'Inicio' };
  function outOfScope(tema, donde) {
    if (tema === 'sin_consulta') return `Todavía no tengo una consulta para eso y prefiero no inventar. Puedes verlo en el panel, en ${WHERE[donde] || 'Analíticas'}.`;
    return OUT_OF_SCOPE[tema] || null;
  }

  // ── Registro ────────────────────────────────────────────────────────────────
  const A = (name, domain, risk, feature, desc, prepare, execute, inverse) => ({ name, domain, risk, feature, desc, type: 'action', prepare, execute, inverse });
  const Q = (name, domain, feature, desc, run) => ({ name, domain, risk: 'L', feature, desc, type: 'query', run });
  const list = [
    A('registrar_ingreso', 'caja', 'N', null, 'entró plata a Caja', prepareMovement('ingreso'), executeMovement('ingreso'), inverseCreateMovement),
    A('registrar_egreso', 'caja', 'N', null, 'gasto / salió plata', prepareMovement('egreso'), executeMovement('egreso'), inverseCreateMovement),
    A('editar_movimiento', 'caja', 'R', null, 'corregir un ingreso/egreso manual', prepareEditMovement, executeEditMovement, inverseEditMovement),
    A('anular_movimiento', 'caja', 'R', null, 'borrar un ingreso/egreso manual', prepareDeleteMovement, executeDeleteMovement, inverseDeleteMovement),
    A('meta_mensual', 'caja', 'N', null, 'poner la meta de ingresos del mes', prepareGoal, executeGoal, inverseGoal),
    Q('caja_resumen', 'caja', null, 'cuánto hay en caja / neto / ganancia de un período', runCashSummary),
    Q('caja_movimientos', 'caja', null, 'cuánto gasté/entró en X (lista)', runCashMovements),
    Q('meta_progreso', 'caja', null, 'cómo voy con la meta', runGoal),
    A('pago_pedido', 'pedidos', 'N', null, 'marcar pagado/pendiente un pedido', preparePayment, executePayment, inversePayment),
    A('envio_pedido', 'pedidos', 'N', null, 'transportadora / guía de un pedido', prepareShipping, executeShipping, inverseShipping),
    A('descuento_pedido', 'pedidos', 'N', null, 'cambiar el descuento de un pedido ya creado', prepareOrderDiscount, executeOrderDiscount, inverseOrderDiscount),
    A('eliminar_pedido', 'pedidos', 'R', null, 'borrar del todo un pedido', prepareDeleteOrder, executeDeleteOrder, null),
    A('crear_producto', 'productos', 'N', 'productos', 'crear un producto nuevo (con variantes y stock)', prepareCreateProduct, executeCreateProduct, inverseCreateProduct),
    A('editar_producto', 'productos', 'N', 'productos', 'cambiar costo, nombre, categoría, género, descripción o stock mínimo', prepareEditProduct, executeEditProduct, inverseEditProduct),
    A('eliminar_producto', 'productos', 'R', 'productos', 'borrar del todo un producto o set', prepareDeleteProduct, executeDeleteProduct, null),
    A('editar_variante', 'productos', 'N', 'productos', 'cambiar color, talla, SKU o stock mínimo de una variante', prepareEditVariant, executeEditVariant, inverseEditVariant),
    A('eliminar_variante', 'productos', 'R', 'productos', 'borrar del todo una variante', prepareDeleteVariant, executeDeleteVariant, null),
    Q('historial_producto', 'productos', 'productos', 'movimientos de inventario de un producto', runMovements),
    A('crear_set', 'sets', 'N', 'productos', 'armar un set nuevo', prepareCreateSet, executeCreateSet, inverseCreateSet),
    A('editar_set', 'sets', 'N', 'productos', 'cambiar precio, nombre o piezas de un set', prepareEditSet, executeEditSet, inverseEditSet),
    A('crear_cliente', 'clientes', 'N', 'clientes', 'agregar un cliente', prepareCreateClient, executeCreateClient, inverseCreateClient),
    A('editar_cliente', 'clientes', 'N', 'clientes', 'cambiar datos de un cliente', prepareEditClient, executeEditClient, inverseEditClient),
    A('eliminar_cliente', 'clientes', 'R', 'clientes', 'borrar un cliente', prepareDeleteClient, executeDeleteClient, null),
    A('recordar_cliente', 'clientes', 'R', 'clientes', 'enviar por WhatsApp el mensaje de volver a comprar', prepareRecall, executeRecall, null),
    Q('cliente_info', 'clientes', 'clientes', 'datos y compras de un cliente', runClientInfo),
    Q('clientes_inactivos', 'clientes', null, 'clientes que no han vuelto a comprar', runInactiveClients),
    A('crear_empleado', 'equipo', 'N', 'empleados', 'agregar un empleado', prepareCreateEmployee, executeCreateEmployee, inverseCreateEmployee),
    A('editar_empleado', 'equipo', 'N', 'empleados', 'cambiar datos o activar/desactivar un empleado', prepareEditEmployee, executeEditEmployee, inverseEditEmployee),
    A('eliminar_empleado', 'equipo', 'R', 'empleados', 'borrar un empleado', prepareDeleteEmployee, executeDeleteEmployee, null),
    Q('empleados', 'equipo', 'empleados', 'lista del equipo', runEmployees),
    A('editar_perfil', 'config', 'R', 'configuracion', 'nombre, dueño, teléfono o dirección del negocio', prepareProfile, executeProfile, inverseProfile),
    A('modulo', 'config', 'R', 'configuracion', 'mostrar/ocultar un módulo del menú', prepareModule, executeModule, inverseModule),
    A('notificaciones', 'config', 'R', 'configuracion', 'activar/apagar notificaciones de WhatsApp al dueño', prepareNotify, executeNotify, inverseNotify),
    Q('ventas_producto', 'reportes', null, 'cuánto se vendió de un producto o set', runProductSales),
    Q('margen_categoria', 'reportes', null, 'margen por categoría', runMarginByCategory),
    Q('valor_inventario', 'reportes', null, 'cuánto vale el inventario', runInventoryValue),
  ];
  const byName = Object.fromEntries(list.map((c) => [c.name, c]));

  const blocked = (c, ctx) => (hasFeature(ctx, c.feature) ? null : `Esa función no está en tu plan (${planOf(ctx)}). Puedes mejorarlo en Mi suscripción.`);

  return {
    list,
    has: (name) => Object.prototype.hasOwnProperty.call(byName, name),
    get: (name) => byName[name],
    isAction: (name) => byName[name]?.type === 'action',
    isQuery: (name) => byName[name]?.type === 'query',
    async prepare(name, input, ctx) {
      const c = byName[name];
      const b = blocked(c, ctx);
      if (b) return { success: false, error: b };
      return c.prepare(input || {}, ctx);
    },
    async run(name, input, ctx) {
      const c = byName[name];
      const b = blocked(c, ctx);
      if (b) return { text: b };
      return c.run(input || {}, ctx);
    },
    async execute(kind, action, ctx) {
      const c = byName[kind];
      if (!c || c.type !== 'action') return { ok: false, error: 'tipo de acción desconocido.' };
      const b = blocked(c, ctx);
      if (b) return { ok: false, error: b };
      return c.execute(action.plan || {}, action, ctx);
    },
    async inverse(action, ctx) {
      const kind = action.kind;
      const c = byName[kind];
      if (!c?.inverse) return { error: c ? 'Esa acción no se puede deshacer (era irreversible).' : 'Esa acción no se puede deshacer automáticamente.' };
      return c.inverse({ ...action, business_id: ctx.businessId }, ctx);
    },
    outOfScope,
    constants: { RECALL_COOLDOWN_DAYS, RECALL_MAX_PER_DAY },
  };
}

module.exports = { createCapabilities };
