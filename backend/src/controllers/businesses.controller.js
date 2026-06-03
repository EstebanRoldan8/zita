const { createUserClient } = require('../config/supabase');
const logger = require('../utils/logger');

async function getMe(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const { data, error } = await sb
      .from('businesses')
      .select('id, name, business_type, status, owner_email, phone, address, country, plan, trial_ends_at, plan_expires_at, ai_messages_today, ai_messages_date, whatsapp_phone_number_id, modules, created_at')
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

module.exports = { getMe, updateModules, updateRecallSettings };
