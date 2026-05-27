const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contact.controller');

router.post('/', contactController.createContactRequest);
router.post('/demo-message', contactController.demoMessage);

module.exports = router;
