// orders routes v2
const router = require('express').Router();
const {
  getAll, getById, create, updateStatus, deleteOrder, updatePayment, updateShipping, updateDiscount,
  editPreview, editOrder, reopen, reopenPreview, getEdits,
} = require('../controllers/orders.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.use(verifyToken, businessContext);

router.get('/', getAll);
router.get('/:id', getById);
router.get('/:id/edits', getEdits);
router.post('/', create);
router.post('/:id/edit/preview', editPreview);
router.post('/:id/edit', editOrder);
router.post('/:id/reopen/preview', reopenPreview);
router.post('/:id/reopen', reopen);
router.patch('/:id/status', updateStatus);
router.patch('/:id/payment', updatePayment);
router.patch('/:id/shipping', updateShipping);
router.patch('/:id/discount', updateDiscount);
router.delete('/:id', deleteOrder);

module.exports = router;
