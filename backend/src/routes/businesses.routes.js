const router = require('express').Router();
const { getMe, updateModules, updateRecallSettings, updateOnboarding } = require('../controllers/businesses.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.get('/me', verifyToken, businessContext, getMe);
router.patch('/modules', verifyToken, businessContext, updateModules);
router.patch('/recall-settings', verifyToken, businessContext, updateRecallSettings);
router.patch('/onboarding', verifyToken, businessContext, updateOnboarding);

module.exports = router;
