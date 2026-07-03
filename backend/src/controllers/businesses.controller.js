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

// Estándar del sistema (migración 009, chatbot.service, scheduler): 0=domingo ... 6=sábado
const DAY_NAME_TO_DOW = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  'miércoles': 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  'sábado': 6,
};

function timeToMinutes(t) {
  if (typeof t !== 'string') return NaN;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function validateOnboardingPayload({ services, employees, schedule }) {
  if (Array.isArray(services)) {
    for (const s of services) {
      const price = parseFloat(s.price);
      if (!Number.isFinite(price) || price <= 0) {
        return `Precio inválido en servicio "${s.name || '?'}": debe ser mayor que 0`;
      }
      if (s.duration_minutes !== undefined && s.duration_minutes !== null && s.duration_minutes !== '') {
        const dur = parseInt(s.duration_minutes, 10);
        if (!Number.isFinite(dur) || dur < 5 || dur > 480) {
          return `Duración inválida en servicio "${s.name || '?'}": debe estar entre 5 y 480 minutos`;
        }
      }
    }
  }

  if (Array.isArray(employees)) {
    for (const e of employees) {
      if (e.commission_percent !== undefined && e.commission_percent !== null && e.commission_percent !== '') {
        const com = parseFloat(e.commission_percent);
        if (!Number.isFinite(com) || com < 0 || com > 100) {
          return `Comisión inválida en empleado "${e.name || '?'}": debe estar entre 0 y 100`;
        }
      }
    }
  }

  if (schedule && schedule.days) {
    for (const day of Object.keys(schedule.days)) {
      const dow = DAY_NAME_TO_DOW[String(day).toLowerCase()];
      if (dow === undefined || dow < 0 || dow > 6) {
        return `Día inválido en horarios: "${day}"`;
      }
    }
    const openMin = timeToMinutes(schedule.open || '08:00');
    const closeMin = timeToMinutes(schedule.close || '18:00');
    if (!Number.isFinite(openMin) || !Number.isFinite(closeMin)) {
      return 'Horario inválido: formato de hora debe ser HH:MM';
    }
    if (closeMin <= openMin) {
      return 'La hora de cierre no puede ser anterior a la apertura';
    }
  }

  return null;
}

async function updateOnboarding(req, res) {
  try {
    const { action, services, employees, schedule } = req.body;

    if (!['complete', 'skip'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Acción inválida.' });
    }

    const sb = createUserClient(req.headers.authorization);

    // Idempotencia: si ya se completó el onboarding, no insertar nada de nuevo
    const { data: current, error: currentError } = await sb
      .from('businesses')
      .select('onboarding_completed, onboarding_skipped')
      .eq('id', req.businessId)
      .single();
    if (currentError) throw currentError;
    if (current?.onboarding_completed === true) {
      return res.json({ success: true, message: 'Onboarding ya completado', data: current });
    }

    // Validación defensiva del payload
    const validationError = validateOnboardingPayload({ services, employees, schedule });
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    // Los datos parciales se insertan tanto en 'complete' como en 'skip'
    if (Array.isArray(services) && services.length > 0) {
      const servicesToInsert = services.map(s => ({
        business_id: req.businessId,
        name: s.name,
        price: parseFloat(s.price),
        duration_minutes: parseInt(s.duration_minutes) || 30,
        description: s.description || null,
        active: true,
      }));
      const { error: servicesError } = await sb.from('services').insert(servicesToInsert);
      if (servicesError) {
        logger.error(`businesses.updateOnboarding services insert error: ${servicesError.message}`);
        throw servicesError;
      }
    }

    if (Array.isArray(employees) && employees.length > 0) {
      const employeesToInsert = employees.map(e => ({
        business_id: req.businessId,
        name: e.name,
        phone: e.phone || null,
        email: e.email || null,
        commission_percent: parseFloat(e.commission_percent) || 0,
        is_active: true,
      }));
      const { error: employeesError } = await sb.from('employees').insert(employeesToInsert);
      if (employeesError) {
        logger.error(`businesses.updateOnboarding employees insert error: ${employeesError.message}`);
        throw employeesError;
      }
    }

    if (schedule && schedule.days) {
      const hoursToUpsert = Object.entries(schedule.days).map(([day, isOpen]) => ({
        business_id: req.businessId,
        day_of_week: DAY_NAME_TO_DOW[String(day).toLowerCase()],
        is_open: Boolean(isOpen),
        open_time: schedule.open || '08:00',
        close_time: schedule.close || '18:00',
        slot_duration_minutes: 30,
      }));
      const { error: hoursError } = await sb.from('business_hours').upsert(hoursToUpsert, { onConflict: 'business_id,day_of_week' });
      if (hoursError) {
        logger.error(`businesses.updateOnboarding hours upsert error: ${hoursError.message}`);
        throw hoursError;
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
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`businesses.updateOnboarding error: ${err.message}`, { businessId: req.businessId, action: req.body?.action });
    return res.status(500).json({ success: false, error: 'Error al actualizar onboarding.' });
  }
}

module.exports = { getMe, updateModules, updateRecallSettings, updateProfile, updateOnboarding };
