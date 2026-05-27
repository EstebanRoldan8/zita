const { supabaseAdmin } = require('../config/supabase');

async function getAvailableEmployee(businessId, fecha, hora) {
  const scheduled_at_inicio = `${fecha}T${hora}:00-05:00`;
  const scheduled_at_fin = `${fecha}T${hora}:59-05:00`;

  const { data: empleados } = await supabaseAdmin
    .from('employees')
    .select('id, name, last_appointment_at')
    .eq('business_id', businessId)
    .eq('is_active', true);

  if (!empleados?.length) return null;

  const { data: citasEnHorario } = await supabaseAdmin
    .from('appointments')
    .select('employee_id, scheduled_at, services(duration_minutes)')
    .eq('business_id', businessId)
    .in('status', ['confirmed', 'pending'])
    .gte('scheduled_at', `${fecha}T00:00:00-05:00`)
    .lte('scheduled_at', `${fecha}T23:59:59-05:00`);

  const horaReservadaMs = new Date(`${fecha}T${hora}:00-05:00`).getTime();

  const ocupados = new Set(
    citasEnHorario
      ?.filter(c => {
        const inicio = new Date(c.scheduled_at).getTime();
        const duracion = (c.services?.duration_minutes || 30) * 60 * 1000;
        const fin = inicio + duracion;
        return horaReservadaMs >= inicio && horaReservadaMs < fin;
      })
      .map(c => c.employee_id)
  );
  const disponibles = empleados.filter(e => !ocupados.has(e.id));

  if (!disponibles.length) return null;

  const hoy = fecha;
  const { data: citasHoy } = await supabaseAdmin
    .from('appointments')
    .select('employee_id')
    .eq('business_id', businessId)
    .gte('scheduled_at', hoy + 'T00:00:00-05:00')
    .lte('scheduled_at', hoy + 'T23:59:59-05:00')
    .in('status', ['confirmed', 'pending', 'completed']);

  const conteo = {};
  citasHoy?.forEach(c => {
    conteo[c.employee_id] = (conteo[c.employee_id] || 0) + 1;
  });

  disponibles.sort((a, b) => {
    const citasA = conteo[a.id] || 0;
    const citasB = conteo[b.id] || 0;
    if (citasA !== citasB) return citasA - citasB;
    const fechaA = a.last_appointment_at ? new Date(a.last_appointment_at) : new Date(0);
    const fechaB = b.last_appointment_at ? new Date(b.last_appointment_at) : new Date(0);
    return fechaA - fechaB;
  });

  return disponibles[0];
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
    const dateStr = currentDate.toISOString().split('T')[0];
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

module.exports = { getAvailableEmployee, getNextAvailableSlots };
