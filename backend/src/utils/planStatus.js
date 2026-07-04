const { GRACE_DAYS } = require('../config/plans');

/**
 * Determina si el plan/trial de un negocio está expirado.
 * Espeja la misma lógica que middlewares/planCheck.js (trial vigente →
 * plan pagado vigente → grace period → expirado) para que el bot de
 * WhatsApp y el asistente IA se comporten igual que el dashboard web.
 *
 * @param {{status?: string, trial_ends_at?: string|null, plan_expires_at?: string|null}} business
 * @returns {boolean}
 */
function isPlanExpired(business) {
  if (!business) return true;

  // Suspensión manual por un superadmin siempre bloquea, sin importar fechas.
  if (business.status === 'suspended') return true;

  const ahora = new Date();

  if (business.trial_ends_at && new Date(business.trial_ends_at) > ahora) {
    return false; // trial vigente
  }

  if (business.plan_expires_at && new Date(business.plan_expires_at) > ahora) {
    return false; // plan pagado vigente
  }

  const graceBase = business.plan_expires_at || business.trial_ends_at;
  if (graceBase) {
    const graceLimit = new Date(graceBase);
    graceLimit.setDate(graceLimit.getDate() + GRACE_DAYS);
    if (ahora < graceLimit) return false; // grace period
  }

  // Negocio legado sin trial_ends_at ni plan_expires_at: no se puede
  // determinar expiración, no bloquear para evitar falsos positivos.
  if (!business.trial_ends_at && !business.plan_expires_at) return false;

  return true; // expirado
}

module.exports = { isPlanExpired };
