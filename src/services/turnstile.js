// Verificación de Cloudflare Turnstile (CAPTCHA invisible/de un clic) para
// los formularios de la app Flutter Web de consumo — register/login. La APK
// no necesita esto (no hay navegador), y tampoco el panel admin ni el sitio
// estático propio (mismo dominio que la API, nunca tuvieron el widget).

const { isConsumerWebOrigin } = require('../utils/webOrigin');

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verifyTurnstile(token, remoteip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { success: false, reason: 'not_configured' };
  if (!token) return { success: false, reason: 'missing_token' };

  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.append('remoteip', remoteip);

  try {
    const resp = await fetch(VERIFY_URL, { method: 'POST', body });
    const data = await resp.json();
    return { success: data.success === true, errorCodes: data['error-codes'] || [] };
  } catch (e) {
    return { success: false, reason: 'network_error' };
  }
}

// Middleware para rutas expuestas a formularios de la app Flutter Web.
// - Peticiones sin header Origin (la APK), o con Origin del propio dominio
//   de la API (panel admin, sitio estático) pasan sin verificar.
// - Si TURNSTILE_SECRET_KEY no está configurado aún, deja pasar (no bloquea
//   el flujo antes de que Cloudflare esté configurado) pero registra un aviso.
// - Si está configurado y es la app Flutter Web de consumo, exige y valida el token.
function requireTurnstile() {
  return async (req, res, next) => {
    if (!isConsumerWebOrigin(req)) return next();

    if (!process.env.TURNSTILE_SECRET_KEY) {
      console.warn('[turnstile] TURNSTILE_SECRET_KEY no configurado — verificación anti-bot omitida');
      return next();
    }

    const token = req.body?.turnstileToken;
    if (!token) {
      return res.status(400).json({
        success: false, data: null,
        error: 'Falta la verificación anti-bot (turnstileToken)',
      });
    }

    const result = await verifyTurnstile(token, req.ip);
    if (!result.success) {
      return res.status(403).json({
        success: false, data: null,
        error: 'Verificación anti-bot fallida. Recarga la página e inténtalo de nuevo.',
      });
    }

    next();
  };
}

module.exports = { verifyTurnstile, requireTurnstile };
