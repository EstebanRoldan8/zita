const express = require('express');
const { getSubscription } = require('../controllers/subscription.controller');

const router = express.Router();

router.get('/', getSubscription);

module.exports = router;
