// Registro en memoria de usuarios activos (últimos 5 minutos).
// No persiste entre reinicios del servidor — válido para indicador de presencia.
const users = new Map(); // userId -> { username, role, lastSeen, platform }

const WINDOW_MS = 5 * 60 * 1000; // 5 minutos

function track(req) {
  if (!req.user) return;
  const ua = req.headers['user-agent'] || '';
  const platform = ua.includes('Dart') || ua.includes('Flutter')
    ? 'App móvil'
    : ua.includes('Mozilla') ? 'Web'
    : 'API';

  users.set(req.user.id, {
    username:  req.user.username,
    email:     req.user.email,
    role:      req.user.role,
    lastSeen:  Date.now(),
    platform,
  });
}

function getOnline() {
  const cutoff = Date.now() - WINDOW_MS;
  const result = [];
  for (const [id, info] of users.entries()) {
    if (info.lastSeen > cutoff) result.push({ id, ...info });
    else users.delete(id); // limpiar expirados
  }
  return result.sort((a, b) => b.lastSeen - a.lastSeen);
}

module.exports = { track, getOnline };
