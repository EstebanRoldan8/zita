const { createUserClient } = require('../config/supabase');
const logger = require('../utils/logger');

async function getMe(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { data, error } = await sb
      .from('businesses')
      .select('id, name, business_type, status, owner_email, owner_name, phone, address, country, plan, trial_ends_at, plan_expires_at, ai_messages_today, ai_messages_date, whatsapp_phone_number_id, modules, onboarding_completed, onboarding_skipped, created_at')
      .eq('id', req.businessId)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, error: 'Negocio no encontrado.' });
    }

    return res.json({ success: true, data });
  } catch (err) {
    logger.error('businesses.getMe: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al obtener el negocio.' });
  }
}

async function updateModules(req, res) {
  try {
    const { modules } = req.body;
    if (!modules || typeof modules !== 'object') {
      return res.status(400).json({ success: false, error: 'Módulos inválidos.' });
    }
    const { supabaseAdmin } = require('../config/supabase');
    const { data, error } = await supabaseAdmin
      .from('businesses')
      .update({ modules })
      .eq('id', req.businessId)
      .select()
      .single();
    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error al actualizar módulos.' });
  }
}

async function updateRecallSettings(req, res) {
  try {
    logger.info('Guardando recall settings para: ' + req.businessId);
    const { recall_message, recall_image_url } = req.body;
    const { supabaseAdmin } = require('../config/supabase');
    const updates = {};
    if (recall_message !== undefined) updates.recall_message = recall_message;
    if (recall_image_url !== undefined) updates.recall_image_url = recall_image_url;

    const { data, error } = await supabaseAdmin
      .from('businesses')
      .update(updates)
      .eq('id', req.businessId)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('businesses.updateRecallSettings: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al actualizar configuración de recordatorio.' });
  }
}

async function updateProfile(req, res) {
  try {
    const { owner_name, phone, address } = req.body;
    const { supabaseAdmin } = require('../config/supabase');
    const updates = {};
    if (owner_name !== undefined) updates.owner_name = owner_name;
    if (phone !== undefined) updates.phone = phone;
    if (address !== undefined) updates.address = address;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No hay campos para actualizar.' });
    }

    const { data, error } = await supabaseAdmin
      .from('businesses')
      .update(updates)
      .eq('id', req.businessId)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('businesses.updateProfile: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al actualizar perfil.' });
  }
}

async function updateOnboarding(req, res) {
  try {
    logger.info(`businesses.updateOnboarding: RAW req.body = ${JSON.stringify(req.body)}`);
    const { action, services, schedule } = req.body;
    logger.info(`businesses.updateOnboarding: action=${action}, businessId=${req.businessId}, servicesCount=${Array.isArray(services) ? services.length : 'N/A'}, schedule=${JSON.stringify(schedule || 'N/A')}`);

    if (!['complete', 'skip'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Acción inválida.' });
    }

    const sb = createUserClient(req.headers.authorization);

    if (action === 'complete') {
      if (Array.isArray(services) && services.length > 0) {
        const servicesToInsert = services.map(s => ({
          business_id: req.businessId,
          name: s.name,
          price: parseFloat(s.price),
          duration_minutes: parseInt(s.duration_minutes) || 30,
          description: s.description || null,
          active: true,
        }));
        logger.info(`businesses.updateOnboarding: inserting ${servicesToInsert.length} services`);
        const { error: servicesError } = await sb.from('services').insert(servicesToInsert);
        if (servicesError) {
          logger.error(`businesses.updateOnboarding services insert error: ${servicesError.message}`);
          throw servicesError;
        }
      }

      if (schedule && schedule.days) {
        const hoursToUpsert = Object.entries(schedule.days).map(([day, isOpen], index) => ({
          business_id: req.businessId,
          day_of_week: index,
          is_open: Boolean(isOpen),
          open_time: schedule.open || '08:00',
          close_time: schedule.close || '18:00',
          slot_duration_minutes: 30,
        }));
        logger.info(`businesses.updateOnboarding: upserting ${hoursToUpsert.length} hours`);
        const { error: hoursError } = await sb.from('business_hours').upsert(hoursToUpsert, { onConflict: 'business_id,day_of_week' });
        if (hoursError) {
          logger.error(`businesses.updateOnboarding hours upsert error: ${hoursError.message}`);
          throw hoursError;
        }
      }
    }

    const updates = {};
    if (action === 'complete') {
      updates.onboarding_completed = true;
    } else if (action === 'skip') {
      updates.onboarding_skipped = true;
    }

    const { data, error } = await sb
      .from('businesses')
      .update(updates)
      .eq('id', req.businessId)
      .select('onboarding_completed, onboarding_skipped')
      .single();

    if (error) {
      logger.error(`businesses.updateOnboarding error for ${req.businessId}:`, error.message);
      throw error;
    }
    logger.info(`businesses.updateOnboarding: success for ${req.businessId}`, data);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`businesses.updateOnboarding error: ${err.message}`, { businessId: req.businessId, action: req.body?.action });
    return res.status(500).json({ success: false, error: 'Error al actualizar onboarding.' });
  }
}

module.exports = { getMe, updateModules, updateRecallSettings, updateProfile, updateOnboarding };
