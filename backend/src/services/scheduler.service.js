const cron = require('node-cron');
const { sendMessage } = require('../config/whatsapp');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

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

const initScheduler = () => {

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
    .select('id, name, owner_whatsapp, whatsapp_phone_number_id')
    .not('owner_whatsapp', 'is', null);

  for (const negocio of negocios || []) {
    try {
      const { data: citas } = await supabaseAdmin
        .from('appointments')
        .select('scheduled_at, status, clients(name), services(name, price)')
        .eq('business_id', negocio.id)
        .gte('scheduled_at', hoy + 'T00:00:00-05:00')
        .lte('scheduled_at', hoy + 'T23:59:59-05:00')
        .in('status', ['confirmed', 'pending'])
        .order('scheduled_at');

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

      await sendMessage(negocio.owner_whatsapp, mensaje);
      logger.info(`Resumen enviado a ${negocio.name}`);
    } catch (error) {
      logger.error(`Error enviando resumen a ${negocio.name}:`, error.message);
    }
  }
});

// Recordatorio 2 horas antes - cada 5 minutos (temporal para testing)
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
      .select('id, scheduled_at, clients(name, phone), services(name), businesses(name)')
      .eq('status', 'confirmed')
      .gte('scheduled_at', en2h.toISOString())
      .lte('scheduled_at', en2h5m.toISOString())
      .not('clients.phone', 'is', null);

    logger.info('Citas a recordar encontradas:', citas?.length);

    if (!citas || citas.length === 0) {
      logger.info('No hay citas próximas para recordar');
    }

    for (const cita of citas || []) {
      try {
        const hora = new Date(cita.scheduled_at).toLocaleTimeString('es-CO', {
          hour: '2-digit', minute: '2-digit',
          timeZone: 'America/Bogota'
        });

        const mensaje = `⏰ *Recordatorio de tu cita*\n\nHola ${cita.clients?.name}! Te recordamos que tienes una cita en *${cita.businesses?.name}* a las *${hora}* para un *${cita.services?.name}*.\n\n¡Te esperamos! 💈`;

        await sendMessage(cita.clients.phone, mensaje);
        logger.info(`Recordatorio enviado a ${cita.clients.name}`);
      } catch (error) {
        logger.error('Error enviando recordatorio:', error.message);
      }
    }
  } catch (error) {
    logger.error('Error en scheduler de recordatorios:', error.message);
  }
});

// Auto-completar citas 1 hora después de la hora programada
cron.schedule('0 * * * *', async () => {
  const acquired = await acquireLock('auto_completar', 55);
  if (!acquired) return;

  logger.info('Verificando citas para auto-completar...');

  try {
    const unaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: toComplete, error: selectError } = await supabaseAdmin
      .from('appointments')
      .select('id, business_id, services(name, price)')
      .eq('status', 'confirmed')
      .lt('scheduled_at', unaHoraAtras);

    if (selectError) {
      logger.error('Error obteniendo citas para auto-completar:', selectError.message);
      return;
    }

    for (const appointment of toComplete || []) {
      const { data: existingIncome } = await supabaseAdmin
        .from('income')
        .select('id')
        .eq('appointment_id', appointment.id)
        .maybeSingle();

      if (existingIncome) {
        logger.info(`Income ya existe para appointment ${appointment.id}, skipping`);
        continue;
      }

      const { error: updateError } = await supabaseAdmin
        .from('appointments')
        .update({ status: 'completed' })
        .eq('id', appointment.id);

      if (updateError) {
        logger.error(`Error marcando appointment ${appointment.id} como completed:`, updateError.message);
        continue;
      }

      if (appointment.services?.price && appointment.services.price > 0) {
        const { data: existingIncome } = await supabaseAdmin
          .from('income')
          .select('id')
          .eq('appointment_id', appointment.id)
          .limit(1);

        if (!existingIncome || existingIncome.length === 0) {
          await supabaseAdmin
            .from('income')
            .insert({
              business_id: appointment.business_id,
              amount: appointment.services.price,
              category: 'servicios',
              description: `${appointment.services.name} - auto-completado`,
              source: 'appointment',
              appointment_id: appointment.id,
              date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
            })
            .catch(err => logger.error(`Error creando income para appointment ${appointment.id}:`, err.message));
        }
      }
    }

    logger.info(`Auto-completadas ${toComplete?.length || 0} citas`);
  } catch (error) {
    logger.error('Error en scheduler de auto-completar:', error.message);
  }
});

  logger.info('=== SCHEDULER CARGADO ===');
  logger.info('Tareas activas:');
  logger.info('  • Resumen diario a las 12:00 UTC (7am Colombia)');
  logger.info('  • Recordatorio 2 horas antes cada 5 minutos (testing)');
  logger.info('  • Auto-completar citas cada hora (1 hora después de scheduled_at)');
  logger.info('Usando database locks para evitar duplicados en múltiples instancias');
};

module.exports = { initScheduler };
