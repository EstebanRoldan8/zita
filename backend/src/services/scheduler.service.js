const cron = require('node-cron');
const { sendMessage } = require('../config/whatsapp');
const { supabaseAdmin } = require('../config/supabase');
const { reconcileWompiPaymentsWithAPI } = require('./wompi.service');
const { checkTrialExpiringWarnings } = require('./notification.service');
const { decrypt } = require('../utils/encrypt');
const logger = require('../utils/logger');
const { logSystemAlert } = require('../utils/systemAlerts');
const { maskPhone } = require('../utils/phone');
const { appendMessage } = require('./conversationStore');

let schedulerInitialized = false;

// Cancela una cita: marca el appointment como cancelado (con guard de status), y luego borra
// el income asociado (si existe, no crítico). Orden invertida para evitar inconsistencia si
// el UPDATE falla. Compartido entre el tool cancelar_cita del asistente y el fast-path de
// cancelación por WhatsApp en chatbot.service.js, para evitar que ambos caminos diverjan.
async function deleteCitaIncome(appointmentId, businessId) {
  // PRIMERO: actualizar status a 'cancelled' con guard (solo desde pending/confirmed)
  const { data, error } = await supabaseAdmin
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', appointmentId)
    .eq('business_id', businessId)
    .in('status', ['pending', 'confirmed']) // Guard: solo cancelables desde estos estados
    .select('id');

  if (error) {
    logger.error('[CANCELAR_CITA_UPDATE_FAILED]', { appointmentId, businessId, error: error.message });
    return { success: false, error: error.message };
  }

  if (!data || data.length === 0) {
    logger.error('[CANCELAR_CITA_NOT_FOUND_OR_WRONG_STATUS]', { appointmentId, businessId });
    return { success: false, error: 'Cita no se puede cancelar en su estado actual (quizás ya fue completada o cancelada)' };
  }

  // DESPUÉS: borrar income (no crítico si falla)
  const { error: incomeError } = await supabaseAdmin
    .from('income')
    .delete()
    .eq('appointment_id', appointmentId)
    .eq('business_id', businessId);

  if (incomeError) {
    logger.error('[CANCELAR_CITA_INCOME_DELETE_FAILED]', {
      appointmentId,
      businessId,
      error: incomeError.message
    });
    // No retornamos error — la cita ya fue cancelada, el ingreso es cleanup secundario
  }

  return { success: true };
}

async function acquireLock(lockName, expiresInMinutes = 10) {
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
  const lockKey = `scheduler_${lockName}`;

  // Cleanup: borrar locks expirados para permitir reciclaje. No es críticamente atómico,
  // pero DELETE es idempotent y seguro (si otro proceso lo borra, no hay problema).
  await supabaseAdmin
    .from('scheduler_locks')
    .delete()
    .lt('expires_at', new Date().toISOString());

  // Atomic lock: INSERT directo. Si hay conflicto UNIQUE (otro proceso lo tiene),
  // retorna error 23505. Si INSERT es exitoso, obtuvo el lock.
  const { data: lockData, error: lockError } = await supabaseAdmin
    .from('scheduler_locks')
    .insert({
      lock_key: lockKey,
      expires_at: expiresAt
    })
    .select('lock_key');

  // Otro proceso ya tiene el lock (UNIQUE violation)
  if (lockError?.code === '23505') {
    logger.debug('[ACQUIRE_LOCK_ALREADY_HELD]', { lockKey });
    return false;
  }

  // Error genuino (esquema, permisos, etc.)
  if (lockError) {
    logger.warn('[ACQUIRE_LOCK_INSERT_FAILED]', { lockKey, error: lockError?.message });
    return false;
  }

  // INSERT exitoso: obtuvo el lock
  return true;
}

