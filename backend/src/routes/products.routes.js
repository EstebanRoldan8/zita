const router = require('express').Router();
const multer = require('multer');
const {
  getAll, getLowStock, getSales,
  create, update, toggleProduct, deleteProduct, sell, uploadImage, uploadImages, deleteImage,
  restock, getMovements,
} = require('../controllers/products.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

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

const uploadMultiple = multer({
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

// Static routes BEFORE parameterized to avoid Express matching them as :id
router.get('/low-stock', getLowStock);
router.get('/sales',     getSales);
router.get('/',          getAll);
router.post('/',         create);
router.put('/:id',       update);
router.put('/:id/toggle', toggleProduct);
router.delete('/:id',    deleteProduct);
router.post('/:id/sell', sell);
router.post('/:id/restock', restock);
router.get('/:id/movements', getMovements);
router.post('/:id/image', upload.single('image'), uploadImage);
router.post('/:id/images', uploadMultiple.array('images', 8), uploadImages);
router.delete('/:id/images', deleteImage);

module.exports = router;
