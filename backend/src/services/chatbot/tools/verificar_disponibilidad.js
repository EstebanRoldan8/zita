// Tool 'verificar_disponibilidad' del bot de WhatsApp (descripción y parámetros en ../prompt.js → BOT_TOOLS).
// ctx: { businessId, clientPhone, business, clientInfo, citaDelCliente, CITA_NO_ENCONTRADA }
const { loadDay, checkHours, freeEmployees, freeSlots, isValidDate, normalizeTime, toInstantMs, todayLocal, DEFAULT_DURATION, findService } = require('../shared');

module.exports = async function verificar_disponibilidad(toolInput, ctx) {
  const { businessId } = ctx;
  const fecha = String(toolInput.fecha || '').trim();
  if (!isValidDate(fecha)) return { disponible: false, error: 'fecha_invalida', mensaje: 'Fecha inválida. Usa YYYY-MM-DD.' };
  if (fecha < todayLocal()) return { disponible: false, mensaje: 'Esa fecha ya pasó.' };

  // La duración del servicio decide si la cita cabe (un servicio de 60 min no cabe en un hueco de 30)
  let durMin = DEFAULT_DURATION;
  let servicioUsado = null;
  if (toolInput.service_name) {
    const found = await findService(businessId, toolInput.service_name);
    if (found.servicio) { durMin = found.servicio.duration_minutes || DEFAULT_DURATION; servicioUsado = found.servicio.name; }
  }

  const day = await loadDay(businessId, fecha);
  if (day.cerrado) {
    return { disponible: false, cerrado: true, festivo: true, razon: day.cerrado.reason, mensaje: `Ese dia estamos cerrados: ${day.cerrado.reason}` };
  }
  if (!day.horario?.is_open) return { disponible: false, cerrado: true, mensaje: 'El negocio está cerrado ese día' };
  if (!day.empleados.length) return { disponible: false, mensaje: 'No hay empleados disponibles' };
  const horario = `${normalizeTime(day.horario.open_time)} a ${normalizeTime(day.horario.close_time)}`;

  if (toolInput.hora) {
    const hora = normalizeTime(toolInput.hora);
    if (!hora) return { disponible: false, error: 'hora_invalida', mensaje: 'Hora inválida. Usa HH:mm (24 horas).' };
    const fit = checkHours(day, hora, durMin);
    if (!fit.valid) return { disponible: false, fuera_horario: true, mensaje: fit.reason };
    if (toInstantMs(fecha, hora) <= Date.now()) {
      return { disponible: false, mensaje: 'Esa hora ya pasó.', slots_alternativos: freeSlots(day, durMin, { limit: 3 }) };
    }
    if (freeEmployees(day, hora, durMin).length) {
      return { disponible: true, fecha, hora, duracion_min: durMin, servicio: servicioUsado };
    }
    const alternativas = freeSlots(day, durMin, { after: hora, limit: 3 });
    return {
      disponible: false,
      slots_alternativos: alternativas,
      mensaje: alternativas.length ? `Ese horario está ocupado. Alternativas: ${alternativas.join(', ')}` : 'No quedan horarios libres ese día después de esa hora.'
    };
  }

  const libres = freeSlots(day, durMin);
  return {
    disponible: libres.length > 0,
    horario,
    duracion_min: durMin,
    servicio: servicioUsado,
    horas_disponibles: libres,
    mensaje: libres.length > 0 ? `Hay ${libres.length} horarios libres` : 'No hay disponibilidad ese día'
  };
};
