const router = require('express').Router();
const pay = require('../controllers/paymentController');
const { authenticate, requireRole } = require('../middleware/auth');

// Webhook de Flutterwave: sin autenticación JWT, verificado por hash
router.post('/webhook/flutterwave', pay.flutterwaveWebhook);

// Rutas protegidas por JWT
router.use(authenticate);

router.post('/artist-subscription',  pay.payArtistSubscription);
router.post('/listener-subscription', pay.payListenerSubscription);
router.post('/per-play',             pay.payPerPlay);
router.post('/per-download',         pay.payPerDownload);
router.post('/wallet-topup',         pay.walletTopup);
router.get('/',                      pay.listPayments);

// Confirmación manual de transferencias (solo ADMIN)
router.post('/:id/confirm', requireRole('ADMIN'), pay.adminConfirmPayment);
router.post('/:id/reject',  requireRole('ADMIN'), pay.adminRejectPayment);

module.exports = router;
