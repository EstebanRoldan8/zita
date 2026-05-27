const router = require('express').Router();
const {
  getAll,
  create,
  update,
  deactivate,
} = require('../controllers/productVariants.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.use(verifyToken, businessContext);

router.get('/:productId/variants', getAll);
router.post('/:productId/variants', create);
router.patch('/:productId/variants/:variantId', update);
router.delete('/:productId/variants/:variantId', deactivate);

module.exports = router;
