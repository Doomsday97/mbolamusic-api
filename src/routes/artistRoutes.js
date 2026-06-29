const router = require('express').Router();
const artist = require('../controllers/artistController');
const { authenticate, requireRole } = require('../middleware/auth');

// Ruta pública (sin autenticación)
router.get('/profile/:userId', artist.publicProfile);

router.use(authenticate, requireRole('ARTIST'));

router.get('/dashboard',        artist.dashboard);
router.post('/withdraw',        artist.requestWithdraw);
router.get('/monthly-earnings', artist.monthlyEarnings);

module.exports = router;
