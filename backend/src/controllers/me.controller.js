// Panel del empleado (barbero). TODO lo que se lee o escribe sale de req.businessId y req.employeeId,
// que resuelve businessContext desde el token. Nunca se toman del body ni del query.
// Se usa el cliente admin (la RLS es la del dueño) con filtros explícitos por negocio/empleado.
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { PLANS } = require('../config/plans');
const { getTimezone, getOffsetForTz } = require('../utils/timezone');
const { changeAppointmentStatus } = require('../services/appointmentStatus');
const { sellProduct } = require('../services/productSale');
const { computeEmployeeCommissions } = require('../utils/commissions');
const { isTiendaBusiness } = require('../utils/businessType');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const serverError = (res) => res.status(500).json({ success: false, error: 'Error interno del servidor.' });

// ── Módulos del panel del empleado ───────────────────────────────
// agenda: citas (no en tiendas) · clientes y productos: según plan y módulos activos · comisiones: con agenda
async function loadModules(businessId) {
  const { data } = await supabaseAdmin.from('businesses').select('modules').eq('id', businessId).maybeSingle();
  return data?.modules && typeof data.modules === 'object' ? data.modules : null;
}

function employeeModules(business, modules) {
  const features = PLANS[business?.plan]?.features || PLANS.estandar.features;
  const on = (key) => !modules || modules[key] !== false;
  const agenda = features.includes('citas') && on('citas') && !isTiendaBusiness(business);
  const out = [];
  if (agenda) out.push('agenda');
  if (features.includes('clientes') && on('clientes')) out.push('clientes');
  if (features.includes('productos') && on('productos')) out.push('productos');
  if (agenda) out.push('comisiones');
  return out;
}

// Middleware: el módulo debe estar habilitado para el negocio (plan + módulos que activó el dueño)
function requireModule(key) {
  return async (req, res, next) => {
    try {
      if (req.employeeModules === undefined) {
        req.employeeModules = employeeModules(req.business, await loadModules(req.businessId));
      }
      if (req.employeeModules.includes(key)) return next();
      return res.status(403).json({ success: false, error: 'Este módulo no está disponible.', code: 'MODULE_DISABLED' });
    } catch (err) {
      logger.error(`me.requireModule: ${err.message}`);
      return serverError(res);
    }
  };
}

// GET /api/me — dueño o empleado
async function getMe(req, res) {
  try {
    const b = req.business || {};
    const business = { id: b.id, name: b.name, business_type: b.business_type, country: b.country };
    if (req.role === 'owner') {
      return res.json({ success: true, data: { role: 'owner', business, employee: null, allowed_modules: null } });
    }
    const modules = await loadModules(req.businessId);
    return res.json({
      success: true,
      data: { role: 'employee', business, employee: req.employee, allowed_modules: employeeModules(b, modules) },
    });
  } catch (err) {
    logger.error(`me.getMe: ${err.message}`);
    return serverError(res);
  }
}

// ── Citas ────────────────────────────────────────────────────────
const APPT_FIELDS = 'id, scheduled_at, status, source, price, notes, client_id, service_id, clients(id, name, phone), services(id, name, duration_minutes)';

function dayBounds(date, country) {
  const offset = getOffsetForTz(getTimezone(country));
  return { start: `${date}T00:00:00${offset}`, end: `${date}T23:59:59${offset}` };
}

// GET /api/me/appointments?date=YYYY-MM-DD | ?from=YYYY-MM-DD&to=YYYY-MM-DD (máx. 31 días)
async function listAppointments(req, res) {
  try {
    const tz = getTimezone(req.business?.country);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    let from = req.query.from; let to = req.query.to;
    if (req.query.date !== undefined) { from = req.query.date; to = req.query.date; }
    if (from === undefined && to === undefined) { from = today; to = today; }
    if (!DATE_RE.test(String(from)) || !DATE_RE.test(String(to)) || from > to) {
      return res.status(400).json({ success: false, error: 'Fechas inválidas (usa YYYY-MM-DD).' });
    }
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
    if (!Number.isFinite(days) || days > 31) {
      return res.status(400).json({ success: false, error: 'El rango máximo es de 31 días.' });
    }

    const { data, error } = await supabaseAdmin
      .from('appointments')
      .select(APPT_FIELDS)
      .eq('business_id', req.businessId)
      .eq('employee_id', req.employeeId)
      .gte('scheduled_at', dayBounds(from, req.business?.country).start)
      .lte('scheduled_at', dayBounds(to, req.business?.country).end)
      .order('scheduled_at')
      .limit(500);
    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`me.listAppointments: ${err.message}`);
    return serverError(res);
  }
}

