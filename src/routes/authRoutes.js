const router = require('express').Router();
const auth = require('../controllers/authController');
const { authenticate, requireRole } = require('../middleware/auth');

router.post('/register',                         auth.register);
router.post('/login',                            auth.login);
router.get('/me',                                authenticate, auth.me);
router.get('/my-referral',                       authenticate, auth.myReferral);
router.put('/profile',                           authenticate, auth.updateProfile);
router.get('/artists',                           authenticate, requireRole('ADMIN'), auth.listArtists);

// Preguntas de seguridad
router.post('/security-questions',               authenticate, auth.setSecurityQuestions);
router.post('/recover-password/challenge',       auth.recoverChallenge);
router.post('/recover-password/verify',          auth.recoverVerify);

module.exports = router;
