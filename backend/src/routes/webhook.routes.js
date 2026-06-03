const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { handleWebhook, verifyWebhook } = require('../controllers/webhook.controller');

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  message: { success: false, error: 'Webhook rate limit exceeded' },
  skip: (req) => process.env.NODE_ENV !== 'production'
});

router.get('/whatsapp', verifyWebhook);
router.post('/whatsapp', webhookLimiter, handleWebhook);

module.exports = router;
