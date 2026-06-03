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
      .select('id, user_id')
      .eq('user_id', req.user.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, error: 'Negocio no encontrado' });
    }

    if (data.user_id !== req.user.id) {
      logger.error('Intento de acceso a negocio ajeno', {
        userId: req.user.id,
        businessUserId: data.user_id
      });
      return res.status(403).json({ success: false, error: 'Acceso no autorizado' });
    }

    req.businessId = data.id;
    next();
  } catch (err) {
    logger.error(`businessContext: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = { businessContext };
