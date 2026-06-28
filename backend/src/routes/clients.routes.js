const router = require('express').Router();
const { getAll, getOne, create, update, destroy, recallClient } = require('../controllers/clients.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.use(verifyToken, businessContext);

router.get('/', getAll);
router.get('/:id', getOne);
router.post('/', create);
router.put('/:id',   update);
router.patch('/:id', update);
router.delete('/:id', destroy);
router.post('/:id/recall', recallClient);

module.exports = router;
