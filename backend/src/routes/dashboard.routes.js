const router = require('express').Router();
const { tiendaSummary } = require('../controllers/dashboard.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.use(verifyToken, businessContext);

router.get('/tienda', tiendaSummary);

module.exports = router;
