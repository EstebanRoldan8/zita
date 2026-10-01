// orders routes v2
const router = require('express').Router();
const {
  getAll, getById, create, updateStatus, deleteOrder, updatePayment, updateShipping,
} = require('../controllers/orders.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.use(verifyToken, businessContext);

router.get('/', getAll);
router.get('/:id', getById);
router.post('/', create);
router.patch('/:id/status', updateStatus);
router.patch('/:id/payment', updatePayment);
router.patch('/:id/shipping', updateShipping);
router.delete('/:id', deleteOrder);

module.exports = router;
