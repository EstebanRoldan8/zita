const { createUserClient } = require('../config/supabase');
const { encrypt } = require('../utils/encrypt');
const logger = require('../utils/logger');

const DEFAULT_HOURS = Array.from({ length: 7 }, (_, i) => ({
  day_of_week: i,
  is_open: i !== 0 && i !== 7, // cerrado domingo (0) por defecto
  open_time: '08:00',
  close_time: '18:00',
  slot_duration_minutes: 30,
}));

// ──────────────────────────────────────────
// HORARIOS
// ──────────────────────────────────────────

async function getHours(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);

    const { data, error } = await userClient
      .from('business_hours')
      .select('day_of_week, is_open, open_time, close_time, slot_duration_minutes')
      .eq('business_id', req.businessId)
      .order('day_of_week');

    if (error) throw error;

    // Si el negocio no tiene horario configurado, devolver defaults
    if (!data || data.length === 0) {
      logger.info(`settings.getHours: businessId=${req.businessId}, returning DEFAULT_HOURS (no custom hours found)`);
      return res.json({ success: true, data: DEFAULT_HOURS });
    }

    // Mezclar con defaults para días faltantes
    const map = Object.fromEntries((data || []).map((r) => [r.day_of_week, r]));
    const merged = DEFAULT_HOURS.map((d) => map[d.day_of_week] ?? d);

    logger.info(`settings.getHours: businessId=${req.businessId}, rowCount=${data?.length || 0}, merged=${merged?.length || 0}`);
    return res.json({ success: true, data: merged });
  } catch (err) {
    logger.error(`settings.getHours: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function updateHours(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { days } = req.body;

    if (!Array.isArray(days) || days.length === 0) {
      return res.status(400).json({ success: false, error: 'Se requiere un array de días.' });
    }

    const rows = days.map((d) => ({
      business_id:           req.businessId,
      day_of_week:           d.day_of_week,
      is_open:               Boolean(d.is_open),
      open_time:             d.open_time  || '08:00',
      close_time:            d.close_time || '18:00',
      slot_duration_minutes: parseInt(d.slot_duration_minutes) || 30,
    }));

    logger.info(`settings.updateHours: businessId=${req.businessId}, upserting ${rows.length} rows`);
    const { data, error } = await userClient
      .from('business_hours')
      .upsert(rows, { onConflict: 'business_id,day_of_week' })
      .select();

    if (error) throw error;
    logger.info(`settings.updateHours: success, upserted ${data?.length || 0} rows`);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`settings.updateHours: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// ──────────────────────────────────────────
// DÍAS CERRADOS
// ──────────────────────────────────────────

async function getClosedDays(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);

    const { data, error } = await userClient
      .from('business_closed_days')
      .select('id, date, reason, is_full_day')
      .eq('business_id', req.businessId)
      .gte('date', new Date().toISOString().slice(0, 10))
      .order('date');

    if (error) throw error;
    return res.json({ success: true, data: data || [] });
  } catch (err) {
    logger.error(`settings.getClosedDays: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function addClosedDay(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { date, reason, is_full_day = true } = req.body;

    if (!date) {
      return res.status(400).json({ success: false, error: 'La fecha es obligatoria.' });
    }

    const { data, error } = await userClient
      .from('business_closed_days')
      .insert({ business_id: req.businessId, date, reason: reason?.trim() || null, is_full_day })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ success: false, error: 'Esa fecha ya está marcada como cerrada.' });
      }
      throw error;
    }
    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`settings.addClosedDay: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function removeClosedDay(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { id } = req.params;

    const { data, error } = await userClient
      .from('business_closed_days')
      .delete()
      .eq('id', id)
      .eq('business_id', req.businessId)
      .select('id');

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Día cerrado no encontrado.' });
    }
    return res.json({ success: true });
  } catch (err) {
    logger.error(`settings.removeClosedDay: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// ──────────────────────────────────────────
// METAS
// ──────────────────────────────────────────

async function getGoal(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const month = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7) + '-01';

    const { data, error } = await userClient
      .from('monthly_goals')
      .select('id, month, income_goal')
      .eq('business_id', req.businessId)
      .eq('month', month)
      .maybeSingle();

    if (error) throw error;
    return res.json({ success: true, data: data || null });
  } catch (err) {
    logger.error(`settings.getGoal: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function updateGoal(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { month, income_goal } = req.body;

    if (!income_goal || isNaN(income_goal) || Number(income_goal) <= 0) {
      return res.status(400).json({ success: false, error: 'La meta debe ser un número positivo.' });
    }

    // Normalizar month a primer día del mes
    const monthDate = month ? month.slice(0, 7) + '-01' : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7) + '-01';

    const { data, error } = await userClient
      .from('monthly_goals')
      .upsert(
        { business_id: req.businessId, month: monthDate, income_goal: parseFloat(income_goal) },
        { onConflict: 'business_id,month' }
      )
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`settings.updateGoal: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// ──────────────────────────────────────────
// NOTIFICACIONES WHATSAPP
// ──────────────────────────────────────────

async function updateWhatsappNotify(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { whatsapp_notify, owner_whatsapp } = req.body;

    if (typeof whatsapp_notify !== 'boolean') {
      return res.status(400).json({ success: false, error: 'whatsapp_notify debe ser true o false.' });
    }

    const patch = { whatsapp_notify };
    if (owner_whatsapp !== undefined) patch.owner_whatsapp = owner_whatsapp?.trim() || null;

    const { data, error } = await userClient
      .from('businesses')
      .update(patch)
      .eq('id', req.businessId)
      .select('whatsapp_notify, owner_whatsapp')
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`settings.updateWhatsappNotify: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// ──────────────────────────────────────────
// PERFIL DEL NEGOCIO
// ──────────────────────────────────────────

async function getProfile(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);

    const { data, error } = await userClient
      .from('businesses')
      .select('id, name, business_type, owner_email, owner_name, phone, address, whatsapp_notify, owner_whatsapp, created_at')
      .eq('id', req.businessId)
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`settings.getProfile: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function updateProfile(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { owner_name, name, phone, address, business_type } = req.body;

    const patch = {};
    if (owner_name    !== undefined) patch.owner_name    = owner_name?.trim() || null;
    if (name          !== undefined) patch.name          = name?.trim();
    if (phone         !== undefined) patch.phone         = phone?.trim() || null;
    if (address       !== undefined) patch.address       = address?.trim() || null;
    if (business_type !== undefined) patch.business_type = business_type?.trim();

    if (!patch.name) {
      return res.status(400).json({ success: false, error: 'El nombre del negocio es obligatorio.' });
    }

    const { data, error } = await userClient
      .from('businesses')
      .update(patch)
      .eq('id', req.businessId)
      .select('id, name, business_type, owner_email, owner_name, phone, address')
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`settings.updateProfile: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

// ──────────────────────────────────────────
// CONFIGURACIÓN WHATSAPP
// ──────────────────────────────────────────

async function updateWhatsapp(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { whatsapp_phone_number_id, whatsapp_access_token } = req.body;

    const patch = {};
    if (whatsapp_phone_number_id !== undefined) {
      patch.whatsapp_phone_number_id = whatsapp_phone_number_id?.trim() || null;
    }
    if (whatsapp_access_token !== undefined) {
      patch.whatsapp_access_token = whatsapp_access_token?.trim() ? encrypt(whatsapp_access_token.trim()) : null;
    }

    const { data, error } = await userClient
      .from('businesses')
      .update(patch)
      .eq('id', req.businessId)
      .select('whatsapp_phone_number_id')
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`settings.updateWhatsapp: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = {
  getHours, updateHours,
  getClosedDays, addClosedDay, removeClosedDay,
  getGoal, updateGoal,
  updateWhatsappNotify,
  getProfile, updateProfile,
  updateWhatsapp,
};
