// Módulo único de disponibilidad de citas. Lo usan el bot de WhatsApp, el asistente y el panel.
//
// Reglas:
//  - Dos citas del mismo empleado chocan si sus intervalos [inicio, inicio + duración) se cruzan
//    (no basta con comparar la hora de inicio): inicioA < finB && inicioB < finA.
//  - La duración de una cita es la de su servicio (30 min si no tiene).
//  - Las horas que entran y salen son hora local de Colombia (America/Bogota, UTC-5 fijo, sin horario de verano).
//    Nunca se parte un timestamptz de la BD con split('T'): eso da la hora UTC.

const { supabaseAdmin } = require('../config/supabase');

const TZ = 'America/Bogota';
const TZ_OFFSET = '-05:00';
const DEFAULT_DURATION = 30;
const SLOT_STEP_MIN = 30;
const ACTIVE_STATUSES = ['confirmed', 'pending'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidDate(fecha) {
  if (!DATE_RE.test(String(fecha || ''))) return false;
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function isValidTime(hora) { return TIME_RE.test(String(hora || '')); }

// Acepta "9:00", "09:00", "09:00:00" → "09:00" (o null si no es una hora válida)
function normalizeTime(hora) {
  const m = String(hora || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = m[1].padStart(2, '0');
  const t = `${h}:${m[2]}`;
  return isValidTime(t) ? t : null;
}

function toMinutes(hhmm) { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; }
function fromMinutes(min) { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }

// "2026-11-12" + "10:00" (hora local) → ISO con offset de Colombia
function localISO(fecha, hora) { return `${fecha}T${hora}:00${TZ_OFFSET}`; }
function toInstantMs(fecha, hora) { return new Date(localISO(fecha, hora)).getTime(); }

// timestamptz (cualquier offset) → { fecha: 'YYYY-MM-DD', hora: 'HH:mm' } en hora de Colombia
function localParts(value) {
  const d = value instanceof Date ? value : new Date(value);
  const fecha = d.toLocaleDateString('en-CA', { timeZone: TZ });
  const hora = d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return { fecha, hora };
}

function todayLocal() { return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); }

// Día de la semana (0 = domingo) de una fecha 'YYYY-MM-DD', sin depender de la zona del servidor
function dayOfWeek(fecha) { const [y, m, d] = fecha.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }

function overlaps(aStartMs, aDurMin, bStartMs, bDurMin) {
  return aStartMs < bStartMs + bDurMin * 60000 && bStartMs < aStartMs + aDurMin * 60000;
}

function durationOf(cita) {
  const d = Number(cita?.services?.duration_minutes);
  return Number.isFinite(d) && d > 0 ? d : DEFAULT_DURATION;
}

// Empleados ocupados en [startMs, startMs + durMin)
function busyEmployeeIds(citas, startMs, durMin, excludeAppointmentId = null) {
  return new Set((citas || [])
    .filter((c) => c.employee_id && c.id !== excludeAppointmentId)
    .filter((c) => overlaps(startMs, durMin, new Date(c.scheduled_at).getTime(), durationOf(c)))
    .map((c) => c.employee_id));
}

// Carga lo necesario para decidir disponibilidad en un día: horario, festivo, empleados activos y citas activas.
// Las citas se cargan desde 12 h antes del inicio del día para detectar las que empiezan antes y se extienden.
async function loadDay(businessId, fecha) {
  const startOfDay = new Date(localISO(fecha, '00:00')).getTime();
  const [{ data: horario }, { data: cerrado }, { data: empleados }, { data: citas }] = await Promise.all([
    supabaseAdmin.from('business_hours').select('open_time, close_time, is_open')
      .eq('business_id', businessId).eq('day_of_week', dayOfWeek(fecha)).maybeSingle(),
    supabaseAdmin.from('business_closed_days').select('reason')
      .eq('business_id', businessId).eq('date', fecha).maybeSingle(),
    supabaseAdmin.from('employees').select('id, name, last_appointment_at')
      .eq('business_id', businessId).eq('is_active', true),
    supabaseAdmin.from('appointments').select('id, employee_id, scheduled_at, services(duration_minutes)')
      .eq('business_id', businessId).in('status', ACTIVE_STATUSES)
      .gte('scheduled_at', new Date(startOfDay - 12 * 3600000).toISOString())
      .lte('scheduled_at', localISO(fecha, '23:59')),
  ]);
  return { fecha, horario: horario || null, cerrado: cerrado || null, empleados: empleados || [], citas: citas || [] };
}

// ¿La cita [hora, hora+dur) cabe en el horario del día? Devuelve el motivo si no.
function checkHours(day, hora, durMin) {
  if (day.cerrado) return { valid: false, reason: `Ese día estamos cerrados: ${day.cerrado.reason}. ¿Te agendo otro día?` };
  if (!day.horario?.is_open) return { valid: false, reason: 'Ese día estamos cerrados.' };
  const open = toMinutes(normalizeTime(day.horario.open_time));
  const close = toMinutes(normalizeTime(day.horario.close_time));
  const start = toMinutes(hora);
  if (start < open || start + durMin > close) {
    return { valid: false, reason: `Fuera de horario. Atendemos de ${normalizeTime(day.horario.open_time)} a ${normalizeTime(day.horario.close_time)}.` };
  }
  return { valid: true, open_time: day.horario.open_time, close_time: day.horario.close_time };
}

function freeEmployees(day, hora, durMin, { excludeAppointmentId = null } = {}) {
  const busy = busyEmployeeIds(day.citas, toInstantMs(day.fecha, hora), durMin, excludeAppointmentId);
  return day.empleados.filter((e) => !busy.has(e.id));
}

// Horas de inicio libres del día (pasos de 30 min) donde una cita de durMin cabe y algún empleado está libre.
// after: solo horas posteriores a esta (HH:mm). Nunca devuelve horas ya pasadas.
function freeSlots(day, durMin, { after = null, limit = Infinity, excludeAppointmentId = null, nowMs = Date.now() } = {}) {
  if (day.cerrado || !day.horario?.is_open) return [];
  const open = toMinutes(normalizeTime(day.horario.open_time));
  const close = toMinutes(normalizeTime(day.horario.close_time));
  const out = [];
  for (let m = open; m + durMin <= close && out.length < limit; m += SLOT_STEP_MIN) {
    const hora = fromMinutes(m);
    if (after && m <= toMinutes(after)) continue;
    if (toInstantMs(day.fecha, hora) <= nowMs) continue;
    if (freeEmployees(day, hora, durMin, { excludeAppointmentId }).length) out.push(hora);
  }
  return out;
}

function isEmployeeFree(day, employeeId, hora, durMin, { excludeAppointmentId = null } = {}) {
  return !busyEmployeeIds(day.citas, toInstantMs(day.fecha, hora), durMin, excludeAppointmentId).has(employeeId);
}

// Elige el empleado libre con menos carga (mes → día → hace más tiempo sin atender).
async function getAvailableEmployee(businessId, fecha, hora, durationMinutes = DEFAULT_DURATION, { excludeAppointmentId = null, day = null } = {}) {
  const d = day || await loadDay(businessId, fecha);
  const disponibles = freeEmployees(d, hora, durationMinutes || DEFAULT_DURATION, { excludeAppointmentId });
  if (!disponibles.length) return null;
  if (disponibles.length === 1) return disponibles[0];

  const { data: citasMes } = await supabaseAdmin
    .from('appointments')
    .select('employee_id')
    .eq('business_id', businessId)
    .in('status', ['confirmed', 'pending', 'completed'])
    .gte('scheduled_at', localISO(`${fecha.slice(0, 7)}-01`, '00:00'))
    .lte('scheduled_at', localISO(fecha, '23:59'));

  const conteoMes = {};
  (citasMes || []).forEach((c) => { if (c.employee_id) conteoMes[c.employee_id] = (conteoMes[c.employee_id] || 0) + 1; });
  const conteoHoy = {};
  d.citas.filter((c) => localParts(c.scheduled_at).fecha === fecha)
    .forEach((c) => { if (c.employee_id) conteoHoy[c.employee_id] = (conteoHoy[c.employee_id] || 0) + 1; });

  disponibles.sort((a, b) => {
    const mes = (conteoMes[a.id] || 0) - (conteoMes[b.id] || 0);
    if (mes) return mes;
    const hoy = (conteoHoy[a.id] || 0) - (conteoHoy[b.id] || 0);
    if (hoy) return hoy;
    return (a.last_appointment_at ? new Date(a.last_appointment_at) : new Date(0)) - (b.last_appointment_at ? new Date(b.last_appointment_at) : new Date(0));
  });
  return disponibles[0];
}

/**
 * Valida que una cita (fecha + hora + duración) quepa dentro del horario de atención del negocio ese día,
 * y que ese día no esté marcado como cerrado (festivo). La cita debe TERMINAR a más tardar al cierre.
 * @returns {Promise<{valid: boolean, reason?: string, open_time?: string, close_time?: string}>}
 */
async function isAppointmentWithinBusinessHours(businessId, fecha, hora, opts = {}) {
  if (!isValidDate(fecha)) return { valid: false, reason: 'Fecha inválida. Usa el formato YYYY-MM-DD.' };
  const h = normalizeTime(hora);
  if (!h) return { valid: false, reason: 'Hora inválida. Usa el formato HH:mm (24 horas).' };
  let duracion = opts.durationMinutes;
  if (duracion == null && opts.serviceId) {
    const { data } = await supabaseAdmin.from('services').select('duration_minutes').eq('id', opts.serviceId).maybeSingle();
    duracion = data?.duration_minutes;
  }
  const day = opts.day || await loadDay(businessId, fecha);
  return checkHours(day, h, duracion || DEFAULT_DURATION);
}

// Próximas horas libres a partir de fecha+hora (hasta 7 días). Usado por el panel cuando el horario pedido está lleno.
async function getNextAvailableSlots(businessId, fecha, hora, cantidad = 3, durationMinutes = DEFAULT_DURATION) {
  const slots = [];
  let f = fecha;
  for (let i = 0; i < 7 && slots.length < cantidad; i++) {
    const day = await loadDay(businessId, f);
    const libres = freeSlots(day, durationMinutes, { after: i === 0 ? hora : null, limit: cantidad - slots.length });
    for (const h of libres) {
      const emp = freeEmployees(day, h, durationMinutes)[0];
      slots.push({ fecha: f, hora: h, empleado_nombre: emp?.name || null });
    }
    const [y, m, d] = f.split('-').map(Number);
    f = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }
  return slots;
}

module.exports = {
  TZ, TZ_OFFSET, DEFAULT_DURATION, ACTIVE_STATUSES,
  isValidDate, isValidTime, normalizeTime, localISO, toInstantMs, localParts, todayLocal, dayOfWeek,
  overlaps, durationOf, busyEmployeeIds, loadDay, checkHours, freeEmployees, freeSlots, isEmployeeFree,
  getAvailableEmployee, isAppointmentWithinBusinessHours, getNextAvailableSlots,
};
