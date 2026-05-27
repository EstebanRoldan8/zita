const router = require('express').Router();
const { getAlertsHandler } = require('../controllers/alerts.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.use(verifyToken, businessContext);

router.get('/', getAlertsHandler);

module.exports = router;
