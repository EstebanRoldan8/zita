const { createUserClient } = require('../config/supabase');
const logger = require('../utils/logger');

async function getAll(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { data, error } = await userClient
      .from('services')
      .select('*')
      .eq('business_id', req.businessId)
      .order('name');

    if (error) throw error;
    logger.info(`services.getAll: businessId=${req.businessId}, rowCount=${data?.length || 0}`);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`services.getAll: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function create(req, res) {
  try {
    const { name, duration_minutes, price, description } = req.body;

    if (!name || duration_minutes == null || price == null) {
      return res.status(400).json({ success: false, error: 'name, duration_minutes y price son obligatorios.' });
    }

    const userClient = createUserClient(req.headers.authorization);
    logger.info(`services.create: businessId=${req.businessId}, payload={name: ${name}, price: ${price}, duration_minutes: ${duration_minutes}}`);
    const { data, error } = await userClient
      .from('services')
      .insert({ business_id: req.businessId, name, duration_minutes, price, description })
      .select()
      .single();

    if (error) throw error;
    logger.info(`services.create: success, id=${data?.id}`);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`services.create: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function update(req, res) {
  try {
    const { id } = req.params;
    const { name, duration_minutes, price, active } = req.body;

    const userClient = createUserClient(req.headers.authorization);

    const { data: existing } = await userClient
      .from('services')
      .select('id')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (!existing) {
      return res.status(404).json({ success: false, error: 'No encontrado' });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (duration_minutes !== undefined) updates.duration_minutes = duration_minutes;
    if (price !== undefined) updates.price = price;
    if (active !== undefined) updates.active = active;

    const { data, error } = await userClient
      .from('services')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`services.update: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function toggle(req, res) {
  try {
    const { id } = req.params;

    const userClient = createUserClient(req.headers.authorization);

    const { data: existing } = await userClient
      .from('services')
      .select('active')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (!existing) {
      return res.status(404).json({ success: false, error: 'No encontrado' });
    }

    const { data, error } = await userClient
      .from('services')
      .update({ active: !existing.active })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`services.toggle: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function remove(req, res) {
  try {
    const { id } = req.params;

    const userClient = createUserClient(req.headers.authorization);

    const { data: existing } = await userClient
      .from('services')
      .select('id')
      .eq('id', id)
      .eq('business_id', req.businessId)
      .single();

    if (!existing) {
      return res.status(404).json({ success: false, error: 'No encontrado' });
    }

    const { error } = await userClient
      .from('services')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return res.json({ success: true, data: null });
  } catch (err) {
    logger.error(`services.remove: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = { getAll, create, update, toggle, remove };
