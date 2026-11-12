// Cambio de estado de una cita y sus efectos (compartido por el dueño y el panel del empleado):
//   - cancelar: aviso por WhatsApp al cliente si la cita vino por WhatsApp y limpieza de la conversación
//   - completar: visitas (client_loyalty), egreso si es recompensa, puntos de fidelización e ingreso
// `db` es el cliente con el que se lee/escribe: el del JWT del dueño (RLS) o el admin para el empleado.
// Todas las consultas filtran por business_id (y por employee_id cuando se pasa).
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { getTimezone } = require('../utils/timezone');
const { sendMessage } = require('../config/whatsapp');
const { decrypt } = require('../utils/encrypt');
const { maskPhone } = require('../utils/phone');

const VALID_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

async function awardLoyaltyPoints(businessId, clientId, appointmentId) {
  try {
    const { data: cfg } = await supabaseAdmin
      .from('loyalty_config').select('points_per_appointment')
      .eq('business_id', businessId).maybeSingle();

    const pts = cfg?.points_per_appointment ?? 10;
    if (pts <= 0) return;

    const { data: client } = await supabaseAdmin
      .from('clients').select('loyalty_points').eq('id', clientId).eq('business_id', businessId).single();

    const [pointsResult, transactionResult] = await Promise.all([
      supabaseAdmin.from('clients')
        .update({ loyalty_points: (client?.loyalty_points || 0) + pts })
        .eq('id', clientId)
        .eq('business_id', businessId)
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

async function notifyCancellation({ db, businessId, appointmentId, country }) {
  try {
    const { data: fullAppt } = await db
      .from('appointments')
      .select('id, client_id, scheduled_at, source, services(name), clients(phone)')
      .eq('id', appointmentId)
      .eq('business_id', businessId)
      .single();

    // Solo enviar si es cita de WhatsApp y tiene cliente
    if (fullAppt?.source !== 'whatsapp' || !fullAppt?.client_id) return;
    try {
      const clientPhone = fullAppt?.clients?.phone;
      const serviceName = fullAppt?.services?.name || 'tu servicio';
      if (!clientPhone) return;

      const { data: business } = await supabaseAdmin
        .from('businesses')
        .select('whatsapp_access_token')
        .eq('id', businessId)
        .single();
      if (!business?.whatsapp_access_token) return;

      // Se conserva el comportamiento previo: el token del negocio solo se valida (decrypt) y el envío
      // usa el número por defecto de config/whatsapp. Pendiente aparte: enviar con el número del negocio.
      decrypt(business.whatsapp_access_token);

      const tz = getTimezone(country);
      const fecha = new Date(fullAppt.scheduled_at)
        .toLocaleDateString('es-CO', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
      const hora = new Date(fullAppt.scheduled_at)
        .toLocaleTimeString('es-CO', { timeZone: tz, hour: '2-digit', minute: '2-digit' });

      const mensaje = `Hola! 😔 Lamentamos informarte que tu cita de ${serviceName} el ${fecha} a las ${hora} tuvo que ser cancelada.\n¿Te gustaría reagendarla? Con gusto te buscamos otro horario 🗓️`;

      await sendMessage(clientPhone, mensaje);
      logger.info(`Mensaje de cancelación enviado a cliente ${maskPhone(clientPhone)}`);

      // Limpiar historial de conversación para que el bot empiece fresco
      await supabaseAdmin
        .from('whatsapp_conversations')
        .upsert({ business_id: businessId, client_phone: clientPhone, messages: [] }, { onConflict: 'business_id,client_phone' });
      logger.info(`Historial de conversación limpiado para ${maskPhone(clientPhone)}`);
    } catch (waErr) {
      logger.error(`appointments.update: error sending WA cancellation - ${waErr.message}`);
    }
  } catch (cancelErr) {
    logger.error(`appointments.update: error fetching appointment for WA notification - ${cancelErr.message}`);
  }
}

async function applyCompletion({ db, businessId, appointmentId, existing, country }) {
  // Visitas de fidelización y egreso de recompensa (solo con cliente)
  if (existing.client_id) {
    try {
      const { data: appt } = await db
        .from('appointments')
        .select('is_reward, price, source, clients(name)')
        .eq('id', appointmentId)
        .eq('business_id', businessId)
        .single();

      const isReward = appt?.is_reward ?? false;
      const price = appt?.price ?? 0;
      const clientName = appt?.clients?.name || 'Cliente desconocido';

      const { data: loyalty } = await db
        .from('client_loyalty')
        .select('total_visits, loyalty_visits')
        .eq('business_id', businessId)
        .eq('client_id', existing.client_id)
        .maybeSingle();

      const newTotalVisits = (loyalty?.total_visits ?? 0) + 1;
      const newLoyaltyVisits = isReward
        ? (loyalty?.loyalty_visits ?? 0)
        : (loyalty?.loyalty_visits ?? 0) + 1;

      const { data: loyaltyUpsertData, error: loyaltyUpsertError } = await db
        .from('client_loyalty')
        .upsert(
          { business_id: businessId, client_id: existing.client_id, total_visits: newTotalVisits, loyalty_visits: newLoyaltyVisits },
          { onConflict: 'business_id,client_id' }
        )
        .select('id');

      if (loyaltyUpsertError || !loyaltyUpsertData || loyaltyUpsertData.length === 0) {
        logger.error('[CLIENT_LOYALTY_UPSERT_FAILED]', { businessId, clientId: existing.client_id, error: loyaltyUpsertError?.message });
      }

      // Si es cita de recompensa, registrar el costo como egreso automático
      if (isReward && price > 0) {
        await db
          .from('expenses')
          .insert({
            business_id: businessId,
            category: 'otro',
            amount: price,
            description: `Servicio de recompensa para ${clientName}`,
            date: new Date().toLocaleDateString('en-CA', { timeZone: getTimezone(country) }),
          });
      }
    } catch (loyaltyErr) {
      logger.error(`appointments.update: error updating loyalty - ${loyaltyErr.message}`);
    }

    // Sumar puntos de fidelización (independiente)
    try {
      await awardLoyaltyPoints(businessId, existing.client_id, appointmentId);
    } catch (loyaltyError) {
      logger.error('Error otorgando puntos de fidelización:', loyaltyError.message);
    }
  }

  // Ingreso al completar — aplica con o sin cliente
  try {
    const price = existing.price ?? 0;
    if (price <= 0) return;

    const { data: existingIncome } = await supabaseAdmin
      .from('income')
      .select('id')
      .eq('appointment_id', appointmentId)
      .maybeSingle();
    if (existingIncome) return;

    const { data: serviceData } = await supabaseAdmin
      .from('services')
      .select('name')
      .eq('id', existing.service_id)
      .maybeSingle();

    const { data: apptSource } = await supabaseAdmin
      .from('appointments')
      .select('source')
      .eq('id', appointmentId)
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
        business_id: businessId,
        amount: price,
        category: 'servicios',
        description,
        source: 'appointment',
        appointment_id: appointmentId,
        client_id: existing.client_id || null,
        date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }),
      })
      .select('id')
      .single();

    if (incomeInsertError?.code === '23505') {
      logger.warn('[INCOME_DUPLICATE_BLOCKED]', { appointment_id: appointmentId });
    } else if (incomeInsertError || !incomeInsertData?.id) {
      logger.error('[COMPLETAR_CITA_MANUAL_INCOME_INSERT_FAILED]', { businessId, appointmentId, error: incomeInsertError?.message });
    }
  } catch (incomeErr) {
    logger.error('Error creando income al completar cita:', incomeErr.message);
  }
}

// Cambia estado/notas de una cita con guard optimista y aplica los efectos.
// opts.employeeId: restringe a las citas de ese empleado (panel del empleado).
// opts.allowedFrom: estados desde los que se permite el cambio (si no, 409).
// Devuelve { status: 200, data } | { status: 404 } | { status: 409, reason }
async function changeAppointmentStatus({ db, businessId, appointmentId, status, notes, employeeId, allowedFrom, country }) {
  let existingQuery = db
    .from('appointments')
    .select('id, status, client_id, price, service_id, source')
    .eq('id', appointmentId)
    .eq('business_id', businessId);
  if (employeeId) existingQuery = existingQuery.eq('employee_id', employeeId);

  const { data: existing } = await existingQuery.single();
  if (!existing) return { status: 404 };

  if (allowedFrom && !allowedFrom.includes(existing.status)) {
    return { status: 409, reason: 'invalid_transition', current: existing.status };
  }

  const updates = {};
  if (status !== undefined) updates.status = status;
  if (notes !== undefined) updates.notes = notes;

  let updateQuery = db
    .from('appointments')
    .update(updates)
    .eq('id', appointmentId)
    .eq('business_id', businessId);
  if (employeeId) updateQuery = updateQuery.eq('employee_id', employeeId);

  // Guard de status: solo si el status actual es el que esperamos (evita race conditions)
  if (status !== undefined && existing.status !== status) {
    updateQuery = updateQuery.eq('status', existing.status);
  }

  const { data, error } = await updateQuery.select().maybeSingle();
  if (error) throw error;

  // Se intentó cambiar status pero otro proceso ya lo cambió (0 filas por guard)
  if (status !== undefined && existing.status !== status && !data) {
    return { status: 409, reason: 'concurrent' };
  }

  if (status === 'cancelled') {
    await notifyCancellation({ db, businessId, appointmentId, country });
  }

  if (status === 'completed' && existing.status !== 'completed') {
    await applyCompletion({ db, businessId, appointmentId, existing, country });
  }

  return { status: 200, data };
}

module.exports = { VALID_STATUSES, changeAppointmentStatus, awardLoyaltyPoints };
