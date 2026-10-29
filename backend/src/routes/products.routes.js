const router = require('express').Router();
const multer = require('multer');
const {
  getAll, getLowStock, getSales, getInventorySummary,
  create, update, toggleProduct, deleteProduct, sell, uploadImage, uploadImages, deleteImage,
  restock, getMovements, getHistory,
  getOptionImages, uploadOptionImages, deleteOptionImage, setOptionCover,
} = require('../controllers/products.controller');
const bundles = require('../controllers/bundles.controller');
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

// Rechazos de multer (tipo, 2 MB, más de 8 archivos) → 400 en todos los endpoints de fotos (principal, galería y color)
const uploadOptionFiles = handleUploadErrors(uploadMultiple.array('images', 8));

router.use(verifyToken, businessContext);

// Static routes BEFORE parameterized to avoid Express matching them as :id
router.get('/low-stock', getLowStock);
router.get('/inventory-summary', getInventorySummary);
router.get('/sales',     getSales);
router.get('/movements', getHistory);
// Sets / combos (antes de las rutas con :id)
router.post('/bundles/preview', bundles.preview);
router.post('/bundles',          bundles.create);
router.get('/bundles/:id',       bundles.getOne);
router.put('/bundles/:id',       bundles.update);
router.get('/',          getAll);
router.post('/',         create);
router.put('/:id',       update);
router.put('/:id/toggle', toggleProduct);
router.delete('/:id',    deleteProduct);
router.post('/:id/sell', sell);
router.post('/:id/restock', restock);
router.get('/:id/movements', getMovements);
router.post('/:id/image', handleUploadErrors(upload.single('image')), uploadImage);
router.post('/:id/images', uploadOptionFiles, uploadImages);
router.delete('/:id/images', deleteImage);
router.get('/:id/option-images', getOptionImages);
router.post('/:id/option-images', uploadOptionFiles, uploadOptionImages);
router.delete('/:id/option-images', deleteOptionImage);
router.patch('/:id/option-images/cover', setOptionCover);

module.exports = router;
