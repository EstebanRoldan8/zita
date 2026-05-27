const router = require('express').Router();
const { register, login, logout } = require('../controllers/auth.controller');
const { verifyToken } = require('../middlewares/auth');
const { validateRegister } = require('../middlewares/sanitize');

router.post('/register', validateRegister, register);
router.post('/login', login);
router.post('/logout', verifyToken, logout);

module.exports = router;
