const { supabaseAdmin } = require('../config/supabase');

async function getAvailableEmployee(businessId, fecha, hora) {
  const { data: empleados } = await supabaseAdmin
    .from('employees')
    .select('id, name, last_appointment_at')
    .eq('business_id', businessId)
    .eq('is_active', true);

  if (!empleados?.length) return null;

  // Obtener citas del día para verificar disponibilidad en ese horario
  const { data: citasDelDia } = await supabaseAdmin
    .from('appointments')
    .select('employee_id, scheduled_at, services(duration_minutes)')
    .eq('business_id', businessId)
    .in('status', ['confirmed', 'pending'])
    .gte('scheduled_at', `${fecha}T00:00:00-05:00`)
    .lte('scheduled_at', `${fecha}T23:59:59-05:00`);

  // Determinar empleados ocupados en ese horario específico
  const horaReservadaMs = new Date(`${fecha}T${hora}:00-05:00`).getTime();
  const ocupados = new Set(
    (citasDelDia || [])
      .filter(c => {
        const inicio = new Date(c.scheduled_at).getTime();
        const duracion = (c.services?.duration_minutes || 30) * 60 * 1000;
        const fin = inicio + duracion;
        return horaReservadaMs >= inicio && horaReservadaMs < fin;
      })
      .map(c => c.employee_id)
  );

  const disponibles = empleados.filter(e => !ocupados.has(e.id));
  if (!disponibles.length) return null;

  // Contar citas del mes actual por empleado (para balance mensual)
  const inicioMes = fecha.slice(0, 7) + '-01';
  const { data: citasMes } = await supabaseAdmin
    .from('appointments')
    .select('employee_id')
    .eq('business_id', businessId)
    .in('status', ['confirmed', 'pending', 'completed'])
    .gte('scheduled_at', `${inicioMes}T00:00:00-05:00`)
    .lte('scheduled_at', `${fecha}T23:59:59-05:00`);

  const conteoMes = {};
  (citasMes || []).forEach(c => {
    if (c.employee_id) conteoMes[c.employee_id] = (conteoMes[c.employee_id] || 0) + 1;
  });

  // Contar citas del día por empleado (para desempate)
  const conteoHoy = {};
  (citasDelDia || []).forEach(c => {
    if (c.employee_id) conteoHoy[c.employee_id] = (conteoHoy[c.employee_id] || 0) + 1;
  });

  // Ordenar: 1) menos citas en el mes, 2) menos citas hoy, 3) hace más tiempo sin atender
  disponibles.sort((a, b) => {
    const mesA = conteoMes[a.id] || 0;
    const mesB = conteoMes[b.id] || 0;
    if (mesA !== mesB) return mesA - mesB;

    const hoyA = conteoHoy[a.id] || 0;
    const hoyB = conteoHoy[b.id] || 0;
    if (hoyA !== hoyB) return hoyA - hoyB;

    const fechaA = a.last_appointment_at ? new Date(a.last_appointment_at) : new Date(0);
    const fechaB = b.last_appointment_at ? new Date(b.last_appointment_at) : new Date(0);
    return fechaA - fechaB;
  });

  return disponibles[0];
}

/**
 * Valida que una cita (fecha + hora + duración) quepa dentro del horario de atención
 * del negocio ese día, y que ese día no esté marcado como cerrado (día especial/festivo).
 *
 * Regla estricta: la cita debe TERMINAR a más tardar a la hora de cierre.
 * Ej: cierre 18:00, servicio de 30 min -> última hora válida de inicio es 17:30.
 *
 * @param {string} businessId
 * @param {string} fecha - 'YYYY-MM-DD'
 * @param {string} hora - 'HH:mm'
 * @param {object} [opts]
 * @param {number} [opts.durationMinutes] - duración del servicio en minutos, si ya se conoce
 * @param {string} [opts.serviceId] - id del servicio, para obtener la duración si no viene en durationMinutes
 * @returns {Promise<{valid: boolean, reason?: string, open_time?: string, close_time?: string}>}
 */
