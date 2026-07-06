// Verificación de Cloudflare Turnstile (CAPTCHA invisible/de un clic) para
// cualquier formulario de login/registro servido desde un navegador (sitio
// propio, panel admin, o la futura app Flutter Web de consumo). La APK no
// necesita esto (no hay navegador, no manda header Origin).
//
// Antes solo se exigía a un dominio externo hipotético (isConsumerWebOrigin),
// dejando sin protección anti-bot real tanto al sitio público como al login
// del panel admin -- una auditoría de seguridad confirmó con una prueba real
// que se podía registrar una cuenta sin ninguna verificación anti-bot.
const { isBrowserRequest } = require('../utils/webOrigin');

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

// Middleware para rutas expuestas a formularios web (cualquier navegador).
// - Peticiones sin header Origin (la APK) pasan sin verificar.
// - Si TURNSTILE_SECRET_KEY no está configurado aún, deja pasar (no bloquea
//   el flujo antes de que Cloudflare esté configurado) pero registra un aviso.
// - Si está configurado y la petición viene de un navegador, exige y valida el token.
function requireTurnstile() {
  return async (req, res, next) => {
    if (!isBrowserRequest(req)) return next();

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
