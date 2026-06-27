const express = require('express');
const { autoCompleteAppointments } = require('../services/scheduler.service');
const logger = require('../utils/logger');

const router = express.Router();

// Middleware para validar x-internal-secret
const validateInternalSecret = (req, res, next) => {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== process.env.INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing x-internal-secret header' });
  }
  next();
};

router.use(validateInternalSecret);

// POST /api/internal/auto-complete-appointments
router.post('/auto-complete-appointments', async (req, res) => {
  try {
    logger.info('[internal] POST /auto-complete-appointments');
    const result = await autoCompleteAppointments();
    return res.json(result);
  } catch (error) {
    logger.error('[internal] Error en auto-complete-appointments:', error.message);
    return res.status(500).json({ error: error.message, completed: 0, errors: [error.message] });
  }
});

module.exports = router;