// Límite mensual de citas del plan (mismo criterio que appointments.create del dueño)
async function monthlyLimitReached(businessId, plan, country) {
  const limite = PLANS[plan || 'estandar']?.max_appointments_month;
  if (limite === undefined || limite === -1) return false;
  const tz = getTimezone(country);
  const off = getOffsetForTz(tz);
  const mes = new Date().toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 7);
  const [yr, mo] = mes.split('-').map(Number);
  const ultimo = new Date(yr, mo, 0).getDate();
  const { count } = await supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .gte('scheduled_at', `${mes}-01T00:00:00${off}`)
    .lte('scheduled_at', `${mes}-${String(ultimo).padStart(2, '0')}T23:59:59${off}`)
    .neq('status', 'cancelled');
  return (count || 0) >= limite;
}

const SCHEDULED_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

// POST /api/me/appointments — la cita queda SIEMPRE asignada al empleado del token
async function createAppointment(req, res) {
  try {
    const { client_id, service_id, scheduled_at, notes } = req.body || {};

    if (!isUuid(service_id) || typeof scheduled_at !== 'string' || !SCHEDULED_RE.test(scheduled_at)) {
      return res.status(400).json({ success: false, error: 'Servicio y fecha/hora son obligatorios.' });
    }
    if (client_id != null && client_id !== '' && !isUuid(client_id)) {
      return res.status(400).json({ success: false, error: 'Cliente inválido.' });
    }
    if (notes != null && (typeof notes !== 'string' || notes.length > 500)) {
      return res.status(400).json({ success: false, error: 'Las notas deben tener máximo 500 caracteres.' });
    }
    const hasTz = /(Z|[+-]\d{2}:\d{2})$/.test(scheduled_at);
    const scheduledAt = hasTz ? scheduled_at : `${scheduled_at.length === 16 ? `${scheduled_at}:00` : scheduled_at}${getOffsetForTz(getTimezone(req.business?.country))}`;
    if (Number.isNaN(Date.parse(scheduledAt))) {
      return res.status(400).json({ success: false, error: 'Fecha/hora inválida.' });
    }

    const { data: service } = await supabaseAdmin
      .from('services').select('id, price, active')
      .eq('id', service_id).eq('business_id', req.businessId).maybeSingle();
    if (!service || service.active === false) {
      return res.status(400).json({ success: false, error: 'Servicio no encontrado.' });
    }

    if (client_id) {
      const { data: client } = await supabaseAdmin
        .from('clients').select('id')
        .eq('id', client_id).eq('business_id', req.businessId).maybeSingle();
      if (!client) return res.status(400).json({ success: false, error: 'Cliente no encontrado.' });
    }

    if (await monthlyLimitReached(req.businessId, req.business?.plan, req.business?.country)) {
      return res.status(403).json({ success: false, error: 'El negocio alcanzó el límite de citas del mes de su plan.', code: 'APPOINTMENTS_LIMIT_REACHED' });
    }

    const { data, error } = await supabaseAdmin
      .from('appointments')
      .insert({
        business_id: req.businessId,
        employee_id: req.employeeId,
        client_id: client_id || null,
        service_id,
        scheduled_at: scheduledAt,
        price: service.price,
        notes: notes ? notes.trim() : null,
        is_reward: false,
        source: 'manual',
        status: 'confirmed',
      })
      .select(APPT_FIELDS)
      .single();

    if (error && (error.code === '23505' || error.code === '23P01')) {
      return res.status(409).json({ success: false, error: 'Ya tienes una cita que se cruza con ese horario. Elige otra hora.' });
    }
    if (error) throw error;

    await supabaseAdmin.from('employees')
      .update({ last_appointment_at: new Date().toISOString() })
      .eq('id', req.employeeId).eq('business_id', req.businessId);

    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`me.createAppointment: ${err.message}`);
    return serverError(res);
  }
}

