const router = require('express').Router();
const {
  getMetrics,
  getBusinesses,
  getBusinessDetail,
  updateBusiness,
  getConversationDetail,
  getNotifications,
  markNotificationRead,
  changePlan,
  getCaja,
  createExpense,
  deleteExpense,
  updateZitaGoal,
  getLeads,
  updateLeadStatus,
} = require('../controllers/admin.controller');
const { getAll: getSupportConversations, replyAsAdmin } = require('../controllers/support.controller');
const { adminGeneratePaymentLink } = require('../controllers/payment.controller');
const { verifyToken } = require('../middlewares/auth');
const { superadminOnly } = require('../middlewares/superadmin');

router.use(verifyToken, superadminOnly);

router.get('/metrics', getMetrics);

router.get('/businesses', getBusinesses);
router.get('/businesses/:id', getBusinessDetail);
router.patch('/businesses/:id', updateBusiness);
router.patch('/businesses/:id/plan', changePlan);
router.post('/businesses/:id/payment-link', adminGeneratePaymentLink);

router.get('/support', getSupportConversations);
router.get('/support/:id', getConversationDetail);
router.post('/support/reply', replyAsAdmin);

router.get('/notifications', getNotifications);
router.patch('/notifications/:id/read', markNotificationRead);

router.get('/caja', getCaja);
router.post('/caja/expenses', createExpense);
router.delete('/caja/expenses/:id', deleteExpense);
router.patch('/caja/goal', updateZitaGoal);

router.get('/leads', getLeads);
router.patch('/leads/:id/status', updateLeadStatus);

module.exports = router;
