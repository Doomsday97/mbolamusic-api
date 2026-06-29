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
router.post('/wallet-topup',             pay.walletTopup);
router.post('/wallet-withdraw',          pay.walletWithdraw);
router.post('/artist-earnings-withdraw', pay.artistEarningsWithdraw);
router.get('/',                      pay.listPayments);

// Gestión de suscripciones
router.get('/subscription/current',       pay.currentSubscription);
router.post('/subscription/cancel',       pay.cancelSubscription);
router.post('/subscription/auto-renew',   pay.enableAutoRenew);

// Confirmación manual de transferencias (solo ADMIN)
router.post('/:id/confirm', requireRole('ADMIN'), pay.adminConfirmPayment);
router.post('/:id/reject',  requireRole('ADMIN'), pay.adminRejectPayment);
router.post('/:id/refund',  requireRole('ADMIN'), pay.adminRefundPayment);

module.exports = router;
