const router = require('express').Router();
const { getAll, getOne, create, update, updateAppointment, remove } = require('../controllers/appointments.controller');
const { verifyToken } = require('../middlewares/auth');
const { businessContext } = require('../middlewares/businessContext');

router.use(verifyToken, businessContext);

router.get('/', getAll);
router.get('/:id', getOne);
router.post('/', create);
router.patch('/:id', update);
router.put('/:id', updateAppointment);
router.delete('/:id', remove);

module.exports = router;