function statusHandler(status, label) {
  return async (req, res) => {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ success: false, error: 'No encontrado' });
      const result = await changeAppointmentStatus({
        db: supabaseAdmin,
        businessId: req.businessId,
        employeeId: req.employeeId,
        appointmentId: req.params.id,
        status,
        allowedFrom: ['pending', 'confirmed'],
        country: req.business?.country,
      });
      if (result.status === 404) return res.status(404).json({ success: false, error: 'No encontrado' });
      if (result.status === 409) {
        const error = result.reason === 'invalid_transition'
          ? `Esta cita ya está ${result.current === 'completed' ? 'completada' : 'cancelada'}.`
          : 'Esta cita fue modificada por otro proceso. Refresca para ver el estado actual.';
        return res.status(409).json({ success: false, error });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      logger.error(`me.${label}: ${err.message}`);
      return serverError(res);
    }
  };
}

// POST /api/me/appointments/:id/complete | /cancel — solo citas propias, pendientes o confirmadas
const completeAppointment = statusHandler('completed', 'completeAppointment');
const cancelAppointment = statusHandler('cancelled', 'cancelAppointment');

// GET /api/me/services — solo lectura, para agendar
async function listServices(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('services')
      .select('id, name, duration_minutes, price')
      .eq('business_id', req.businessId)
      .eq('active', true)
      .order('name');
    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`me.listServices: ${err.message}`);
    return serverError(res);
  }
}

// ── Clientes ─────────────────────────────────────────────────────
// GET /api/me/clients?search= — sin archivados
async function listClients(req, res) {
  try {
    // Solo letras, números, espacios y signos de teléfono: el texto va dentro de un filtro .or() de PostgREST
    const search = String(req.query.search || '').normalize('NFC').replace(/[^\p{L}\p{N} +]/gu, '').trim().slice(0, 60);
    let q = supabaseAdmin
      .from('clients')
      .select('id, name, phone, email')
      .eq('business_id', req.businessId)
      .eq('archived', false);
    if (search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    const { data, error } = await q.order('name').limit(300);
    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`me.listClients: ${err.message}`);
    return serverError(res);
  }
}

const capitalizeName = (str) => str.trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/me/clients — mismas reglas que el alta del dueño (nombre y teléfono obligatorios)
async function createClient(req, res) {
  try {
    const { name, phone, email } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
      return res.status(400).json({ success: false, error: 'El nombre es obligatorio (máximo 120 caracteres).' });
    }
    if (typeof phone !== 'string' || !phone.trim()) {
      return res.status(400).json({ success: false, error: 'El teléfono es obligatorio.' });
    }
    let normalizedPhone = phone.trim();
    if (normalizedPhone.startsWith('+57')) normalizedPhone = normalizedPhone.slice(3);
    else if (normalizedPhone.startsWith('57') && normalizedPhone.length > 10) normalizedPhone = normalizedPhone.slice(2);
    normalizedPhone = normalizedPhone.replace(/[\s-]/g, '');
    if (!/^\+?\d{7,15}$/.test(normalizedPhone)) {
      return res.status(400).json({ success: false, error: 'Teléfono inválido.' });
    }
    let cleanEmail = null;
    if (email != null && email !== '') {
      if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email.trim())) {
        return res.status(400).json({ success: false, error: 'Correo inválido.' });
      }
      cleanEmail = email.trim().toLowerCase();
    }

    const { data, error } = await supabaseAdmin
      .from('clients')
      .insert({ business_id: req.businessId, name: capitalizeName(name).replace(/[<>]/g, ''), phone: normalizedPhone, email: cleanEmail })
      .select('id, name, phone, email')
      .single();
    if (error?.code === '23505') {
      return res.status(409).json({ success: false, error: 'Ya existe un cliente con ese teléfono.' });
    }
    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`me.createClient: ${err.message}`);
    return serverError(res);
  }
}

