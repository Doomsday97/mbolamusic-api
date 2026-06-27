const router = require('express').Router();
const admin = require('../controllers/adminController');
const pay = require('../controllers/paymentController');
const { authenticate, requireRole } = require('../middleware/auth');
const { upload } = require('../config/upload');

router.use(authenticate, requireRole('ADMIN'));

router.get('/stats',                       admin.stats);
router.get('/users',                       admin.listUsers);
router.post('/users/:id/block',            admin.blockArtist);
router.post('/users/:id/unblock',          admin.unblockArtist);
router.get('/payments',                    admin.listPayments);
router.post('/payments/:id/confirm',       pay.adminConfirmPayment);
router.post('/payments/:id/reject',        pay.adminRejectPayment);

// Gestión de canciones
router.get('/tracks',                      admin.listAllTracks);
router.get('/artists',                     admin.listArtists);
router.post('/tracks',
  upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }]),
  admin.adminUploadTrack,
);
router.delete('/tracks/:id',               admin.adminDeleteTrack);
router.patch('/tracks/:id/toggle',         admin.togglePublish);

module.exports = router;
