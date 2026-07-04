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
//
// Lite tiene acceso reducido (no bloqueado) a Configuración: horarios,
// días cerrados, perfil del negocio y WhatsApp quedan disponibles para
// todos los planes. Solo 'goals' (metas mensuales personalizadas) sigue
// siendo exclusivo de Estándar/Pro.
const requireConfiguracion = checkFeatureAccess('configuracion');

router.get('/hours',                  getHours);
router.put('/hours',                  updateHours);

router.get('/closed-days',            getClosedDays);
router.post('/closed-days',           addClosedDay);
router.delete('/closed-days/:id',     removeClosedDay);

router.get('/goals',                  requireConfiguracion, getGoal);
router.put('/goals',                  requireConfiguracion, updateGoal);

router.put('/whatsapp-notify',        updateWhatsappNotify);
router.put('/whatsapp',               updateWhatsapp);

router.get('/profile',                getProfile);
router.put('/profile',                updateProfile);

module.exports = router;