// ── Productos ────────────────────────────────────────────────────
// GET /api/me/products — activos y no-sets, SIN costo ni márgenes
async function listProducts(req, res) {
  try {
    const { data: products, error } = await supabaseAdmin
      .from('products')
      .select('id, name, price, stock, category, image_url, has_variants, is_bundle')
      .eq('business_id', req.businessId)
      .eq('is_active', true)
      .eq('is_bundle', false)
      .order('name');
    if (error) throw error;

    const withVariants = (products || []).filter((p) => p.has_variants).map((p) => p.id);
    let variants = [];
    if (withVariants.length) {
      const { data: vs, error: vErr } = await supabaseAdmin
        .from('product_variants')
        .select('id, product_id, attributes, stock')
        .eq('business_id', req.businessId)
        .eq('is_active', true)
        .in('product_id', withVariants);
      if (vErr) throw vErr;
      variants = vs || [];
    }

    // Se arma la respuesta campo por campo: nunca sale cost_price ni nada derivado del costo
    const data = (products || []).map((p) => ({
      id: p.id, name: p.name, price: p.price, stock: p.stock, category: p.category ?? null,
      image_url: p.image_url ?? null, has_variants: !!p.has_variants,
      variants: p.has_variants
        ? variants.filter((v) => v.product_id === p.id).map((v) => ({ id: v.id, attributes: v.attributes || {}, stock: v.stock }))
        : [],
    }));
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`me.listProducts: ${err.message}`);
    return serverError(res);
  }
}

// POST /api/me/products/:id/sell — venta presencial registrada por el empleado (sin comisión)
async function sell(req, res) {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    const { quantity, variant_id, client_id, appointment_id } = req.body || {};
    const result = await sellProduct({
      db: supabaseAdmin,
      businessId: req.businessId,
      productId: req.params.id,
      country: req.business?.country,
      userId: req.user?.id,
      soldByEmployeeId: req.employeeId,
    }, { quantity, variant_id, client_id, appointment_id, sold_via: 'presencial' });
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error(`me.sell: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error al registrar la venta.' });
  }
}

// ── Comisiones ───────────────────────────────────────────────────
// GET /api/me/commissions?month=YYYY-MM — solo las del empleado del token
async function commissions(req, res) {
  try {
    const country = req.business?.country;
    const tz = getTimezone(country);
    const off = getOffsetForTz(tz);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const month = req.query.month === undefined ? today.slice(0, 7) : String(req.query.month);
    if (!MONTH_RE.test(month)) return res.status(400).json({ success: false, error: 'Mes inválido (usa YYYY-MM).' });
    const [y, m] = month.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();

    const { data: employee, error: eErr } = await supabaseAdmin
      .from('employees').select('id, name, commission_percent')
      .eq('id', req.employeeId).eq('business_id', req.businessId).maybeSingle();
    if (eErr) throw eErr;
    if (!employee) return res.status(404).json({ success: false, error: 'No encontrado' });

    const base = () => supabaseAdmin
      .from('appointments')
      .select('id, price, employee_id')
      .eq('business_id', req.businessId)
      .eq('employee_id', req.employeeId)
      .eq('status', 'completed');

    const [{ data: periodAppts, error: pErr }, { data: todayAppts, error: tErr }] = await Promise.all([
      base().gte('scheduled_at', `${month}-01T00:00:00${off}`).lte('scheduled_at', `${month}-${String(last).padStart(2, '0')}T23:59:59${off}`),
      base().gte('scheduled_at', `${today}T00:00:00${off}`).lte('scheduled_at', `${today}T23:59:59${off}`),
    ]);
    if (pErr) throw pErr;
    if (tErr) throw tErr;

    const mine = computeEmployeeCommissions([employee], periodAppts, todayAppts)[employee.id];
    return res.json({
      success: true,
      data: {
        month,
        commission_percent: mine.commission_percent,
        period: { appointments: mine.count, income: mine.income, commission: mine.commission_period },
        today: { appointments: (todayAppts || []).length, commission: mine.commission_today },
      },
    });
  } catch (err) {
    logger.error(`me.commissions: ${err.message}`);
    return serverError(res);
  }
}

module.exports = {
  getMe, listAppointments, createAppointment, completeAppointment, cancelAppointment, listServices,
  listClients, createClient, listProducts, sell, commissions, requireModule, employeeModules,
};
