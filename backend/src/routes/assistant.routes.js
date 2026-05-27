const router = require('express').Router();
const { message } = require('../controllers/assistant.controller');
const { verifyToken }     = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.use(verifyToken, businessContext);

router.post('/message', message);

module.exports = router;
