const express = require('express');
const router = express.Router();
const { buyLevel, getAvailableLevels, getMyActivations, recycleLevel } = require('../controllers/levelController');
const auth = require('../middleware/authMiddleware');

router.post('/buy', auth, buyLevel);
router.post('/recycle', auth, recycleLevel);

// FIX: Renamed from '/' to '/all' to prevent route conflicts and fix the 404 error.
router.get('/all', auth, getAvailableLevels);

// This route correctly uses a query parameter `?package=3p` to get specific activations.
router.get('/my-activations', auth, getMyActivations);

module.exports = router;