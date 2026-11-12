// Roles del panel: 'owner' (dueño del negocio) y 'employee' (barbero con cuenta vinculada).
// businessContext resuelve el rol y aplica la allowlist del empleado: DENEGAR POR DEFECTO.
// Cualquier ruta autenticada que no esté aquí responde 403 a un empleado, incluidas las rutas nuevas.
const logger = require('../utils/logger');

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const UUID_RE = new RegExp(`^${UUID}$`);

// Método + ruta exacta (anclada). Los ids se validan como UUID en la propia regex.
const EMPLOYEE_ALLOWLIST = [
  ['GET',  /^\/api\/me$/],
  ['GET',  /^\/api\/me\/appointments$/],
  ['POST', /^\/api\/me\/appointments$/],
  ['POST', new RegExp(`^/api/me/appointments/${UUID}/(complete|cancel)$`)],
  ['GET',  /^\/api\/me\/services$/],
  ['GET',  /^\/api\/me\/clients$/],
  ['POST', /^\/api\/me\/clients$/],
  ['GET',  /^\/api\/me\/products$/],
  ['POST', new RegExp(`^/api/me/products/${UUID}/sell$`)],
  ['GET',  /^\/api\/me\/commissions$/],
];

// Ruta sin query string y sin la barra final (Express acepta "/x/" igual que "/x")
function requestPath(req) {
  const raw = String(req.originalUrl || req.url || '').split('?')[0].split('#')[0];
  return raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
}

function isEmployeeAllowed(method, path) {
  const m = String(method || '').toUpperCase();
  return EMPLOYEE_ALLOWLIST.some(([am, re]) => am === m && re.test(path));
}

// Para businessContext: corta al empleado fuera de la allowlist
function enforceEmployeeAllowlist(req, res) {
  if (req.role !== 'employee') return true;
  const path = requestPath(req);
  if (isEmployeeAllowed(req.method, path)) return true;
  logger.warn('[EMPLOYEE_FORBIDDEN]', { method: req.method, path, businessId: req.businessId, employeeId: req.employeeId });
  res.status(403).json({ success: false, error: 'No tienes permiso para esta acción.', code: 'FORBIDDEN_ROLE' });
  return false;
}

function requireOwner(req, res, next) {
  if (req.role === 'owner') return next();
  return res.status(403).json({ success: false, error: 'Solo el dueño del negocio puede hacer esto.', code: 'FORBIDDEN_ROLE' });
}

function requireEmployee(req, res, next) {
  if (req.role === 'employee' && req.employeeId) return next();
  return res.status(403).json({ success: false, error: 'Esta sección es solo para el equipo.', code: 'FORBIDDEN_ROLE' });
}

module.exports = {
  EMPLOYEE_ALLOWLIST, UUID_RE, requestPath, isEmployeeAllowed, enforceEmployeeAllowlist, requireOwner, requireEmployee,
};
