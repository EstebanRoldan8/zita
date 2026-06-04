const { createUserClient } = require('../config/supabase');
const logger = require('../utils/logger');
const { getTimezone } = require('../utils/timezone');

const VALID_CATEGORIES = ['nomina', 'materias_primas', 'servicios', 'arriendo', 'otro'];

function parseMonth(monthStr, tz = 'America/Bogota') {
  const todayCol = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const currentMonth = todayCol.slice(0, 7);
  const [year, month] = (monthStr || currentMonth).split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) {
    const [y, m] = currentMonth.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      start: `${currentMonth}-01`,
      end: `${currentMonth}-${String(lastDay).padStart(2, '0')}`,
    };
  }
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${String(year)}-${String(month).padStart(2, '0')}-01`,
    end: `${String(year)}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

async function getAll(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { start, end } = parseMonth(req.query.month, getTimezone(req.business?.country));

    const { data, error } = await userClient
      .from('expenses')
      .select('id, amount, category, description, date, created_at')
      .eq('business_id', req.businessId)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: false });

    if (error) throw error;
    return res.json({ success: true, data: data || [] });
  } catch (err) {
    logger.error(`expenses.getAll: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function create(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { amount, category, description, date } = req.body;

    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: 'El monto debe ser un número positivo.' });
    }
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, error: `Categoría inválida. Usa: ${VALID_CATEGORIES.join(', ')}.` });
    }
    if (!date) {
      return res.status(400).json({ success: false, error: 'La fecha es obligatoria.' });
    }

    const { data, error } = await userClient
      .from('expenses')
      .insert({
        business_id: req.businessId,
        amount: parseFloat(amount),
        category,
        description: description?.trim() || null,
        date,
      })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`expenses.create: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function update(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { id } = req.params;
    const { amount, category, description, date } = req.body;

    if (amount !== undefined && (isNaN(amount) || Number(amount) <= 0)) {
      return res.status(400).json({ success: false, error: 'El monto debe ser un número positivo.' });
    }
    if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, error: `Categoría inválida. Usa: ${VALID_CATEGORIES.join(', ')}.` });
    }

    const patch = {};
    if (amount !== undefined) patch.amount = parseFloat(amount);
    if (category !== undefined) patch.category = category;
    if (description !== undefined) patch.description = description?.trim() || null;
    if (date !== undefined) patch.date = date;

    const { data, error } = await userClient
      .from('expenses')
      .update(patch)
      .eq('id', id)
      .eq('business_id', req.businessId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Egreso no encontrado.' });
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`expenses.update: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function remove(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { id } = req.params;

    const { error } = await userClient
      .from('expenses')
      .delete()
      .eq('id', id)
      .eq('business_id', req.businessId);

    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    logger.error(`expenses.remove: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = { getAll, create, update, remove };
