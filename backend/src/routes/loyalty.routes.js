const router = require('express').Router();
const { getConfig, updateConfig, redeem } = require('../controllers/loyalty.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.use(verifyToken, businessContext);

router.get('/config', getConfig);
router.put('/config', updateConfig);
router.post('/:clientId/redeem', redeem);

module.exports = router;
