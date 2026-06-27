const router = require('express').Router();
const admin = require('../controllers/adminController');
const pay = require('../controllers/paymentController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate, requireRole('ADMIN'));

router.get('/stats',                       admin.stats);
router.get('/users',                       admin.listUsers);
router.post('/users/:id/block',            admin.blockArtist);
router.post('/users/:id/unblock',          admin.unblockArtist);
router.get('/payments',                    admin.listPayments);
router.post('/payments/:id/confirm',       pay.adminConfirmPayment);
router.post('/payments/:id/reject',        pay.adminRejectPayment);

module.exports = router;
