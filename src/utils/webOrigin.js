// Distingue entre los distintos clientes que llaman a la API:
//  - APK (sin header Origin) -> nunca es "consumer web".
//  - Panel admin / sitio estático (servidos por este MISMO backend, en
//    mbolamusic-apionrender.com) -> el navegador SÍ manda Origin en peticiones
//    al propio dominio, pero deben seguir tratándose como antes (token JSON
//    en el body, sin exigir Turnstile): nunca tuvieron ese widget integrado.
//  - App Flutter Web de consumo (dominio distinto, ej. mbolamusic.com,
//    normalmente en Cloudflare Pages) -> aquí sí aplica cookie HttpOnly +
//    verificación Turnstile.
const API_OWN_ORIGINS = new Set([
  'https://mbolamusic-apionrender.com',
  'https://www.mbolamusic-apionrender.com',
]);

function isConsumerWebOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  return !API_OWN_ORIGINS.has(origin);
}

module.exports = { isConsumerWebOrigin, API_OWN_ORIGINS };
