const { createUserClient, supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { enforceEmployeeAllowlist } = require('./roles');

const BUSINESS_FIELDS = 'id, user_id, country, plan, business_type, name';

// Resuelve el negocio y el rol del usuario autenticado:
//   1. Dueño: businesses.user_id = req.user.id (cliente con su JWT, igual que antes). Si es dueño, gana dueño.
//   2. Empleado: employees.user_id = req.user.id AND is_active (cliente admin: la RLS del dueño no aplica).
// Setea req.businessId, req.business (mismos campos en ambos casos), req.role y, si es empleado, req.employeeId.
// Un empleado solo pasa por las rutas de la allowlist (middlewares/roles.js); el resto → 403.
async function businessContext(req, res, next) {
  try {
    // Ya resuelto en esta misma petición (el middleware está en app.js y otra vez en cada router)
    if (req.role && req.businessId) {
      return enforceEmployeeAllowlist(req, res) ? next() : undefined;
    }

    const userClient = createUserClient(req.headers.authorization);
    const { data: owned, error: ownErr } = await userClient
      .from('businesses')
      .select(BUSINESS_FIELDS)
      .eq('user_id', req.user.id)
      .single();

    if (!ownErr && owned) {
      if (owned.user_id !== req.user.id) {
        logger.error('Intento de acceso a negocio ajeno', { userId: req.user.id, businessUserId: owned.user_id });
        return res.status(403).json({ success: false, error: 'Acceso no autorizado' });
      }
      req.businessId = owned.id;
      req.business   = owned;
      req.role       = 'owner';
      req.employeeId = null;
      return next();
    }

    // No es dueño: ¿es un empleado activo con cuenta vinculada? (si la migración 066 no corrió, error → sin acceso)
    const { data: emp, error: empErr } = await supabaseAdmin
      .from('employees')
      .select(`id, name, business_id, is_active, businesses(${BUSINESS_FIELDS})`)
      .eq('user_id', req.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (empErr && empErr.code !== '42703') {
      logger.warn('businessContext: búsqueda de empleado falló', { code: empErr.code });
    }

    const biz = emp?.businesses;
    if (!emp || !biz || biz.id !== emp.business_id) {
      return res.status(404).json({ success: false, error: 'Negocio no encontrado' });
    }

    req.businessId = biz.id;
    req.business   = { id: biz.id, user_id: biz.user_id, country: biz.country, plan: biz.plan, business_type: biz.business_type, name: biz.name };
    req.role       = 'employee';
    req.employeeId = emp.id;
    req.employee   = { id: emp.id, name: emp.name };

    return enforceEmployeeAllowlist(req, res) ? next() : undefined;
  } catch (err) {
    logger.error(`businessContext: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = { businessContext };
