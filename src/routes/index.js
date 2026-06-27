const router = require('express').Router();

router.use('/auth',     require('./authRoutes'));
router.use('/tracks',   require('./trackRoutes'));
router.use('/payments', require('./paymentRoutes'));
router.use('/artist',   require('./artistRoutes'));
router.use('/admin',     require('./adminRoutes'));
router.use('/playlists',      require('./playlistRoutes'));
router.use('/notifications',  require('./notificationRoutes'));

router.get('/', (req, res) => {
  res.json({
    success: true,
    data: { name: 'MbôláMusic API', version: '1.0.0' },
    error: null,
  });
});

module.exports = router;
