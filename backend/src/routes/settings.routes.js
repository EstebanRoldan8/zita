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
const { checkFeatureAccess } = require('../middlewares/featureCheck');

router.use(verifyToken, businessContext);

// NOTA: /whatsapp y /whatsapp-notify quedan fuera del gate de 'configuracion'
// a propósito: configuran el número de WhatsApp del negocio, que es parte de
// 'bot_whatsapp', una feature incluida en TODOS los planes (incluido Lite).
// Bloquearlas dejaría a un negocio Lite sin poder conectar su WhatsApp.
const requireConfiguracion = checkFeatureAccess('configuracion');

router.get('/hours',                  requireConfiguracion, getHours);
router.put('/hours',                  requireConfiguracion, updateHours);

router.get('/closed-days',            requireConfiguracion, getClosedDays);
router.post('/closed-days',           requireConfiguracion, addClosedDay);
router.delete('/closed-days/:id',     requireConfiguracion, removeClosedDay);

router.get('/goals',                  requireConfiguracion, getGoal);
router.put('/goals',                  requireConfiguracion, updateGoal);

router.put('/whatsapp-notify',        updateWhatsappNotify);
router.put('/whatsapp',               updateWhatsapp);

router.get('/profile',                requireConfiguracion, getProfile);
router.put('/profile',                requireConfiguracion, updateProfile);

module.exports = router;
