const router = require('express').Router();
const multer = require('multer');
const {
  getAll, getLowStock, getSales, getInventorySummary,
  create, update, toggleProduct, deleteProduct, sell, uploadImage, uploadImages, deleteImage,
  restock, getMovements,
  getOptionImages, uploadOptionImages, deleteOptionImage, setOptionCover,
} = require('../controllers/products.controller');
const bundles = require('../controllers/bundles.controller');
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

// Fotos por color: misma configuración que la galería, pero los rechazos de multer
// (más de 8 archivos, más de 2 MB, tipo inválido) responden 400 en vez de llegar al
// manejador global como 500. Como multer usa memoria, ningún archivo llega a Storage.
const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: 'Cada imagen debe pesar máximo 2 MB.',
  LIMIT_UNEXPECTED_FILE: 'Máximo 8 imágenes por petición, en el campo "images".',
  LIMIT_FILE_COUNT: 'Máximo 8 imágenes por petición.',
};
const uploadOptionFiles = (req, res, next) => {
  uploadMultiple.array('images', 8)(req, res, (err) => {
    if (!err) return next();
    return res.status(400).json({ success: false, error: MULTER_MESSAGES[err.code] || err.message || 'Archivos inválidos.' });
  });
};

router.use(verifyToken, businessContext);

// Static routes BEFORE parameterized to avoid Express matching them as :id
router.get('/low-stock', getLowStock);
router.get('/inventory-summary', getInventorySummary);
router.get('/sales',     getSales);
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
router.post('/:id/image', upload.single('image'), uploadImage);
router.post('/:id/images', uploadMultiple.array('images', 8), uploadImages);
router.delete('/:id/images', deleteImage);
router.get('/:id/option-images', getOptionImages);
router.post('/:id/option-images', uploadOptionFiles, uploadOptionImages);
router.delete('/:id/option-images', deleteOptionImage);
router.patch('/:id/option-images/cover', setOptionCover);

module.exports = router;
