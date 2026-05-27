const { supabaseAdmin } = require('../config/supabase');
const { PLANS, GRACE_DAYS } = require('../config/plans');
const logger = require('../utils/logger');

async function checkPlanAccess(req, res, next) {
  try {
    const { data: business } = await supabaseAdmin
      .from('businesses')
      .select('plan, trial_ends_at, plan_expires_at')
      .eq('id', req.businessId)
      .single();

    if (!business) {
      return res.status(404).json({ success: false, error: 'Negocio no encontrado' });
    }

    const ahora = new Date();

    // Trial vigente → acceso total como Estándar
    if (business.trial_ends_at && new Date(business.trial_ends_at) > ahora) {
      req.planInfo = { plan: business.plan || 'estandar', isTrial: true };
      return next();
    }

    // Plan pagado vigente → acceso normal
    if (business.plan_expires_at && new Date(business.plan_expires_at) > ahora) {
      req.planInfo = { plan: business.plan, isTrial: false };
      return next();
    }

    // Grace period → acceso pero con advertencia
    const graceLimit = new Date(business.plan_expires_at || business.trial_ends_at);
    graceLimit.setDate(graceLimit.getDate() + GRACE_DAYS);

    if (ahora < graceLimit) {
      req.planInfo = { plan: business.plan, isTrial: false, isGrace: true };
      return next();
    }

    // Venció y pasó grace period → bloquear
    logger.warn(`Plan expirado para negocio ${req.businessId}`);
    return res.status(403).json({
      success: false,
      error: 'Tu suscripción ha vencido. Por favor renueva tu plan para continuar.',
      code: 'SUBSCRIPTION_EXPIRED'
    });
  } catch (err) {
    logger.error(`planCheck error: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = { checkPlanAccess };
