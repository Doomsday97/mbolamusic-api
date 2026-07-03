const { verifyToken } = require('../utils/jwt');
const { fail } = require('../utils/response');
const prisma = require('../config/prisma');
const onlineTracker = require('./onlineTracker');

// Verifica el JWT y carga el usuario en req.user.
// Acepta el token de dos formas:
//  - Header "Authorization: Bearer <token>" (APK / Postman / curl)
//  - Cookie HttpOnly "token" (Flutter Web, la puso /api/auth/login)
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const bearerToken = header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = bearerToken || req.cookies?.token || null;
    if (!token) return fail(res, 'No autenticado', 401);

    const decoded = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { artistProfile: true },
    });
    if (!user) return fail(res, 'Usuario no encontrado', 401);
    if (user.deletedAt) return fail(res, 'Esta cuenta ha sido eliminada', 403);

    req.user = user;
    onlineTracker.track(req); // registrar presencia
    next();
  } catch (e) {
    return fail(res, 'Token inválido o expirado', 401);
  }
}

// Restringe el acceso a ciertos roles. Uso: requireRole('ARTIST')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return fail(res, 'No tienes permiso para esta acción', 403);
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
