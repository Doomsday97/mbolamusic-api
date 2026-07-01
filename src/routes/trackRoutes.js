const router = require('express').Router();
const tracks = require('../controllers/trackController');
const { authenticate, requireRole } = require('../middleware/auth');
const { upload } = require('../config/upload');

// Públicas (rutas con nombre ANTES de /:id)
router.get('/',       tracks.listTracks);
router.get('/charts', tracks.charts);

// Social / Feed (requiere login)
router.get('/feed',               authenticate, tracks.feed);
router.get('/following',          authenticate, tracks.myFollowing);
router.post('/follow/:userId',    authenticate, tracks.followArtist);
router.delete('/follow/:userId',  authenticate, tracks.unfollowArtist);

// Likes (rutas con nombre — antes de /:id)
router.get('/liked', authenticate, tracks.likedTracks);

// Artista
router.get('/mine',  authenticate, requireRole('ARTIST'), tracks.myTracks);
router.post(
  '/',
  authenticate,
  upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }]),
  tracks.uploadTrack,
);
router.patch(
  '/:id',
  authenticate,
  upload.fields([{ name: 'cover', maxCount: 1 }]),
  tracks.updateTrack,
);
router.delete('/:id', authenticate, tracks.deleteTrack);

// Reproducción (oyente)
router.post('/:id/play', authenticate, tracks.playTrack);

// Likes (con parámetro :id)
router.post('/:id/like',  authenticate, tracks.toggleLike);
router.get('/:id/liked',  authenticate, tracks.isLiked);

// Info pública de una canción — DEBE ir al final para no interceptar rutas con nombre
router.get('/:id', tracks.getTrack);

module.exports = router;