// Auto-completar citas 1 hora después de la hora programada
async function autoCompleteAppointments() {
  const acquired = await acquireLock('auto_completar', 50);
  if (!acquired) return { completed: 0, errors: [] };

  const errors = [];
  logger.info('Verificando citas para auto-completar...');

  try {
    const unaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    logger.info(`Buscando citas confirmadas antes de ${unaHoraAtras}`);

    const { data: toComplete, error: selectError } = await supabaseAdmin
      .from('appointments')
      .select('id, business_id, price, scheduled_at, source, client_id, services(name, price)')
      .in('status', ['confirmed', 'pending'])
      .lt('scheduled_at', unaHoraAtras)
      .limit(200);

    if (selectError) {
      logger.error('Error obteniendo citas para auto-completar:', selectError.message);
      errors.push(selectError.message);
      return { completed: 0, errors };
    }

    logger.info(`Encontradas ${toComplete?.length || 0} citas para auto-completar`);

    let completed = 0;
    let incomeCreados = 0;
    for (const appointment of toComplete || []) {
      const { data: existingIncome } = await supabaseAdmin
        .from('income')
        .select('id')
        .eq('appointment_id', appointment.id)
        .maybeSingle();

      // Guard optimista: solo marcar como completed si está en pending/confirmed (evita race conditions)
      const { data: updateData, error: updateError } = await supabaseAdmin
        .from('appointments')
        .update({ status: 'completed' })
        .eq('id', appointment.id)
        .in('status', ['pending', 'confirmed']) // Ambos estados válidos para auto-completar
        .select('id');

      if (updateError) {
        logger.error(`Error marcando appointment ${appointment.id} como completed:`, updateError.message);
        errors.push(`appointment ${appointment.id}: ${updateError.message}`);
        continue;
      }

      if (!updateData || updateData.length === 0) {
        logger.warn(`Appointment ${appointment.id} ya fue modificado (status no es pending), saltando`);
        continue;
      }

      completed++;

      if (existingIncome) {
        logger.info(`Income ya existe para appointment ${appointment.id}, solo marcar como completed`);
        continue;
      }

      if (appointment.price && appointment.price > 0) {
        // Verificar que no exista income previo para esta cita
        const { data: existingIncome } = await supabaseAdmin
          .from('income')
          .select('id')
          .eq('appointment_id', appointment.id)
          .limit(1);

        if (!existingIncome || existingIncome.length === 0) {
          const canalLabel = appointment.source === 'whatsapp'
            ? 'agendado por WhatsApp'
            : appointment.source === 'assistant'
              ? 'agendado por Asistente IA'
              : 'agendado manualmente';

          // Insert del income sin .catch() — desestructura el resultado
          const { error: incomeError } = await supabaseAdmin
            .from('income')
            .insert({
              business_id: appointment.business_id,
              appointment_id: appointment.id,
              client_id: appointment.client_id || null,
              amount: appointment.price,
              category: 'servicios',
              description: `${appointment.services?.name} - ${canalLabel} (auto-completado)`,
              source: 'appointment',
              date: new Date(appointment.scheduled_at).toISOString().split('T')[0]
            });

          if (incomeError) {
            logger.error(`Income creation failed for appointment ${appointment.id}:`, incomeError.message);
            errors.push(`income ${appointment.id}: ${incomeError.message}`);
            // NO abortar el loop — continuar con el siguiente appointment
          } else {
            incomeCreados++;
          }
        }
      }
    }

    logger.info(`Auto-completadas ${completed} citas`);
    logger.info(`AUTO_COMPLETE_completadas_${completed}_income_creados_${incomeCreados}`);
    return { completed, errors };
  } catch (error) {
    logger.error('Error en scheduler de auto-completar:', error.message);
    await logSystemAlert('scheduler_autocomplete_failed',
      `Error en scheduler de auto-completar citas: ${error.message}`,
      null,
      { error: error.message });
    errors.push(error.message);
    return { completed: 0, errors };
  }
}

// ── Recordatorios de cita (2 h antes) ──────────────────────────────────────────────────────────────
// - Ventana amplia [now+110, now+125] min + marca reminder_sent_at (migración 063): si el cron se salta una
//   corrida no se pierde el recordatorio, y nunca se manda dos veces (la marca se "reclama" con un UPDATE
//   condicionado antes de enviar).
// - El mensaje pide responder SÍ/NO y queda guardado en el historial de la conversación con
//   kind:'reminder' y el appointment_id: así el atajo de sí/no del bot sabe a qué cita responde el cliente.
// - Nunca se loguea el teléfono completo ni el nombre del cliente.
const REMINDER_FROM_MIN = 110;
const REMINDER_TO_MIN = 125;

async function claimReminder(citaId) {
  const { data, error } = await supabaseAdmin
    .from('appointments')
    .update({ reminder_sent_at: new Date().toISOString() })
    .eq('id', citaId)
    .is('reminder_sent_at', null)
    .select('id');
  if (error) return { ok: false, error };
  return { ok: (data || []).length === 1 };
}

