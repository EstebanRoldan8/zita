const { createUserClient, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { getTimezone, getOffsetForTz } = require('../utils/timezone');
const { getAvailableEmployee, getNextAvailableSlots } = require('../utils/availability');
const { sendMessage } = require('../config/whatsapp');
const { decrypt } = require('../utils/encrypt');

async function awardLoyaltyPoints(businessId, clientId, appointmentId) {
  try {
    const { data: cfg } = await supabaseAdmin
      .from('loyalty_config').select('points_per_appointment')
      .eq('business_id', businessId).maybeSingle();

    const pts = cfg?.points_per_appointment ?? 10;
    if (pts <= 0) return;

    const { data: client } = await supabaseAdmin
      .from('clients').select('loyalty_points').eq('id', clientId).single();

    const [pointsResult, transactionResult] = await Promise.all([
      supabaseAdmin.from('clients')
        .update({ loyalty_points: (client?.loyalty_points || 0) + pts })
        .eq('id', clientId)
        .select('id'),
      supabaseAdmin.from('loyalty_transactions').insert({
        business_id: businessId, client_id: clientId,
        points: pts, reason: 'Cita completada', appointment_id: appointmentId,
      }).select('id'),
    ]);

    if (pointsResult.error || !pointsResult.data || pointsResult.data.length === 0) {
      logger.error('[AWARD_LOYALTY_POINTS_UPDATE_FAILED]', { businessId, clientId, appointmentId, error: pointsResult.error?.message });
    }
    if (transactionResult.error || !transactionResult.data || transactionResult.data.length === 0) {
      logger.error('[AWARD_LOYALTY_TRANSACTION_INSERT_FAILED]', { businessId, clientId, appointmentId, error: transactionResult.error?.message });
    }
  } catch (err) {
    logger.error('awardLoyaltyPoints: ' + err.message);
  }
}

async function getAll(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);

    let query = userClient
      .from('appointments')
      .select('id, scheduled_at, status, source, price, notes, clients(id, name, phone), services(id, name), employees(name)')
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

    let finalPrice = price;
    if (finalPrice == null) {
      const { data: service, error: serviceError } = await userClient
        .from('services')
        .select('price')
        .eq('id', service_id)
        .eq('business_id', req.businessId)
        .single();
      if (serviceError || !service) {
        return res.status(400).json({ success: false, error: 'Servicio no encontrado.' });
      }
      finalPrice = service.price;
    }

    let finalEmployeeId = employee_id;

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
      const fecha = scheduledAtWithTZ.slice(0, 10);
      const hora = scheduledAtWithTZ.slice(11, 16);
      const available = await getAvailableEmployee(req.businessId, fecha, hora);

      if (!available) {
        const slots = await getNextAvailableSlots(req.businessId, fecha, hora, 3);
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
      finalEmployeeId = available.id;
    }

    logger.info(`scheduled_at enviado a Supabase: ${scheduledAtWithTZ}`);

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
        employee_id: finalEmployeeId,
      })
      .select()
      .single();

    if (error?.code === '23505') {
      logger.warn('[DOUBLE_BOOKING_ATTEMPT]', { business_id: req.businessId, employee_id: finalEmployeeId, scheduled_at: scheduledAtWithTZ });
      return res.status(409).json({ success: false, error: 'Ese horario ya no está disponible, alguien más lo tomó justo ahora. Elige otro.' });
    }
    if (error) throw error;

    if (finalEmployeeId) {
      await supabaseAdmin
        .from('employees')
        .update({ last_appointment_at: new Date().toISOString() })
        .eq('id', finalEmployeeId);
    }

    return res.status(201).json({ success: true, data, assigned_employee_id: finalEmployeeId });
  } catch (err) {
    logger.error(`appointments.create: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

const VALID_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

async function update(req, res) {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: `Estado inválido. Valores válidos: ${VALID_STATUSES.join(', ')}.` });
    }

    const userClient = createUserClient(req.headers.authorization);

    const { data: existing } = await userClient
      .from('appointments')
      .select('id, status, client_id, price, service_id, source')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (!existing) {
      return res.status(404).json({ success: false, error: 'No encontrado' });
    }

    const updates = {};
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;

    // Construir UPDATE con guard optimista: si status cambia, verificar que no haya sido modificado
    let updateQuery = userClient
      .from('appointments')
      .update(updates)
      .eq('id', id)
      .eq('business_id', req.businessId);

    // Guard de status: solo permitir si el status actual es el que esperamos (evita race conditions)
    if (status !== undefined && existing.status !== status) {
      updateQuery = updateQuery.eq('status', existing.status);
    }

    const { data, error } = await updateQuery.select().maybeSingle();

    if (error) throw error;

    // Si se intentó cambiar status pero otro proceso ya lo cambió (0 filas por guard), retornar 409
    if (status !== undefined && existing.status !== status && !data) {
      return res.status(409).json({
        success: false,
        error: 'Esta cita fue modificada por otro proceso. Refresca para ver el estado actual.'
      });
    }

    // Enviar notificación por WhatsApp cuando se cancela una cita
    if (status === 'cancelled') {
      try {
        const { data: fullAppt } = await userClient
          .from('appointments')
          .select('id, client_id, scheduled_at, source, services(name), clients(phone)')
          .eq('id', id)
          .single();

        // Solo enviar si es cita de WhatsApp y tiene cliente
        if (fullAppt?.source === 'whatsapp' && fullAppt?.client_id) {
          try {
            const clientPhone = fullAppt?.clients?.phone;
            const serviceName = fullAppt?.services?.name || 'tu servicio';

            if (clientPhone) {
              // Obtener token de WhatsApp del negocio
              const { data: business } = await supabaseAdmin
                .from('businesses')
                .select('whatsapp_access_token')
                .eq('id', req.businessId)
                .single();

              if (business?.whatsapp_access_token) {
                const token = decrypt(business.whatsapp_access_token);

                // Formatear fecha y hora
                const _apptTz = getTimezone(req.business?.country);
                const fecha = new Date(fullAppt.scheduled_at)
                  .toLocaleDateString('es-CO', {
                    timeZone: _apptTz,
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long'
                  });
                const hora = new Date(fullAppt.scheduled_at)
                  .toLocaleTimeString('es-CO', {
                    timeZone: _apptTz,
                    hour: '2-digit',
                    minute: '2-digit'
                  });

                const mensaje = `Hola! 😔 Lamentamos informarte que tu cita de ${serviceName} el ${fecha} a las ${hora} tuvo que ser cancelada.\n¿Te gustaría reagendarla? Con gusto te buscamos otro horario 🗓️`;

                await sendMessage(clientPhone, mensaje);
                logger.info(`Mensaje de cancelación enviado a cliente ${clientPhone}`);

                // Limpiar historial de conversación para que el bot empiece fresco
                await supabaseAdmin
                  .from('whatsapp_conversations')
                  .upsert({
                    business_id: req.businessId,
                    client_phone: clientPhone,
                    messages: []
                  }, { onConflict: 'business_id,client_phone' });
                logger.info(`Historial de conversación limpiado para ${clientPhone}`);
              }
            }
          } catch (waErr) {
            logger.error(`appointments.update: error sending WA cancellation - ${waErr.message}`);
          }
        }
      } catch (cancelErr) {
        logger.error(`appointments.update: error fetching appointment for WA notification - ${cancelErr.message}`);
      }
    }

    // Actualizar contadores de visitas cuando la cita pasa a completada
    if (status === 'completed' && existing.status !== 'completed' && existing.client_id) {
      try {
        // Obtener is_reward, price, source y client del appointment
        const { data: appt } = await userClient
          .from('appointments')
          .select('is_reward, price, source, clients(name)')
          .eq('id', id)
          .single();

        const isReward = appt?.is_reward ?? false;
        const price = appt?.price ?? 0;
        const clientName = appt?.clients?.name || 'Cliente desconocido';

        // Obtener registro actual de client_loyalty
        const { data: loyalty } = await userClient
          .from('client_loyalty')
          .select('total_visits, loyalty_visits')
          .eq('business_id', req.businessId)
          .eq('client_id', existing.client_id)
          .maybeSingle();

        // Calcular nuevos valores
        let newTotalVisits = (loyalty?.total_visits ?? 0) + 1;
        let newLoyaltyVisits = isReward
          ? (loyalty?.loyalty_visits ?? 0)
          : (loyalty?.loyalty_visits ?? 0) + 1;

        // Upsert a client_loyalty
        const { data: loyaltyUpsertData, error: loyaltyUpsertError } = await userClient
          .from('client_loyalty')
          .upsert(
            {
              business_id: req.businessId,
              client_id: existing.client_id,
              total_visits: newTotalVisits,
              loyalty_visits: newLoyaltyVisits,
            },
            { onConflict: 'business_id,client_id' }
          )
          .select('id');

        if (loyaltyUpsertError || !loyaltyUpsertData || loyaltyUpsertData.length === 0) {
          logger.error('[CLIENT_LOYALTY_UPSERT_FAILED]', {
            businessId: req.businessId,
            clientId: existing.client_id,
            error: loyaltyUpsertError?.message
          });
        }

        // Si es cita de recompensa, registrar el costo como egreso automático
        if (isReward && price > 0) {
          await userClient
            .from('expenses')
            .insert({
              business_id: req.businessId,
              category: 'otro',
              amount: price,
              description: `Servicio de recompensa para ${clientName}`,
              date: new Date().toLocaleDateString('en-CA', { timeZone: getTimezone(req.business?.country) }),
            });
        }
      } catch (loyaltyErr) {
        logger.error(`appointments.update: error updating loyalty - ${loyaltyErr.message}`);
      }

      // Sumar puntos de fidelización (independiente)
      try {
        await awardLoyaltyPoints(req.businessId, existing.client_id, id);
      } catch (loyaltyError) {
        logger.error('Error otorgando puntos de fidelización:', loyaltyError.message);
      }
    }

    // Crear income al completar manualmente — aplica con o sin cliente
    if (status === 'completed' && existing.status !== 'completed') {
      try {
        const price = existing.price ?? 0;
        if (price > 0) {
          const { data: existingIncome } = await supabaseAdmin
            .from('income')
            .select('id')
            .eq('appointment_id', id)
            .maybeSingle();

          if (!existingIncome) {
            const { data: serviceData } = await supabaseAdmin
              .from('services')
              .select('name')
              .eq('id', existing.service_id)
              .maybeSingle();

            const { data: apptSource } = await supabaseAdmin
              .from('appointments')
              .select('source')
              .eq('id', id)
              .maybeSingle();

            const source = apptSource?.source || 'manual';
            const nombre = serviceData?.name || 'Servicio';
            const description = source === 'whatsapp'
              ? `${nombre} - agendado por WhatsApp`
              : source === 'assistant'
              ? `${nombre} - agendado por Asistente IA`
              : `${nombre} - agendado manualmente`;

            const { data: incomeInsertData, error: incomeInsertError } = await supabaseAdmin
              .from('income')
              .insert({
                business_id: req.businessId,
                amount: price,
                category: 'servicios',
                description,
                source: 'appointment',
                appointment_id: id,
                client_id: existing.client_id || null,
                date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
              })
              .select('id')
              .single();

            if (incomeInsertError?.code === '23505') {
              logger.warn('[INCOME_DUPLICATE_BLOCKED]', { appointment_id: id });
            } else if (incomeInsertError || !incomeInsertData?.id) {
              logger.error('[COMPLETAR_CITA_MANUAL_INCOME_INSERT_FAILED]', {
                businessId: req.businessId,
                appointmentId: id,
                error: incomeInsertError?.message
              });
            }
          }
        }
      } catch (incomeErr) {
        logger.error('Error creando income al completar cita:', incomeErr.message);
      }
    }

    return res.json({ success: true, data });
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
      const dateStr = existing.scheduled_at.slice(0, 10);
      updates.scheduled_at = `${dateStr}T${time}:00`;
    }

    if (employee_id !== undefined) updates.employee_id = employee_id;
    if (service_id !== undefined) updates.service_id = service_id;

    const { data, error } = await userClient
      .from('appointments')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

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
