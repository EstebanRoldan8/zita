const router = require('express').Router();
const { getAll, create, update, deleteEmployee } = require('../controllers/employees.controller');
const { createInvite, revokeAccess } = require('../controllers/invitations.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');
const { requireOwner } = require('../middlewares/roles');

router.use(verifyToken, businessContext, requireOwner);

router.get('/', getAll);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', deleteEmployee);

// Acceso al panel del empleado (solo dueño)
router.post('/:id/invite', createInvite);
router.delete('/:id/access', revokeAccess);

module.exports = router;
