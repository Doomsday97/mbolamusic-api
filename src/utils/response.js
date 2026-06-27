// Respuestas estandarizadas { success, data, error }

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data, error: null });
}

function fail(res, message, status = 400) {
  return res.status(status).json({ success: false, data: null, error: message });
}

module.exports = { ok, fail };
