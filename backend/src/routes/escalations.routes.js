// /api/escalations — escalaciones del bot para el panel del dueño (solo dueño).
// businessContext ya rechaza al empleado (allowlist, deny-by-default); requireOwner lo deja explícito.
const router = require('express').Router();
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');
const { requireOwner } = require('../middlewares/roles');
const escalations = require('../controllers/escalations.controller');

router.use(verifyToken, businessContext, requireOwner);

router.get('/', escalations.list);
router.post('/:id/attend', escalations.attend);
router.post('/:id/resume-bot', escalations.resumeBot);

module.exports = router;
