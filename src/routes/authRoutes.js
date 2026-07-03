const router = require('express').Router();
const auth = require('../controllers/authController');
const { authenticate, requireRole } = require('../middleware/auth');
const { upload, uploadMemory } = require('../config/upload');
const { requireTurnstile } = require('../services/turnstile');

router.post('/register',                         requireTurnstile(), auth.register);
router.post('/login',                            requireTurnstile(), auth.login);
router.post('/logout',                           auth.logout);
router.get('/me',                                authenticate, auth.me);
router.get('/my-referral',                       authenticate, auth.myReferral);
router.put('/profile',                           authenticate, auth.updateProfile);
router.post('/change-password',                  authenticate, auth.changePassword);
router.post('/avatar',                           authenticate, uploadMemory.single('avatar'), auth.updateAvatar);
router.post('/fcm-token',                        authenticate, auth.updateFcmToken);
router.get('/artists',                           authenticate, requireRole('ADMIN'), auth.listArtists);

// Preguntas de seguridad
router.post('/security-questions',               authenticate, auth.setSecurityQuestions);
router.post('/recover-password/challenge',       auth.recoverChallenge);
router.post('/recover-password/verify',          auth.recoverVerify);

module.exports = router;