function reminderText(cita) {
  const hora = new Date(cita.scheduled_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
  const nombre = cita.clients?.name && cita.clients.name !== 'Cliente WhatsApp' ? ` ${cita.clients.name}` : '';
  return `⏰ *Recordatorio de tu cita*\n\nHola${nombre}! Te recordamos que tienes una cita en *${cita.businesses?.name}* a las *${hora}* para *${cita.services?.name || 'tu servicio'}*.\n\nResponde *SÍ* para confirmar o *NO* si necesitas cancelarla.`;
}

async function sendAppointmentReminders(now = new Date()) {
  const desde = new Date(now.getTime() + REMINDER_FROM_MIN * 60000).toISOString();
  const hasta = new Date(now.getTime() + REMINDER_TO_MIN * 60000).toISOString();
  const cols = 'id, business_id, scheduled_at, client_id, clients(name, phone), services(name), businesses(name, whatsapp_phone_number_id, whatsapp_access_token)';

  let usaMarca = true;
  let { data: citas, error } = await supabaseAdmin
    .from('appointments')
    .select(cols)
    .in('status', ['pending', 'confirmed'])
    .is('reminder_sent_at', null)
    .gte('scheduled_at', desde)
    .lte('scheduled_at', hasta)
    .limit(500);

  if (error?.code === '42703') {
    // Falta la migración 063 (columna reminder_sent_at): comportamiento anterior, ventana de 5 minutos sin marca
    usaMarca = false;
    logger.warn('[RECORDATORIO] Falta la columna reminder_sent_at (migración 063); se usa la ventana de 5 min');
    ({ data: citas, error } = await supabaseAdmin
      .from('appointments')
      .select(cols)
      .in('status', ['pending', 'confirmed'])
      .gt('scheduled_at', new Date(now.getTime() + 120 * 60000).toISOString())
      .lte('scheduled_at', hasta)
      .limit(500));
  }
  if (error) {
    logger.error('[RECORDATORIO] Error consultando citas:', error.message);
    return { sent: 0, errors: 1 };
  }

  let sent = 0; let errors = 0;
  for (const cita of citas || []) {
    try {
      const negocio = cita.businesses;
      const phone = cita.clients?.phone;
      if (!phone) continue;
      if (!negocio?.whatsapp_phone_number_id || !negocio?.whatsapp_access_token) {
        logger.warn('[SCHEDULER] Recordatorio omitido: negocio sin WhatsApp', { business_id: cita.business_id });
        continue;
      }
      if (usaMarca) {
        const claim = await claimReminder(cita.id);
        if (!claim.ok) continue; // otra instancia ya lo envió (o falló la marca: mejor no duplicar)
      }

      const mensaje = reminderText(cita);
      const token = decrypt(negocio.whatsapp_access_token);
      const sendResult = await sendMessage(phone, mensaje, token, negocio.whatsapp_phone_number_id);
      if (sendResult && sendResult.success === false) {
        errors++;
        logger.error('[RECORDATORIO_SEND_FAILED]', { to: maskPhone(phone), citaId: cita.id, error: sendResult.error });
        await logSystemAlert('whatsapp_send_failed', 'Fallo envío de recordatorio de cita', cita.business_id,
          { to: maskPhone(phone), citaId: cita.id, error: sendResult.error, messageType: 'recordatorio' });
        continue;
      }
      await appendMessage(cita.business_id, phone, { role: 'assistant', content: mensaje, kind: 'reminder', appointment_id: cita.id });
      sent++;
      logger.info('[RECORDATORIO_ENVIADO]', { citaId: cita.id, to: maskPhone(phone) });
    } catch (err) {
      errors++;
      logger.error('Error enviando recordatorio:', err.message);
      await logSystemAlert('whatsapp_send_failed', 'Excepción en envío de recordatorio de cita', cita.business_id || null,
        { error: err.message, messageType: 'recordatorio' });
    }
  }
  return { sent, errors };
}

const initScheduler = () => {
if (schedulerInitialized) {
  logger.warn('initScheduler ya fue inicializado, ignorando llamada duplicada');
  return;
}
schedulerInitialized = true;

// Resumen diario a las 7am Colombia (12:00 UTC)
cron.schedule('0 12 * * *', async () => {
  const acquired = await acquireLock('resumen_diario', 60);
  if (!acquired) return;

  logger.info('Enviando resumen diario a negocios...');

  const hoy = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Bogota'
  });

  const { data: negocios } = await supabaseAdmin
    .from('businesses')
    .select('id, name, owner_whatsapp, whatsapp_phone_number_id, whatsapp_access_token')
    .not('owner_whatsapp', 'is', null);

  for (const negocio of negocios || []) {
    if (!negocio.whatsapp_phone_number_id || !negocio.whatsapp_access_token) {
      logger.warn('[SCHEDULER] Skipping reminder for business without WhatsApp', { business_id: negocio.id });
      continue;
    }

    try {
      const { data: citas } = await supabaseAdmin
        .from('appointments')
        .select('scheduled_at, status, clients(name), services(name, price)')
        .eq('business_id', negocio.id)
        .gte('scheduled_at', hoy + 'T00:00:00-05:00')
        .lte('scheduled_at', hoy + 'T23:59:59-05:00')
        .in('status', ['confirmed', 'pending'])
        .order('scheduled_at')
        .limit(200);

      if (!citas || citas.length === 0) continue;

      const total = citas.reduce((sum, c) => sum + (c.services?.price || 0), 0);
      const lista = citas.map(c => {
        const hora = new Date(c.scheduled_at).toLocaleTimeString('es-CO', {
          hour: '2-digit', minute: '2-digit',
          timeZone: 'America/Bogota'
        });
        const cliente = c.clients?.name || 'Cliente ocasional';
        const servicio = c.services?.name || 'Servicio';
        return `• ${hora} - ${cliente} - ${servicio}`;
      }).join('\n');

      const mensaje = `🗓️ *Buenos días! Resumen de citas para hoy:*\n\n${lista}\n\n💰 *Total estimado: $${total.toLocaleString('es-CO')}*\n\n¡Que sea un gran día! 💪`;

      const token = decrypt(negocio.whatsapp_access_token);
      await sendMessage(negocio.owner_whatsapp, mensaje, token, negocio.whatsapp_phone_number_id);
      logger.info(`Resumen enviado a ${negocio.name}`);
    } catch (error) {
      logger.error(`Error enviando resumen a ${negocio.name}:`, error.message);
    }
  }
});

