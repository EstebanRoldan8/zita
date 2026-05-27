const router = require('express').Router();
const { getAll, create, update, remove } = require('../controllers/expenses.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.use(verifyToken, businessContext);

router.get('/', getAll);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);

module.exports = router;
