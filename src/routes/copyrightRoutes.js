const router = require('express').Router();
const copyright = require('../controllers/copyrightController');
const { authenticate } = require('../middleware/auth');

// Cualquier usuario logueado (oyente o artista) puede reportar una
// reclamación de copyright desde Ajustes, y ver el estado de las suyas.
// La gestión completa (contactar, cambiar estado, ver todas) sigue siendo
// exclusiva de ADMIN, en /api/admin/copyright-claims.
router.use(authenticate);
router.post('/',     copyright.createClaim);
router.get('/mine',  copyright.listMyClaims);

module.exports = router;
