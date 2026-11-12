// Tool 'gestionar_grupo' del bot de WhatsApp (descripción y parámetros en ../prompt.js → BOT_TOOLS).
// ctx: { businessId, clientPhone, business, clientInfo, citaDelCliente, CITA_NO_ENCONTRADA }
const { supabaseAdmin, logger, getPlan, maskPhone, getAvailableEmployee, loadDay, checkHours, isValidDate, normalizeTime, toInstantMs, DEFAULT_DURATION, findService, isBookingConflict } = require('../shared');

module.exports = async function gestionar_grupo(toolInput, ctx) {
  const { businessId, clientPhone } = ctx;
  const { accion, persona } = toolInput;

  // Leer contexto actual
  const { data: convActual } = await supabaseAdmin
    .from('whatsapp_conversations')
    .select('context')
    .eq('business_id', businessId)
    .eq('client_phone', clientPhone)
    .maybeSingle();

  const contexto = convActual?.context || {};
  const grupo = contexto.grupo || { personas: [], confirmadas: 0 };

  if (accion === 'leer_progreso') {
    return {
      grupo_activo: grupo.personas.length > 0,
      personas: grupo.personas,
      total: grupo.personas.length,
      confirmadas: grupo.confirmadas
    };
  }

  if (accion === 'limpiar') {
    await supabaseAdmin
      .from('whatsapp_conversations')
      .update({ context: { ...contexto, grupo: null } })
      .eq('business_id', businessId)
      .eq('client_phone', clientPhone);
    return { success: true, message: 'Grupo limpiado.' };
  }

  if (accion === 'agregar_persona' && persona) {
    grupo.personas.push({
      nombre: persona.nombre || 'Sin nombre',
      servicio: persona.servicio,
      fecha: persona.fecha,
      hora: persona.hora,
      agendada: false
    });

    const { data: grupoData, error: grupoError } = await supabaseAdmin
      .from('whatsapp_conversations')
      .upsert({
        business_id: businessId,
        client_phone: clientPhone,
        context: { ...contexto, grupo }
      }, { onConflict: 'business_id,client_phone' })
      .select('id');

    if (grupoError || !grupoData || grupoData.length === 0) {
      logger.warn('[GESTIONAR_GRUPO_UPSERT_FAILED]', { businessId, phone: maskPhone(clientPhone), error: grupoError?.message });
    }

    return {
      success: true,
      total_en_grupo: grupo.personas.length,
      personas: grupo.personas
    };
  }

  if (accion === 'confirmar_todas') {
    const resultados = [];
    const pendientes = grupo.personas.filter(p => !p.agendada);

    // Validar límite de citas del mes para el grupo
    const { data: bizGrp } = await supabaseAdmin
      .from('businesses')
      .select('plan')
      .eq('id', businessId)
      .single();

    const limitegrp = getPlan(bizGrp?.plan).max_appointments_month;
    let contadorCitasGrp = 0;

    if (limitegrp !== -1) {
      const _tzgrp = require('../../../utils/timezone').getTimezone();
      const _offgrp = require('../../../utils/timezone').getOffsetForTz(_tzgrp);
      const mesActualgrp = new Date().toLocaleDateString('en-CA', { timeZone: _tzgrp }).slice(0, 7);
      const inicioMesgrp = `${mesActualgrp}-01T00:00:00${_offgrp}`;
      const [yrgrp, mogrp] = mesActualgrp.split('-').map(Number);
      const ultimoDiagrp = new Date(yrgrp, mogrp, 0).getDate();
      const finMesgrp = `${mesActualgrp}-${String(ultimoDiagrp).padStart(2, '0')}T23:59:59${_offgrp}`;

      const { count: countgrp } = await supabaseAdmin
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .gte('scheduled_at', inicioMesgrp)
        .lte('scheduled_at', finMesgrp)
        .neq('status', 'cancelled');

      contadorCitasGrp = countgrp || 0;
    }

    for (const p of pendientes) {
      const pHora = normalizeTime(p.hora);
      if (!p.servicio || !isValidDate(p.fecha) || !pHora) {
        resultados.push({ nombre: p.nombre, success: false, error: 'Faltan datos o la fecha/hora no es válida' });
        continue;
      }
      p.hora = pHora;

      const foundGrp = await findService(businessId, p.servicio);
      const servicio = foundGrp.servicio;
      if (!servicio) {
        resultados.push({ nombre: p.nombre, success: false, error: foundGrp.ambiguo ? `Servicio ambiguo: ${foundGrp.opciones.map(o => o.name).join(', ')}` : 'Servicio no encontrado' });
        continue;
      }
      const durGrp = servicio.duration_minutes || DEFAULT_DURATION;

      // Mismas validaciones que agendar_cita: horario/festivo con la duración, hora no pasada y solape real
      const dayGrp = await loadDay(businessId, p.fecha);
      const horarioValidoGrp = checkHours(dayGrp, p.hora, durGrp);
      if (!horarioValidoGrp.valid) {
        resultados.push({ nombre: p.nombre, success: false, error: horarioValidoGrp.reason });
        continue;
      }
      if (toInstantMs(p.fecha, p.hora) <= Date.now()) {
        resultados.push({ nombre: p.nombre, success: false, error: 'Esa hora ya pasó' });
        continue;
      }

      // Buscar empleado disponible (loadDay ya incluye las citas del grupo creadas en esta misma vuelta)
      const empleado = await getAvailableEmployee(businessId, p.fecha, p.hora, durGrp, { day: dayGrp });
      if (!empleado) {
        resultados.push({ nombre: p.nombre, success: false, error: `Sin empleados disponibles a las ${p.hora}` });
        continue;
      }
      // Obtener cliente principal (el que escribe)
      const { data: clientePrincipal } = await supabaseAdmin
        .from('clients')
        .select('id, name')
        .eq('business_id', businessId)
        .eq('phone', clientPhone)
        .maybeSingle();

      const scheduled_at = `${p.fecha}T${p.hora}:00-05:00`;
      const notaNombre = p.nombre && p.nombre !== 'Sin nombre'
        ? `Para: ${p.nombre}`
        : null;

      // Validar límite antes de cada cita
      if (limitegrp !== -1 && contadorCitasGrp >= limitegrp) {
        resultados.push({ nombre: p.nombre, success: false, error: 'Límite de citas del mes alcanzado' });
        continue;
      }

      const { data: cita, error } = await supabaseAdmin
        .from('appointments')
        .insert({
          business_id: businessId,
          client_id: clientePrincipal?.id || null,
          service_id: servicio.id,
          scheduled_at,
          status: 'confirmed',
          source: 'whatsapp',
          price: servicio.price,
          employee_id: empleado.id,
          notes: notaNombre
        })
        .select('id')
        .single();

      if (error) {
        if (isBookingConflict(error)) {
          // Constraint de no-double-booking: horario ya fue tomado
          resultados.push({ nombre: p.nombre, success: false, error: 'Ese horario ya no está disponible, alguien más lo tomó justo ahora.' });
        } else {
          resultados.push({ nombre: p.nombre, success: false, error: error.message });
        }
        continue;
      }

      // Income se genera automáticamente cuando scheduler.service.js auto-completa la cita (1+ hora después)
      // Esto alinea citas grupales con el patrón de citas individuales

      const horaFormateada = new Date(scheduled_at).toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      p.agendada = true;
      contadorCitasGrp++;
      resultados.push({
        nombre: p.nombre,
        success: true,
        servicio: servicio.name,
    empleado: empleado.name && empleado.name !== 'Sin asignar' ? empleado.name : null,
        hora_colombia: horaFormateada,
        precio: servicio.price
      });
    }

    // Limpiar grupo del context
    await supabaseAdmin
      .from('whatsapp_conversations')
      .update({ context: { ...contexto, grupo: null } })
      .eq('business_id', businessId)
      .eq('client_phone', clientPhone);

    const exitosas = resultados.filter(r => r.success).length;
    const fallidas = resultados.filter(r => !r.success).length;

    return {
      success: exitosas > 0,
      total: resultados.length,
      exitosas,
      fallidas,
      resultados
    };
  }

  return { error: 'Acción no reconocida' };
};
