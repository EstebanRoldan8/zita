const router      = require('express').Router();
const adminRouter = require('express').Router();
const { contact, getAll, replyAsAdmin } = require('../controllers/support.controller');
const { verifyToken }    = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');
const { superadminOnly }  = require('../middlewares/superadmin');

// Rutas del negocio: POST /api/support/contact
router.post('/contact', verifyToken, businessContext, contact);

// Rutas de superadmin: /api/admin/support/*
adminRouter.get('/',      verifyToken, superadminOnly, getAll);
adminRouter.post('/reply', verifyToken, superadminOnly, replyAsAdmin);

module.exports = { supportRouter: router, adminSupportRouter: adminRouter };
