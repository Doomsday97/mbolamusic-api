const router = require('express').Router();
const auth = require('../controllers/authController');
const { authenticate, requireRole } = require('../middleware/auth');

router.post('/register',     auth.register);
router.post('/login',        auth.login);
router.get('/me',            authenticate, auth.me);
router.get('/my-referral',   authenticate, auth.myReferral);
router.put('/profile',       authenticate, auth.updateProfile);
router.get('/artists',       authenticate, requireRole('ADMIN'), auth.listArtists);

module.exports = router;
