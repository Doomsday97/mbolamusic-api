const router = require('express').Router();
const admin = require('../controllers/adminController');
const pay = require('../controllers/paymentController');
const { authenticate, requireRole } = require('../middleware/auth');
const { upload } = require('../config/upload');

router.use(authenticate, requireRole('ADMIN'));

router.get('/stats',                       admin.stats);
router.get('/users',                       admin.listUsers);
router.get('/users/:id',                   admin.getUser);
router.put('/users/:id',                   admin.updateUser);
router.post('/users/:id/reset-password',   admin.resetPassword);
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

// Migración de URLs de medios al CDN público
router.post('/fix-media-urls',             admin.fixMediaUrls);

// Dar prueba gratuita de 30 días a todos los artistas sin suscripción activa
router.post('/fix-artist-trials',          admin.fixArtistTrials);

// Usuarios conectados
router.get('/online',                      admin.onlineUsers);

// Ganancias de la plataforma
router.get('/platform-earnings',                    admin.platformEarnings);
router.post('/platform-withdraw',                   admin.platformWithdraw);

// Reparto mensual por suscripción
router.get('/subscription-distributions',           admin.subscriptionDistributions);
router.post('/subscription-distributions/run',      admin.runSubscriptionDistribution);
router.get('/subscription-config',                  admin.subscriptionConfig);
router.post('/subscription-config',                 admin.subscriptionConfig);
router.get('/monthly-report/:month',                admin.monthlyReport);

module.exports = router;
