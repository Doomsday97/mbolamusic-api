// Lista única de orígenes conocidos/confiables — fuente compartida para:
//  - CORS (app.js): qué orígenes pueden hacer peticiones cross-origin.
//  - Distinguir "app Flutter Web de consumo" de "panel admin/sitio propio"
//    (mismo dominio que esta API) en authController.js/turnstile.js.
//  - Mitigación CSRF (middleware/auth.js): validar el header Origin en
//    peticiones autenticadas por cookie (ver más abajo, por qué hace falta).
const rawExtra = process.env.ALLOWED_ORIGINS || '';
const extraOrigins = rawExtra.split(',').map(o => o.trim()).filter(Boolean);

// Dominios propios siempre permitidos, incluso si ALLOWED_ORIGINS está vacía.
const OWN_DOMAINS = [
  'https://mbolamusic-apionrender.com',
  'https://www.mbolamusic-apionrender.com',
  'https://mbolamusic.com',
  'https://www.mbolamusic.com',
];

// Dominios donde vive esta MISMA API (sirve el panel admin y el sitio
// estático directamente) -- distinto de mbolamusic.com, que es donde vivirá
// la futura app Flutter Web de consumo, en un dominio/hosting separado.
const API_OWN_ORIGINS = new Set([
  'https://mbolamusic-apionrender.com',
  'https://www.mbolamusic-apionrender.com',
]);

const KNOWN_ORIGINS = new Set([...OWN_DOMAINS, ...extraOrigins]);

// ¿Esta petición viene de la app Flutter Web de consumo (dominio distinto
// al de la propia API, ej. mbolamusic.com)? APK (sin Origin) y panel
// admin/sitio propio (mismo dominio) devuelven false.
function isConsumerWebOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  return !API_OWN_ORIGINS.has(origin);
}

// ¿El Origin de esta petición es uno de los conocidos/confiables? Se usa
// tanto para CORS como para exigir un Origin válido en peticiones
// autenticadas por cookie (mitigación CSRF -- ver auth.js).
function isKnownOrigin(origin) {
  return KNOWN_ORIGINS.has(origin);
}

module.exports = { isConsumerWebOrigin, isKnownOrigin, KNOWN_ORIGINS, API_OWN_ORIGINS };
