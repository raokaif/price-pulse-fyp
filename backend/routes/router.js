const express = require('express');
const router = express.Router();

const auth = require('../controllers/authController');
const scrape = require('../controllers/scrapeController');

// mount controllers
router.use('/', scrape);
router.use('/', auth);

module.exports = router;