async function isAppointmentWithinBusinessHours(businessId, fecha, hora, opts = {}) {
  const { durationMinutes, serviceId } = opts;

  const [yearF, monthF, dayF] = fecha.split('-').map(Number);
  const diaDeLaSemana = new Date(yearF, monthF - 1, dayF).getDay();

  const { data: horario } = await supabaseAdmin
    .from('business_hours')
    .select('open_time, close_time, is_open')
    .eq('business_id', businessId)
    .eq('day_of_week', diaDeLaSemana)
    .maybeSingle();

  if (!horario?.is_open) {
    return { valid: false, reason: 'Ese día estamos cerrados.' };
  }

  // Verificar días cerrados especiales (festivos)
  const { data: diaCerrado } = await supabaseAdmin
    .from('business_closed_days')
    .select('reason')
    .eq('business_id', businessId)
    .eq('date', fecha)
    .maybeSingle();

  if (diaCerrado) {
    return {
      valid: false,
      reason: `Ese día estamos cerrados: ${diaCerrado.reason}. ¿Te agendo otro día?`
    };
  }

  let duracion = durationMinutes;
  if (duracion == null && serviceId) {
    const { data: servicioDur } = await supabaseAdmin
      .from('services')
      .select('duration_minutes')
      .eq('id', serviceId)
      .maybeSingle();
    duracion = servicioDur?.duration_minutes;
  }
  if (duracion == null) duracion = 30;

  const [horaH, horaM] = hora.split(':').map(Number);
  const appointmentMinutes = horaH * 60 + horaM;
  const [aperturaH, aperturaM] = horario.open_time.split(':').map(Number);
  const aperturaMinutes = aperturaH * 60 + aperturaM;
  const [cierreH, cierreM] = horario.close_time.split(':').map(Number);
  const cierreMinutes = cierreH * 60 + cierreM;

  if (appointmentMinutes < aperturaMinutes) {
    return {
      valid: false,
      reason: `Fuera de horario. Atendemos de ${horario.open_time} a ${horario.close_time}.`
    };
  }

  if (appointmentMinutes + duracion > cierreMinutes) {
    return {
      valid: false,
      reason: `Fuera de horario. Atendemos de ${horario.open_time} a ${horario.close_time}.`
    };
  }

  return { valid: true, open_time: horario.open_time, close_time: horario.close_time };
}

async function getNextAvailableSlots(businessId, fecha, hora, cantidad = 3) {
  const { data: settings } = await supabaseAdmin
    .from('business_settings')
    .select('business_hours, closed_days')
    .eq('business_id', businessId)
    .single();

  if (!settings?.business_hours) return [];

  const slots = [];
  let currentDate = new Date(`${fecha}T${hora}:00`);
  const horaInicio = parseInt(settings.business_hours.start?.split(':')[0] || '09');
  const horaFin = parseInt(settings.business_hours.end?.split(':')[0] || '18');
  const diasCerrados = settings.closed_days || [];

  while (slots.length < cantidad) {
    const dayOfWeek = currentDate.toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'America/Bogota' });
    const dateStr = currentDate.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const horaStr = String(currentDate.getHours()).padStart(2, '0') + ':' + String(currentDate.getMinutes()).padStart(2, '0');

    if (!diasCerrados.includes(dayOfWeek) && currentDate.getHours() >= horaInicio && currentDate.getHours() < horaFin) {
      const available = await getAvailableEmployee(businessId, dateStr, horaStr);
      if (available) {
        slots.push({
          fecha: dateStr,
          hora: horaStr,
          empleado_nombre: available.name
        });
      }
    }

    currentDate.setHours(currentDate.getHours() + 1);
  }

  return slots;
}

module.exports = { getAvailableEmployee, getNextAvailableSlots, isAppointmentWithinBusinessHours };
