const router = require('express').Router();
const pl = require('../controllers/playlistController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/',                          pl.list);
router.post('/',                         pl.create);
router.get('/track/:trackId/in',         pl.trackInPlaylists);
router.get('/:id',                       pl.detail);
router.post('/:id/tracks',              pl.addTrack);
router.delete('/:id/tracks/:trackId',   pl.removeTrack);
router.delete('/:id',                   pl.deletePlaylist);

module.exports = router;
