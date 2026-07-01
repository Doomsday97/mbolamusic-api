const { fail } = require('../utils/response');

// Manejador global de errores
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  // Multer: archivo demasiado grande
  if (err.code === 'LIMIT_FILE_SIZE') {
    return fail(res, 'La imagen es demasiado grande (máximo 2 MB). Comprime o recorta la foto antes de subirla.', 413);
  }
  console.error('[ERROR]', err);
  return fail(res, err.message || 'Error interno del servidor', err.status || 500);
}

module.exports = { errorHandler };
