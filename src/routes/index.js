const router = require('express').Router();

router.use('/auth',     require('./authRoutes'));
router.use('/tracks',   require('./trackRoutes'));
router.use('/payments', require('./paymentRoutes'));
router.use('/artist',   require('./artistRoutes'));
router.use('/admin',     require('./adminRoutes'));
router.use('/playlists',      require('./playlistRoutes'));
router.use('/notifications',  require('./notificationRoutes'));
router.use('/chat',           require('./chatRoutes'));
router.use('/copyright-claims', require('./copyrightRoutes'));

// Llamado por el workflow de CI tras publicar una nueva APK (ver nota de
// seguridad en adminController.broadcastUpdate: usa secreto compartido, no JWT).
router.post('/system/broadcast-update', require('../controllers/adminController').broadcastUpdate);

// Endpoint público: anuncios activos por slot
router.get('/ads', require('../controllers/adminController').publicAds);
router.post('/ads/:id/click',      require('../controllers/adminController').trackAdClick);
router.post('/ads/:id/impression', require('../controllers/adminController').trackAdImpression);

// Endpoint público: tasas de conversión FCFA → EUR/USD (referencia para pagos)
router.get('/currency-rates', async (req, res) => {
  const rates = await require('../services/currencyService').getRates();
  res.json({ success: true, data: rates, error: null });
});

router.get('/', (req, res) => {
  res.json({
    success: true,
    data: { name: 'MbôláMusic API', version: '1.0.0' },
    error: null,
  });
});

module.exports = router;
