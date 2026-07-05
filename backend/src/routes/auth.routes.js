const router = require('express').Router();
const { register, login, logout } = require('../controllers/auth.controller');
const { verifyToken } = require('../middlewares/auth');
const { validateRegister } = require('../middlewares/sanitize');
const { authLimiter } = require('../middlewares/rateLimiter');

router.post('/register', authLimiter, validateRegister, register);
router.post('/login', authLimiter, login);
router.post('/logout', verifyToken, logout);

module.exports = router;
