const router = require('express').Router();
const { getAll, create, update, deleteEmployee } = require('../controllers/employees.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.use(verifyToken, businessContext);

router.get('/', getAll);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', deleteEmployee);

module.exports = router;
