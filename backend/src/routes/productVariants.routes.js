const router = require('express').Router();
const multer = require('multer');
const {
  getAll,
  create,
  update,
  remove,
  uploadImage,
} = require('../controllers/productVariants.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');
const { handleUploadErrors } = require('../middlewares/uploadErrors');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten JPG, PNG o WebP'));
    }
  },
});

router.use(verifyToken, businessContext);

router.get('/:productId/variants', getAll);
router.post('/:productId/variants', create);
router.patch('/:productId/variants/:variantId', update);
router.delete('/:productId/variants/:variantId', remove);
router.post('/:productId/variants/:variantId/image', handleUploadErrors(upload.single('image')), uploadImage);

module.exports = router;
