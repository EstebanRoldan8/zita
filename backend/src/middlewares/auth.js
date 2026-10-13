const { supabaseClient } = require('../config/supabase');
const logger = require('../utils/logger');

async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return res.status(401).json({ success: false, error: 'No autorizado' });
    }

    const token = authHeader.split(' ')[1];
    const { data, error } = await supabaseClient.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ success: false, error: 'No autorizado' });
    }

    req.user = data.user;
    next();
  } catch (err) {
    logger.error(`verifyToken: ${err.message}`);
    return res.status(401).json({ success: false, error: 'No autorizado' });
  }
}

module.exports = { verifyToken };
