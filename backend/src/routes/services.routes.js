const router = require('express').Router();
const { getAll, create, update, toggle, remove } = require('../controllers/services.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.use(verifyToken, businessContext);

router.get('/', getAll);
router.post('/', create);
router.patch('/:id', update);
router.put('/:id/toggle', toggle);
router.delete('/:id', remove);

module.exports = router;
