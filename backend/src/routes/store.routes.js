// Rutas PÚBLICAS de la tienda (sin JWT). El negocio sale solo del :slug (storeContext).
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { storeContext } = require('../middlewares/storeContext');
const { validateStoreOrder } = require('../middlewares/sanitize');
const {
  getStore, listProducts, getProduct, listCategories, honeypot, createOrder, getOrderStatus,
} = require('../controllers/store.controller');

// Mismo criterio que rateLimiter.js: en desarrollo se puede saltar con SKIP_RATE_LIMIT=true
const skipInDev = () => process.env.NODE_ENV !== 'production' && process.env.SKIP_RATE_LIMIT === 'true';
const tooMany = { success: false, error: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' };

const readLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false, message: tooMany, skip: skipInDev,
});
const orderIpLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: tooMany, skip: skipInDev,
});
// Por teléfono (ya normalizado por validateStoreOrder) y por tienda
const orderPhoneLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiados pedidos con este teléfono. Intenta de nuevo en un minuto.' },
  skip: skipInDev,
  keyGenerator: (req) => `${req.storeBusinessId}:${req.body?.customer?.phone || 'sin-telefono'}`,
});

router.get('/:slug', readLimiter, storeContext, getStore);
router.get('/:slug/products', readLimiter, storeContext, listProducts);
router.get('/:slug/products/:id', readLimiter, storeContext, getProduct);
router.get('/:slug/categories', readLimiter, storeContext, listCategories);
router.get('/:slug/orders/:id', readLimiter, storeContext, getOrderStatus);
router.post('/:slug/orders', orderIpLimiter, storeContext, honeypot, validateStoreOrder, orderPhoneLimiter, createOrder);

module.exports = router;
