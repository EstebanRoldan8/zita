// /api/me — identidad del usuario del panel (dueño o empleado) y panel del empleado.
// Montado en app.js con verifyToken + businessContext (que aplica la allowlist del empleado).
const router = require('express').Router();
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');
const { checkPlanAccess } = require('../middlewares/planCheck');
const { requireEmployee } = require('../middlewares/roles');
const me = require('../controllers/me.controller');

router.use(verifyToken, businessContext);

// Ambos roles: el frontend decide a qué panel ir con esta respuesta
router.get('/', me.getMe);

// Solo empleado, con el plan del negocio vigente
const staff = [requireEmployee, checkPlanAccess];

router.get('/appointments', staff, me.requireModule('agenda'), me.listAppointments);
router.post('/appointments', staff, me.requireModule('agenda'), me.createAppointment);
router.post('/appointments/:id/complete', staff, me.requireModule('agenda'), me.completeAppointment);
router.post('/appointments/:id/cancel', staff, me.requireModule('agenda'), me.cancelAppointment);
router.get('/services', staff, me.requireModule('agenda'), me.listServices);

router.get('/clients', staff, me.requireModule('clientes'), me.listClients);
router.post('/clients', staff, me.requireModule('clientes'), me.createClient);

router.get('/products', staff, me.requireModule('productos'), me.listProducts);
router.post('/products/:id/sell', staff, me.requireModule('productos'), me.sell);

router.get('/commissions', staff, me.requireModule('comisiones'), me.commissions);

module.exports = router;
