const express = require('express');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');
const { createSession, handleWebhook, getHistory, getStatus, calculatePayment, scheduleDowngrade } = require('../controllers/payment.controller');

const router = express.Router();

router.post('/create-session', verifyToken, businessContext, createSession);
router.post('/webhook', handleWebhook);
router.get('/history', verifyToken, businessContext, getHistory);
router.get('/status/:reference', verifyToken, businessContext, getStatus);
router.post('/calculate', verifyToken, businessContext, calculatePayment);
router.post('/schedule-downgrade', verifyToken, businessContext, scheduleDowngrade);

module.exports = router;
