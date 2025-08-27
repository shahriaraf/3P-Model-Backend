const express = require('express');
const router = express.Router();
const { buyLevel, getAvailableLevels, getMyActivations, recycleLevel } = require('../controllers/levelController');
const auth = require('../middleware/authMiddleware');

router.post('/buy', auth, buyLevel);
router.post('/recycle', auth, recycleLevel);
router.get('/', auth, getAvailableLevels);
router.get('/my-activations', auth, getMyActivations);

module.exports = router;