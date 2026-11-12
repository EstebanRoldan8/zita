// /api/invitations — públicas (sin JWT), con rate limit por IP. Ver controllers/invitations.controller.js
const router = require('express').Router();
const { inviteReadLimiter, inviteAcceptLimiter } = require('../middlewares/rateLimiter');
const { getInvitation, acceptInvitation } = require('../controllers/invitations.controller');

router.get('/:token', inviteReadLimiter, getInvitation);
router.post('/:token/accept', inviteAcceptLimiter, acceptInvitation);

module.exports = router;
