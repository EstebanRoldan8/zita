// Tool 'agendar_cita' del bot de WhatsApp (descripción y parámetros en ../prompt.js → BOT_TOOLS).
// ctx: { businessId, clientPhone, business, clientInfo, citaDelCliente, CITA_NO_ENCONTRADA }
const { supabaseAdmin, logger, logSystemAlert, getPlan, maskPhone, notify, getAvailableEmployee, loadDay, checkHours, freeSlots, isEmployeeFree, isValidDate, normalizeTime, toInstantMs, localParts, DEFAULT_DURATION, findService, escapeLike, isBookingConflict, ownerSender } = require('../shared');

module.exports = async function agendar_cita(toolInput, ctx) {
  const { businessId, clientPhone, business, clientInfo } = ctx;
  const fecha = String(toolInput.fecha || '').trim();
  const hora = normalizeTime(toolInput.hora);
  if (!isValidDate(fecha)) return { success: false, error: 'Fecha inválida. Usa YYYY-MM-DD.' };
  if (!hora) return { success: false, error: 'Hora inválida. Usa HH:mm (24 horas).' };
  toolInput.fecha = fecha;
  toolInput.hora = hora;

  const found = await findService(businessId, toolInput.service_name);
  if (found.ambiguo) return { success: false, error: 'servicio_ambiguo', opciones: found.opciones };
  const servicio = found.servicio;
  if (!servicio) return { success: false, error: 'Servicio no encontrado' };
  const durMin = servicio.duration_minutes || DEFAULT_DURATION;

  const day = await loadDay(businessId, fecha);
  const horarioValido = checkHours(day, hora, durMin);
  if (!horarioValido.valid) {
    return { success: false, error: horarioValido.reason };
  }

  // La hora no puede haber pasado
  if (toInstantMs(fecha, hora) <= Date.now()) {
    const horaActual = localParts(new Date()).hora;
    return {
      success: false,
      error: `Esa hora ya pasó. Puedes agendar desde las ${horaActual} en adelante.`
    };
  }

  // Si el cliente pidió un empleado específico, intentar asignarlo
  let empleadoDisponible = null;
  if (toolInput.employee_name) {
    const { data: empMatches } = await supabaseAdmin
      .from('employees')
      .select('id, name')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .ilike('name', `%${escapeLike(toolInput.employee_name)}%`);

    // Si hay 2+ matches, retorna error de ambigüedad
    if (empMatches && empMatches.length > 1) {
      return {
        success: false,
        error: 'empleado_ambiguo',
        opciones: empMatches.map(e => ({ name: e.name }))
      };
    }

    const empPref = empMatches && empMatches.length === 1 ? empMatches[0] : null;
    if (empPref) {
      if (isEmployeeFree(day, empPref.id, hora, durMin)) {
        empleadoDisponible = empPref;
      } else {
        const alternativasEmp = freeSlots({ ...day, empleados: [empPref] }, durMin, { after: hora, limit: 3 });
        return {
          success: false,
          error: `${empPref.name} no está disponible a esa hora. ¿Quieres con otro empleado disponible?`,
          slots_alternativos_con_empleado: alternativasEmp
        };
      }
    }
  }

  if (!empleadoDisponible) {
    empleadoDisponible = await getAvailableEmployee(businessId, fecha, hora, durMin, { day });
  }
  if (!empleadoDisponible) {
    // Nadie disponible: ofrece las siguientes horas libres ese mismo día (para la duración de este servicio)
    const slotsLibres = freeSlots(day, durMin, { after: hora, limit: 3 });
    return {
      success: false,
      error: 'sin_disponibilidad',
      slots_alternativos: slotsLibres,
      mensaje: slotsLibres.length > 0
        ? `No hay disponibilidad a las ${hora}. Alternativas: ${slotsLibres.join(', ')}`
        : 'No hay disponibilidad ese día.'
    };
  }

  let { data: clienteExistente } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .eq('business_id', businessId)
    .eq('phone', clientPhone)
    .maybeSingle();

  // Guardia en servidor: no se agenda sin nombre real del cliente.
  // El LLM puede ignorar el prompt; esto no.
  const nombreActualCliente = clienteExistente?.name?.trim();
  const sinNombreReal = !nombreActualCliente || nombreActualCliente === 'Cliente WhatsApp';
  const nombreEnviado = (toolInput.client_name || '').trim();
  if (sinNombreReal && !nombreEnviado) {
    return {
      success: false,
      error: 'falta_nombre_cliente',
      mensaje: 'Antes de agendar necesitas el nombre del cliente. Pídeselo ("¿A qué nombre te agendo?") y vuelve a llamar agendar_cita con client_name.'
    };
  }
  if (nombreEnviado) {
    // Mayúscula inicial en cada palabra (regla de nombres)
    toolInput.client_name = nombreEnviado
      .toLowerCase()
      .replace(/(^|\s)(\p{L})/gu, (_, sp, ch) => sp + ch.toUpperCase());
  }

  // En WhatsApp la identidad del cliente es su teléfono: nunca se busca "por nombre" (eso le ponía la cita
  // a otra persona con nombre parecido y el recordatorio le llegaba a ella).

  if (!clienteExistente) {
    const { data: nuevoCliente, error: nuevoClienteError } = await supabaseAdmin
      .from('clients')
      .insert({
        business_id: businessId,
        name: toolInput.client_name || 'Cliente WhatsApp',
        phone: clientPhone
      })
      .select('id, name')
      .single();

    if (nuevoClienteError || !nuevoCliente) {
      logger.warn('[AGENDAR_CITA_CLIENT_INSERT_FAILED]', { businessId, phone: maskPhone(clientPhone), error: nuevoClienteError?.message });
      return { success: false, error: 'No se pudo registrar el cliente para agendar la cita' };
    }
    clienteExistente = nuevoCliente;
  } else if (toolInput.client_name && clienteExistente.name === 'Cliente WhatsApp') {
    await supabaseAdmin
      .from('clients')
      .update({ name: toolInput.client_name })
      .eq('id', clienteExistente.id);
    clienteExistente.name = toolInput.client_name;
    if (clientInfo && toolInput.client_name) {
      clientInfo.name = toolInput.client_name;
    }
  }

  const scheduled_at = `${toolInput.fecha}T${toolInput.hora}:00-05:00`;

  // Validar límite de citas del mes
  const { data: bizPlan } = await supabaseAdmin
    .from('businesses')
    .select('plan')
    .eq('id', businessId)
    .single();

  const limitebot = getPlan(bizPlan?.plan).max_appointments_month;

  if (limitebot !== -1) {
    const _tzbot = require('../../../utils/timezone').getTimezone();
    const _offbot = require('../../../utils/timezone').getOffsetForTz(_tzbot);
    const mesActualbot = new Date().toLocaleDateString('en-CA', { timeZone: _tzbot }).slice(0, 7);
    const inicioMesbot = `${mesActualbot}-01T00:00:00${_offbot}`;
    const [yrbot, mobot] = mesActualbot.split('-').map(Number);
    const ultimoDiabot = new Date(yrbot, mobot, 0).getDate();
    const finMesbot = `${mesActualbot}-${String(ultimoDiabot).padStart(2, '0')}T23:59:59${_offbot}`;

    const { count: countbot } = await supabaseAdmin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .gte('scheduled_at', inicioMesbot)
      .lte('scheduled_at', finMesbot)
      .neq('status', 'cancelled');

    if (countbot >= limitebot) {
      return { success: false, error: 'Lo siento, el negocio ha alcanzado su límite de citas este mes.' };
    }
  }

  const { data, error } = await supabaseAdmin
    .from('appointments')
    .insert({
      business_id: businessId,
      client_id: clienteExistente?.id || null,
      service_id: servicio.id,
      scheduled_at,
      status: 'confirmed',
      source: 'whatsapp',
      price: servicio.price,
      employee_id: empleadoDisponible.id
    })
    .select('id, scheduled_at')
    .single();

  if (error) {
    if (isBookingConflict(error)) {
      logger.warn('[DOUBLE_BOOKING_ATTEMPT]', { business_id: businessId, employee_id: empleadoDisponible.id, scheduled_at });
      return { success: false, error: 'Ese horario ya no está disponible, alguien más lo tomó justo ahora. Elige otro.' };
    }
    return { success: false, error: error.message };
  }

  if (data) {
    try {
      await supabaseAdmin
        .from('employees')
        .update({ last_appointment_at: new Date().toISOString() })
        .eq('id', empleadoDisponible.id);
    } catch (empErr) {
      logger.error('Error actualizando employee:', empErr.message);
    }

    // Notificar al dueño de la nueva cita
    try {
      const { data: negocioNotif } = await supabaseAdmin
        .from('businesses')
        .select('phone, name, whatsapp_phone_number_id')
        .eq('id', businessId)
        .single();

      if (negocioNotif?.phone) {
        const clienteNombre = data && clienteExistente?.name && clienteExistente.name !== 'Cliente WhatsApp'
          ? clienteExistente.name
          : 'Cliente nuevo';

        const horaFormateadaNotif = new Date(`${toolInput.fecha}T${toolInput.hora}:00-05:00`)
          .toLocaleString('es-CO', {
            timeZone: 'America/Bogota',
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          });

        const empleadoNombreNotif = empleadoDisponible?.name && empleadoDisponible.name !== 'Sin asignar'
          ? ` — ${empleadoDisponible.name}`
          : '';

        const mensajeDueno = `📅 *Nueva cita por WhatsApp*\n\n` +
          `👤 *Cliente:* ${clienteNombre}\n` +
          `📱 *Teléfono:* ${clientPhone}\n` +
          `✂️ *Servicio:* ${servicio.name}${empleadoNombreNotif}\n` +
          `🕐 *Fecha y hora:* ${horaFormateadaNotif}\n` +
          `💰 *Precio:* $${servicio.price.toLocaleString('es-CO')}`;

        const sender = ownerSender(business);
        const { result: sendResultNotif } = await notify({
          to: negocioNotif.phone,
          text: mensajeDueno,
          template: { key: 'aviso_nueva_cita', body: [clienteNombre, clientPhone, `${servicio.name}${empleadoNombreNotif}`, horaFormateadaNotif, `${Number(servicio.price).toLocaleString('es-CO')}`] },
          token: sender.token,
          phoneNumberId: sender.phoneNumberId,
          businessId,
        });

        if (!sendResultNotif.success && sendResultNotif.success !== undefined) {
          logger.error('[NUEVA_CITA_NOTIF_FAILED]', {
            to: maskPhone(negocioNotif.phone),
            businessId,
            error: sendResultNotif.error
          });
          await logSystemAlert('whatsapp_send_failed',
            `Fallo notificación de nueva cita al dueño de ${negocioNotif.name}`,
            businessId,
            { to: maskPhone(negocioNotif.phone), error: sendResultNotif.error, messageType: 'nueva_cita_notif' });
        } else {
          logger.info('Notificación enviada al dueño por nueva cita WhatsApp');
        }
      }
    } catch (notifErr) {
      logger.error('Error notificando al dueño: ' + notifErr.message);
      await logSystemAlert('whatsapp_send_failed',
        `Excepción en notificación de nueva cita al dueño`,
        businessId,
        { error: notifErr.message, messageType: 'nueva_cita_notif' });
    }
  }

  const horaFormateada = new Date(scheduled_at).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  return {
    success: true,
    servicio: servicio.name,
    precio: servicio.price,
    empleado: empleadoDisponible?.name && empleadoDisponible.name !== 'Sin asignar' ? empleadoDisponible.name : null,
    scheduled_at,
    hora_colombia: horaFormateada
  };
};
