const { createUserClient, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { getTimezone, getOffsetForTz } = require('../utils/timezone');
const { getAvailableEmployee, getNextAvailableSlots, loadDay, freeEmployees, localParts } = require('../utils/availability');
// 23505 = mismo inicio (índice único); 23P01 = solape (restricción de exclusión de la migración 064)
const isConflict = (e) => !!e && (e.code === '23505' || e.code === '23P01');
const { VALID_STATUSES, changeAppointmentStatus } = require('../services/appointmentStatus');

async function getAll(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);

    let query = userClient
      .from('appointments')
      .select('id, scheduled_at, status, source, price, notes, employee_id, clients(id, name, phone), services(id, name), employees(name)')
      .eq('business_id', req.businessId)
      .order('scheduled_at');

    if (req.query.date) {
      const offset = getOffsetForTz(getTimezone(req.business?.country));
      const start = `${req.query.date}T00:00:00${offset}`;
      const end   = `${req.query.date}T23:59:59${offset}`;
      query = query.gte('scheduled_at', start).lte('scheduled_at', end);
    }

    // Paginación: ?limit=N&offset=M para límites custom, default 100
    const limit = Math.min(parseInt(req.query.limit || '100'), 1000);
    const offset = parseInt(req.query.offset || '0');
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`appointments.getAll: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getOne(req, res) {
  try {
    const { id } = req.params;
    const userClient = createUserClient(req.headers.authorization);

    const { data, error } = await userClient
      .from('appointments')
      .select('*, clients(id, name, phone, email), services(id, name, duration_minutes)')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, error: 'No encontrado' });
    }

    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`appointments.getOne: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function create(req, res) {
  try {
    const { client_id, service_id, scheduled_at, price, notes, is_reward, employee_id } = req.body;

    // Asegurar que scheduled_at tenga timezone Colombia si viene sin timezone
    const scheduledAtWithTZ = scheduled_at && !scheduled_at.includes('+') && !scheduled_at.includes('Z')
      ? scheduled_at + '-05:00'
      : scheduled_at;

    if (!service_id || !scheduled_at) {
      return res.status(400).json({
        success: false,
        error: 'service_id y scheduled_at son obligatorios.',
      });
    }

    const { PLANS } = require('../config/plans');

    const { data: biz } = await supabaseAdmin
      .from('businesses')
      .select('plan')
      .eq('id', req.businessId)
      .single();

    const plan = biz.plan || 'estandar';
    const limite = PLANS[plan].max_appointments_month;

    if (limite !== -1) {
      const _tz = getTimezone(req.business?.country);
      const _off = getOffsetForTz(_tz);
      const mesActual = new Date().toLocaleDateString('en-CA', { timeZone: _tz }).slice(0, 7);
      const inicioMes = `${mesActual}-01T00:00:00${_off}`;
      const [yr, mo] = mesActual.split('-').map(Number);
      const ultimoDia = new Date(yr, mo, 0).getDate();
      const finMes = `${mesActual}-${String(ultimoDia).padStart(2, '0')}T23:59:59${_off}`;

      const { count } = await supabaseAdmin
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', req.businessId)
        .gte('scheduled_at', inicioMes)
        .lte('scheduled_at', finMes)
        .neq('status', 'cancelled');

      if (count >= limite) {
        return res.status(403).json({
          success: false,
          error: 'Has alcanzado el límite de citas este mes de tu plan.',
          code: 'APPOINTMENTS_LIMIT_REACHED'
        });
      }
    }

    const userClient = createUserClient(req.headers.authorization);

    // Servicio y cliente deben ser de este negocio (antes solo se validaba el servicio si no venía precio)
    const { data: service, error: serviceError } = await userClient
      .from('services')
      .select('id, price')
      .eq('id', service_id)
      .eq('business_id', req.businessId)
      .maybeSingle();
    if (serviceError || !service) {
      return res.status(400).json({ success: false, error: 'Servicio no encontrado.' });
    }

    if (client_id) {
      const { data: cliente } = await userClient
        .from('clients')
        .select('id')
        .eq('id', client_id)
        .eq('business_id', req.businessId)
        .maybeSingle();
      if (!cliente) {
        return res.status(400).json({ success: false, error: 'Cliente no encontrado.' });
      }
    }

    let finalPrice = price;
    if (finalPrice == null) finalPrice = service.price;

    let finalEmployeeId = employee_id;
    let availableEmployees = null;

    if (finalEmployeeId) {
      const { data: empleado } = await userClient
        .from('employees')
        .select('id')
        .eq('id', finalEmployeeId)
        .eq('business_id', req.businessId)
        .single();
      if (!empleado) {
        return res.status(400).json({ success: false, error: 'Empleado no pertenece a este negocio.' });
      }
    } else {
      // Hora local de Colombia (no partir el ISO: si viene en UTC daría otra hora)
      const { fecha, hora } = localParts(scheduledAtWithTZ);
      const { data: srvDur } = await supabaseAdmin.from('services').select('duration_minutes').eq('id', service_id).eq('business_id', req.businessId).maybeSingle();
      const durMin = srvDur?.duration_minutes || 30;

      const { data: todosEmpleados } = await supabaseAdmin
        .from('employees')
        .select('id, name, last_appointment_at')
        .eq('business_id', req.businessId)
        .eq('is_active', true);

      if (!todosEmpleados?.length) {
        const slots = await getNextAvailableSlots(req.businessId, fecha, hora, 3, durMin);
        if (slots.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'No hay empleados disponibles en este horario ni en los próximos.',
          });
        }
        return res.status(400).json({
          success: false,
          error: 'Lo siento, ese horario está lleno. Los próximos disponibles son:',
          available_slots: slots,
        });
      }

      // Solape real: considera la duración de la cita nueva y de las existentes (módulo único de disponibilidad)
      const day = await loadDay(req.businessId, fecha);
      const libres = new Set(freeEmployees(day, hora, durMin).map((e) => e.id));
      availableEmployees = todosEmpleados
        .filter(e => libres.has(e.id))
        .sort((a, b) => {
          const fechaA = a.last_appointment_at ? new Date(a.last_appointment_at) : new Date(0);
          const fechaB = b.last_appointment_at ? new Date(b.last_appointment_at) : new Date(0);
          return fechaA - fechaB;
        });

      if (!availableEmployees.length) {
        const slots = await getNextAvailableSlots(req.businessId, fecha, hora, 3, durMin);
        if (slots.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'No hay empleados disponibles en este horario ni en los próximos.',
          });
        }
        return res.status(400).json({
          success: false,
          error: 'Lo siento, ese horario está lleno. Los próximos disponibles son:',
          available_slots: slots,
        });
      }

      finalEmployeeId = availableEmployees[0].id;
    }

    logger.info(`scheduled_at enviado a Supabase: ${scheduledAtWithTZ}`);

    let insertData, insertError;
    let attemptedEmployees = [finalEmployeeId];

    const { data, error } = await userClient
      .from('appointments')
      .insert({
        business_id: req.businessId,
        client_id,
        service_id,
        scheduled_at: scheduledAtWithTZ,
        price: finalPrice,
        notes,
        is_reward: is_reward ?? false,
        source: 'manual',
        status: 'confirmed',
        employee_id: finalEmployeeId,
      })
      .select()
      .single();

    insertData = data;
    insertError = error;

    if (isConflict(insertError) && availableEmployees && availableEmployees.length > 1) {
      logger.info('[DOUBLE_BOOKING_RETRY]', { business_id: req.businessId, employee_id: finalEmployeeId, scheduled_at: scheduledAtWithTZ, retrying: true });

      for (let i = 1; i < availableEmployees.length; i++) {
        const nextEmployeeId = availableEmployees[i].id;
        attemptedEmployees.push(nextEmployeeId);

        const { data: retryData, error: retryError } = await userClient
          .from('appointments')
          .insert({
            business_id: req.businessId,
            client_id,
            service_id,
            scheduled_at: scheduledAtWithTZ,
            price: finalPrice,
            notes,
            is_reward: is_reward ?? false,
            source: 'manual',
            status: 'confirmed',
            employee_id: nextEmployeeId,
          })
          .select()
          .single();

        if (!retryError) {
          insertData = retryData;
          insertError = null;
          finalEmployeeId = nextEmployeeId;
          logger.info('[DOUBLE_BOOKING_RETRY_SUCCESS]', { business_id: req.businessId, employee_id: nextEmployeeId, scheduled_at: scheduledAtWithTZ, attempt: i + 1 });
          break;
        }

        if (!isConflict(retryError)) {
          insertError = retryError;
          break;
        }
      }
    }

    if (isConflict(insertError)) {
      logger.warn('[DOUBLE_BOOKING_ALL_ATTEMPTS_FAILED]', { business_id: req.businessId, attempted_employees: attemptedEmployees, scheduled_at: scheduledAtWithTZ });
      return res.status(409).json({ success: false, error: 'Ese horario ya no está disponible, alguien más lo tomó justo ahora. Elige otro.' });
    }
    if (insertError) throw insertError;

    if (finalEmployeeId) {
      await supabaseAdmin
        .from('employees')
        .update({ last_appointment_at: new Date().toISOString() })
        .eq('id', finalEmployeeId);
    }

    return res.status(201).json({ success: true, data: insertData, assigned_employee_id: finalEmployeeId });
  } catch (err) {
    logger.error(`appointments.create: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function update(req, res) {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: `Estado inválido. Valores válidos: ${VALID_STATUSES.join(', ')}.` });
    }

    // Estado, guard optimista y efectos (WhatsApp al cancelar; loyalty, puntos e ingreso al completar)
    const result = await changeAppointmentStatus({
      db: createUserClient(req.headers.authorization),
      businessId: req.businessId,
      appointmentId: id,
      status,
      notes,
      country: req.business?.country,
    });

    if (result.status === 404) {
      return res.status(404).json({ success: false, error: 'No encontrado' });
    }
    if (result.status === 409) {
      return res.status(409).json({
        success: false,
        error: 'Esta cita fue modificada por otro proceso. Refresca para ver el estado actual.'
      });
    }

    return res.json({ success: true, data: result.data });
  } catch (err) {
    logger.error(`appointments.update: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function updateAppointment(req, res) {
  try {
    const { id } = req.params;
    const { time, employee_id, service_id } = req.body;

    const userClient = createUserClient(req.headers.authorization);

    const { data: existing } = await userClient
      .from('appointments')
      .select('id, scheduled_at')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (!existing) {
      return res.status(404).json({ success: false, error: 'No encontrado' });
    }

    const updates = {};

    if (time !== undefined) {
      // Fecha local de Colombia (el timestamptz llega en UTC) y offset explícito: sin él Postgres lo toma como UTC
      const dateStr = localParts(existing.scheduled_at).fecha;
      updates.scheduled_at = `${dateStr}T${time}:00-05:00`;
    }

    // Empleado y servicio nuevos deben ser de este negocio
    if (employee_id !== undefined && employee_id !== null) {
      const { data: emp } = await userClient
        .from('employees').select('id').eq('id', employee_id).eq('business_id', req.businessId).maybeSingle();
      if (!emp) return res.status(400).json({ success: false, error: 'Empleado no pertenece a este negocio.' });
    }
    if (service_id !== undefined) {
      const { data: srv } = await userClient
        .from('services').select('id').eq('id', service_id).eq('business_id', req.businessId).maybeSingle();
      if (!srv) return res.status(400).json({ success: false, error: 'Servicio no encontrado.' });
    }

    if (employee_id !== undefined) updates.employee_id = employee_id;
    if (service_id !== undefined) updates.service_id = service_id;

    const { data, error } = await userClient
      .from('appointments')
      .update(updates)
      .eq('id', id)
      .eq('business_id', req.businessId)
      .select()
      .single();

    if (isConflict(error)) {
      return res.status(409).json({ success: false, error: 'Ese horario se cruza con otra cita del empleado. Elige otra hora u otro empleado.' });
    }
    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`appointments.updateAppointment: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error al actualizar la cita.' });
  }
}

async function remove(req, res) {
  try {
    const { id } = req.params;
    const userClient = createUserClient(req.headers.authorization);

    const { data: existing } = await userClient
      .from('appointments')
      .select('id, status')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (!existing) {
      return res.status(404).json({ success: false, error: 'No encontrado' });
    }

    const { data, error } = await userClient
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('business_id', req.businessId)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`appointments.remove: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = { getAll, getOne, create, update, updateAppointment, remove };
