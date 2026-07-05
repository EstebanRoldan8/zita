const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { handleWebhook, verifyWebhook, reactivarBot, getConversacionesPausadas } = require('../controllers/webhook.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');
const { validateWhatsappSignature } = require('../middlewares/validateWhatsappSignature');

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  message: { success: false, error: 'Webhook rate limit exceeded' },
  skip: (req) => process.env.NODE_ENV !== 'production'
});

router.get('/whatsapp', verifyWebhook);
router.post('/whatsapp', webhookLimiter, validateWhatsappSignature, handleWebhook);

router.get('/pausadas', verifyToken, businessContext, getConversacionesPausadas);
router.post('/reactivar-bot', verifyToken, businessContext, reactivarBot);

module.exports = router;
