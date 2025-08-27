const express = require('express');
const router = express.Router();
const { registerUser, loginUser, getMe, findDeposite } = require('../controllers/userController');
const auth = require('../middleware/authMiddleware');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/me', auth, getMe);

// FIX: Added the route for your new feature.
router.get('/find-deposite', auth, findDeposite);

module.exports = router;