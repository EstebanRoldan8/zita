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
} = require('../controllers/admin.controller');
const { getAll: getSupportConversations, replyAsAdmin } = require('../controllers/support.controller');
const { verifyToken } = require('../middlewares/auth');
const { superadminOnly } = require('../middlewares/superadmin');

router.use(verifyToken, superadminOnly);

router.get('/metrics', getMetrics);

router.get('/businesses', getBusinesses);
router.get('/businesses/:id', getBusinessDetail);
router.patch('/businesses/:id', updateBusiness);
router.patch('/businesses/:id/plan', changePlan);

router.get('/support', getSupportConversations);
router.get('/support/:id', getConversationDetail);
router.post('/support/reply', replyAsAdmin);

router.get('/notifications', getNotifications);
router.patch('/notifications/:id/read', markNotificationRead);

module.exports = router;
