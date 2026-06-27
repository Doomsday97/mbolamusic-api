const { fail } = require('../utils/response');

// Manejador global de errores
function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err);
  if (res.headersSent) return next(err);
  return fail(res, err.message || 'Error interno del servidor', err.status || 500);
}

module.exports = { errorHandler };
