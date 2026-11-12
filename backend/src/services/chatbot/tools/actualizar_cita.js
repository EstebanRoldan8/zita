// Tool 'actualizar_cita' del bot de WhatsApp (descripción y parámetros en ../prompt.js → BOT_TOOLS).
// ctx: { businessId, clientPhone, business, clientInfo, citaDelCliente, CITA_NO_ENCONTRADA }
const { supabaseAdmin, logger, getAvailableEmployee, loadDay, checkHours, freeSlots, isEmployeeFree, isValidDate, normalizeTime, toInstantMs, localParts, localISO, DEFAULT_DURATION, findService, escapeLike, isBookingConflict } = require('../shared');

module.exports = async function actualizar_cita(toolInput, ctx) {
  const { businessId, citaDelCliente, CITA_NO_ENCONTRADA } = ctx;
  const citaPropia = await citaDelCliente(toolInput.appointment_id);
  if (!citaPropia) return CITA_NO_ENCONTRADA;
  if (!['pending', 'confirmed'].includes(citaPropia.status)) {
    return { success: false, error: 'Esa cita ya no está activa (fue cancelada o completada).' };
  }

  // Fecha y hora ACTUALES en hora de Colombia (el timestamptz llega en UTC: nunca split('T'))
  const actual = localParts(citaPropia.scheduled_at);

  let empleadoNuevo = null;
  if (toolInput.employee_name) {
    const { data: empMatches } = await supabaseAdmin
      .from('employees')
      .select('id, name')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .ilike('name', `%${escapeLike(toolInput.employee_name)}%`);
    if (empMatches && empMatches.length > 1) {
      return { success: false, error: 'empleado_ambiguo', opciones: empMatches.map(e => ({ name: e.name })) };
    }
    if (!empMatches?.length) return { success: false, error: 'No encontré ningún empleado con ese nombre.' };
    empleadoNuevo = empMatches[0];
  }

  let servicioNuevo = null;
  if (toolInput.nuevo_servicio) {
    const found = await findService(businessId, toolInput.nuevo_servicio);
    if (found.ambiguo) return { success: false, error: 'servicio_ambiguo', opciones: found.opciones };
    if (!found.servicio) return { success: false, error: 'No encontré ese servicio. ¿Cuál quieres exactamente?' };
    servicioNuevo = found.servicio;
  }

  // Lo que no cambia se conserva en hora local
  let fecha = actual.fecha;
  let hora = actual.hora;
  if (toolInput.nueva_fecha) {
    if (!isValidDate(String(toolInput.nueva_fecha).trim())) return { success: false, error: 'Fecha inválida. Usa YYYY-MM-DD.' };
    fecha = String(toolInput.nueva_fecha).trim();
  }
  if (toolInput.nueva_hora) {
    hora = normalizeTime(toolInput.nueva_hora);
    if (!hora) return { success: false, error: 'Hora inválida. Usa HH:mm (24 horas).' };
  }
  const cambiaHorario = fecha !== actual.fecha || hora !== actual.hora;
  const cambiaEmpleado = empleadoNuevo && empleadoNuevo.id !== citaPropia.employee_id;
  if (!cambiaHorario && !cambiaEmpleado && !servicioNuevo) {
    return { success: false, error: 'No hay cambios que aplicar.' };
  }

  // Validación completa del resultado final: horario y festivo con la duración del servicio (nuevo o actual),
  // hora no pasada y que el empleado esté libre (sin contar esta misma cita)
  const durMin = (servicioNuevo || citaPropia.services)?.duration_minutes || DEFAULT_DURATION;
  const day = await loadDay(businessId, fecha);
  const fit = checkHours(day, hora, durMin);
  if (!fit.valid) return { success: false, error: fit.reason };
  if (cambiaHorario && toInstantMs(fecha, hora) <= Date.now()) {
    return { success: false, error: 'Esa hora ya pasó. Elige una hora futura.' };
  }

  let empId = empleadoNuevo?.id || citaPropia.employee_id;
  if (empId && !isEmployeeFree(day, empId, hora, durMin, { excludeAppointmentId: citaPropia.id })) {
    if (empleadoNuevo) {
      return { success: false, error: `${empleadoNuevo.name} no está disponible en ese horario. ¿Quieres con otro empleado?` };
    }
    // No se cambia de empleado sin preguntar: se ofrecen horas libres y, si lo hay, otro empleado libre
    const otro = await getAvailableEmployee(businessId, fecha, hora, durMin, { day, excludeAppointmentId: citaPropia.id });
    const alternativas = freeSlots({ ...day, empleados: day.empleados.filter(e => e.id === empId) }, durMin, { after: hora, limit: 3, excludeAppointmentId: citaPropia.id });
    return {
      success: false,
      error: 'Ese horario está ocupado para el empleado asignado.',
      slots_alternativos_mismo_empleado: alternativas,
      otro_empleado_disponible: otro?.name || null
    };
  }
  if (!empId) {
    const libre = await getAvailableEmployee(businessId, fecha, hora, durMin, { day, excludeAppointmentId: citaPropia.id });
    if (!libre) return { success: false, error: 'No hay empleados disponibles en ese horario.', slots_alternativos: freeSlots(day, durMin, { after: hora, limit: 3 }) };
    empId = libre.id;
  }

  const updateData = {};
  if (empId !== citaPropia.employee_id) updateData.employee_id = empId;
  if (servicioNuevo) { updateData.service_id = servicioNuevo.id; updateData.price = servicioNuevo.price; }
  if (cambiaHorario) updateData.scheduled_at = localISO(fecha, hora);

  const { data, error } = await supabaseAdmin
    .from('appointments')
    .update(updateData)
    .eq('id', citaPropia.id)
    .eq('business_id', businessId)
    .in('status', ['pending', 'confirmed'])
    .select('id');

  if (isBookingConflict(error)) return { success: false, error: 'Ese horario ya no está disponible, alguien más lo tomó justo ahora. Elige otro.' };
  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) return CITA_NO_ENCONTRADA;

  if (servicioNuevo) {
    const { error: incomeUpdError } = await supabaseAdmin
      .from('income')
      .update({ amount: servicioNuevo.price, description: `${servicioNuevo.name} - agendado por WhatsApp (actualizado)` })
      .eq('appointment_id', citaPropia.id)
      .eq('business_id', businessId)
      .select('id');
    if (incomeUpdError) {
      logger.error('[REAGENDAR_INCOME_UPDATE_FAILED]', { businessId, appointmentId: citaPropia.id, error: incomeUpdError.message });
    }
  }

  const empleadoFinal = day.empleados.find(e => e.id === empId)?.name || empleadoNuevo?.name || null;
  const horaColombia = new Date(localISO(fecha, hora)).toLocaleString('es-CO', {
    timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: true
  });
  return {
    success: true,
    message: `Cita actualizada correctamente${cambiaEmpleado && empleadoFinal ? ` — ahora con ${empleadoFinal}` : ''}.`,
    servicio: (servicioNuevo || citaPropia.services)?.name || null,
    empleado: empleadoFinal,
    hora_colombia: horaColombia,
    nuevo_precio: servicioNuevo ? servicioNuevo.price : null
  };
};