// Recordatorio 2 horas antes - cada 5 minutos
cron.schedule('*/5 * * * *', async () => {
  const acquired = await acquireLock('recordatorios', 4);
  if (!acquired) return;
  try {
    await sendAppointmentReminders();
  } catch (error) {
    logger.error('Error en scheduler de recordatorios:', error.message);
  }
});

// Auto-completar citas cada 15 minutos
cron.schedule('*/15 * * * *', autoCompleteAppointments);

// Reconciliación de pagos Wompi cada 2 horas — Wompi reintenta webhooks hasta 24h,
// pero no queremos esperar tanto si el webhook se perdió definitivamente. Compara
// las transacciones APROBADAS en Wompi (últimos 2 días) contra la tabla payments
// de ZITA y activa el plan si encuentra una aprobación que nunca llegó por webhook.
cron.schedule('0 */2 * * *', async () => {
  const acquired = await acquireLock('wompi_reconciliation', 30);
  if (!acquired) return;

  logger.info('[WOMPI_CRON] Reconciliation job started');
  try {
    await reconcileWompiPaymentsWithAPI();
  } catch (error) {
    logger.error('[WOMPI_CRON] Reconciliation job failed:', error.message);
  }
});

// Aviso de trial por vencer (3 días antes) — 14:00 UTC = 09:00 AM Bogotá.
// Corre en la mañana para que el dueño reciba el aviso por WhatsApp a una
// hora razonable.
cron.schedule('0 14 * * *', async () => {
  const acquired = await acquireLock('trial_warning', 30);
  if (!acquired) return;

  logger.info('[TRIAL_WARNING_CRON] Job started');
  try {
    const resultado = await checkTrialExpiringWarnings();
    logger.info('[TRIAL_WARNING_CRON] Job finished', resultado);
  } catch (error) {
    logger.error('[TRIAL_WARNING_CRON] Job failed:', error.message);
  }
});

  logger.info('=== SCHEDULER CARGADO ===');
  logger.info('Tareas activas:');
  logger.info('  • Resumen diario a las 12:00 UTC (7am Colombia)');
  logger.info('  • Recordatorio 2 horas antes cada 5 minutos (testing)');
  logger.info('  • Auto-completar citas cada 15 minutos (1 hora después de scheduled_at)');
  logger.info('  • Reconciliación de pagos Wompi cada 2 horas');
  logger.info('  • Aviso de trial por vencer a las 09:00 UTC (4am Colombia)');
  logger.info('Usando database locks para evitar duplicados en múltiples instancias');
};

module.exports = { initScheduler, autoCompleteAppointments, deleteCitaIncome, sendAppointmentReminders, reminderText };
