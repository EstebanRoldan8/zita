const cron = require('node-cron');
const { sendMessage } = require('../config/whatsapp');
const { supabaseAdmin } = require('../config/supabase');
const { reconcileWompiPaymentsWithAPI } = require('./wompi.service');
const { checkTrialExpiringWarnings } = require('./notification.service');
const { decrypt } = require('../utils/encrypt');
const logger = require('../utils/logger');

let schedulerInitialized = false;

// Cancela una cita: borra el income asociado (si existe, no crítico) y marca el appointment
// como cancelado, validando que el UPDATE haya afectado una fila real antes de reportar éxito.
// Compartido entre el tool cancelar_cita del asistente y el fast-path de cancelación por WhatsApp
// en chatbot.service.js, para evitar que ambos caminos diverjan.
async function deleteCitaIncome(appointmentId, businessId) {
  const { error: incomeError } = await supabaseAdmin
    .from('income')
    .delete()
    .eq('appointment_id', appointmentId)
    .eq('business_id', businessId);

  if (incomeError) {
    // No crítico: es limpieza del ingreso asociado. Continuamos con la cancelación de la cita.
    logger.error('[CANCELAR_CITA_INCOME_DELETE_FAILED]', {
      appointmentId,
      businessId,
      error: incomeError.message
    });
  }

  const { data, error } = await supabaseAdmin
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', appointmentId)
    .eq('business_id', businessId)
    .select('id');

  if (error) {
    logger.error('[CANCELAR_CITA_UPDATE_FAILED]', { appointmentId, businessId, error: error.message });
    return { success: false, error: error.message };
  }

  if (!data || data.length === 0) {
    logger.error('[CANCELAR_CITA_NOT_FOUND]', { appointmentId, businessId });
    return { success: false, error: 'Cita no encontrada' };
  }

  return { success: true };
}

async function acquireLock(lockName, expiresInMinutes = 10) {
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
  const lockKey = `scheduler_${lockName}`;

  const { data: existing } = await supabaseAdmin
    .from('scheduler_locks')
    .select('expires_at')
    .eq('lock_key', lockKey)
    .maybeSingle();

  if (existing && new Date(existing.expires_at) > new Date()) {
    return false;
  }

  await supabaseAdmin
    .from('scheduler_locks')
    .upsert({
      lock_key: lockKey,
      expires_at: expiresAt
    }, { onConflict: 'lock_key' });

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
      .select('id, business_id, price, scheduled_at, source, services(name, price)')
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

      const { error: updateError } = await supabaseAdmin
        .from('appointments')
        .update({ status: 'completed' })
        .eq('id', appointment.id);

      if (updateError) {
        logger.error(`Error marcando appointment ${appointment.id} como completed:`, updateError.message);
        errors.push(`appointment ${appointment.id}: ${updateError.message}`);
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
    errors.push(error.message);
    return { completed: 0, errors };
  }
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

  logger.info('CRON RECORDATORIO CORRIENDO', new Date().toISOString());
  try {
    const ahora = new Date();
    const en2h = new Date(ahora.getTime() + 120 * 60 * 1000);
    const en2h5m = new Date(ahora.getTime() + 125 * 60 * 1000);

    const { data: citas } = await supabaseAdmin
      .from('appointments')
      .select('id, business_id, scheduled_at, clients(name, phone), services(name), businesses(name, whatsapp_phone_number_id, whatsapp_access_token)')
      .eq('status', 'confirmed')
      .gte('scheduled_at', en2h.toISOString())
      .lte('scheduled_at', en2h5m.toISOString())
      .not('clients.phone', 'is', null)
      .limit(500);

    logger.info('Citas a recordar encontradas:', citas?.length);

    if (!citas || citas.length === 0) {
      logger.info('No hay citas próximas para recordar');
    }

    for (const cita of citas || []) {
      try {
        const negocio = cita.businesses;

        if (!negocio?.whatsapp_phone_number_id || !negocio?.whatsapp_access_token) {
          logger.warn('[SCHEDULER] Skipping reminder for business without WhatsApp', { business_id: cita.business_id });
          continue;
        }

        const hora = new Date(cita.scheduled_at).toLocaleTimeString('es-CO', {
          hour: '2-digit', minute: '2-digit',
          timeZone: 'America/Bogota'
        });

        const mensaje = `⏰ *Recordatorio de tu cita*\n\nHola ${cita.clients?.name}! Te recordamos que tienes una cita en *${negocio?.name}* a las *${hora}* para un *${cita.services?.name}*.\n\n¡Te esperamos! 💈`;

        const token = decrypt(negocio.whatsapp_access_token);
        await sendMessage(cita.clients.phone, mensaje, token, negocio.whatsapp_phone_number_id);
        logger.info(`Recordatorio enviado a ${cita.clients.name}`);
      } catch (error) {
        logger.error('Error enviando recordatorio:', error.message);
      }
    }
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

module.exports = { initScheduler, autoCompleteAppointments, deleteCitaIncome };
