const router = require('express').Router();
const tracks = require('../controllers/trackController');
const { authenticate, requireRole } = require('../middleware/auth');
const { upload } = require('../config/upload');

// Públicas
router.get('/',       tracks.listTracks);
router.get('/charts', tracks.charts);

// Social / Feed (requiere login)
router.get('/feed',               authenticate, tracks.feed);
router.get('/following',          authenticate, tracks.myFollowing);
router.post('/follow/:userId',    authenticate, tracks.followArtist);
router.delete('/follow/:userId',  authenticate, tracks.unfollowArtist);

// Artista
router.get('/mine',  authenticate, requireRole('ARTIST'), tracks.myTracks);
router.post(
  '/',
  authenticate,
  requireRole('ARTIST'),
  upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }]),
  tracks.uploadTrack,
);
router.delete('/:id', authenticate, requireRole('ARTIST'), tracks.deleteTrack);

// Reproducción (oyente)
router.post('/:id/play', authenticate, tracks.playTrack);

module.exports = router;
