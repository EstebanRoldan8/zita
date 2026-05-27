const router = require('express').Router();
const { overview, appointments, clients, employeeMetrics, getHeatmap, getRetention } = require('../controllers/metrics.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.use(verifyToken, businessContext);

router.get('/overview',    overview);
router.get('/appointments', appointments);
router.get('/clients',     clients);
router.get('/employees',   employeeMetrics);
router.get('/heatmap',     getHeatmap);
router.get('/retention',   getRetention);

module.exports = router;
