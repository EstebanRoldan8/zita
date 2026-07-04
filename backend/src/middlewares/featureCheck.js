const { PLANS } = require('../config/plans');
const logger = require('../utils/logger');

// Orden de planes de menor a mayor, para calcular cuál es el plan
// mínimo que incluye una feature (usado solo para el mensaje de error).
const PLAN_ORDER = ['lite', 'estandar', 'pro'];

function minPlanNameFor(featureName) {
  const minPlanKey = PLAN_ORDER.find((key) => PLANS[key]?.features.includes(featureName));
  return PLANS[minPlanKey]?.name || 'Pro';
}

// Requiere ejecutarse después de businessContext (y, si existe en la
// cadena, de checkPlanAccess). Usa req.planInfo.plan si está disponible
// (respeta el trial, que da acceso equivalente a Estándar) y si no,
// cae a req.business.plan (seteado por businessContext).
function checkFeatureAccess(featureName) {
  return function (req, res, next) {
    const plan = req.planInfo?.plan || req.business?.plan;
    const planConfig = PLANS[plan];

    if (!planConfig) {
      logger.error(`checkFeatureAccess: plan desconocido "${plan}" para negocio ${req.businessId}`);
      return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }

    if (!planConfig.features.includes(featureName)) {
      return res.status(403).json({
        error: `Esta función requiere el plan ${minPlanNameFor(featureName)} o superior`,
      });
    }

    next();
  };
}

module.exports = { checkFeatureAccess };
