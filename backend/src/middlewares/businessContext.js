const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

async function businessContext(req, res, next) {
  try {
    const userClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: req.headers.authorization,
          },
        },
      }
    );

    const { data, error } = await userClient
      .from('businesses')
      .select('id')
      .eq('user_id', req.user.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, error: 'Negocio no encontrado' });
    }

    req.businessId = data.id;
    next();
  } catch (err) {
    logger.error(`businessContext: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = { businessContext };
