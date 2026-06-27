const router = require('express').Router();
const auth = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/register',     auth.register);
router.post('/login',        auth.login);
router.get('/me',            authenticate, auth.me);
router.get('/my-referral',   authenticate, auth.myReferral);

module.exports = router;
