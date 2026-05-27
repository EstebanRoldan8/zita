const express = require('express');
const router = express.Router();
const { handleWebhook, verifyWebhook } = require('../controllers/webhook.controller');

router.get('/whatsapp', verifyWebhook);
router.post('/whatsapp', handleWebhook);

module.exports = router;
