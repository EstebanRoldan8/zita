const router = require('express').Router();
const {
  getHours, updateHours,
  getClosedDays, addClosedDay, removeClosedDay,
  getGoal, updateGoal,
  updateWhatsappNotify,
  getProfile, updateProfile,
  updateWhatsapp,
} = require('../controllers/settings.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.use(verifyToken, businessContext);

router.get('/hours',                  getHours);
router.put('/hours',                  updateHours);

router.get('/closed-days',            getClosedDays);
router.post('/closed-days',           addClosedDay);
router.delete('/closed-days/:id',     removeClosedDay);

router.get('/goals',                  getGoal);
router.put('/goals',                  updateGoal);

router.put('/whatsapp-notify',        updateWhatsappNotify);
router.put('/whatsapp',               updateWhatsapp);

router.get('/profile',                getProfile);
router.put('/profile',                updateProfile);

module.exports = router;
