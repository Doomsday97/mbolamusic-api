'use strict';

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const routes     = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { UPLOAD_DIR }   = require('./services/storage');

const app = express();

// Render usa un reverse proxy que añade X-Forwarded-For;
// sin trust proxy, express-rate-limit no puede leer la IP real del cliente.
app.set('trust proxy', 1);

// ── 1. Security headers (helmet) ─────────────────────────────────────────────
app.use(helmet({
  // HSTS: obliga HTTPS durante 1 año (incluido en subdomains)
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  // Content-Security-Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'"],   // inline JS en admin/web
      scriptSrcAttr:  ["'unsafe-inline'"],              // onclick= onchange= etc.
      styleSrc:       ["'self'", "'unsafe-inline'"],
      imgSrc:         ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc:       ["'self'", 'https:'],             // audio streaming
      connectSrc:     ["'self'", 'https:'],
      fontSrc:        ["'self'", 'https:', 'data:'],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  // X-Frame-Options: bloquear iframes
  frameguard: { action: 'deny' },
  // X-Content-Type-Options: no sniffing
  noSniff: true,
  // Referrer-Policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // X-DNS-Prefetch-Control
  dnsPrefetchControl: { allow: false },
  // Permissions-Policy
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
}));

// Permissions-Policy header explícito (helmet no lo cubre del todo)
app.use((req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  next();
});

// ── 2. CORS estricto ──────────────────────────────────────────────────────────
const rawOrigins = process.env.ALLOWED_ORIGINS || '';
const allowedOrigins = rawOrigins
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Dominios propios siempre permitidos aunque ALLOWED_ORIGINS esté vacía.
// La APK no envía Origin y también está permitida (ver `if (!origin)` abajo).
const OWN_DOMAINS = [
  'https://mbolamusic-apionrender.com',
  'https://www.mbolamusic-apionrender.com',
  'https://mbolamusic.com',
  'https://www.mbolamusic.com',
];
const ALL_ORIGINS = [...new Set([...OWN_DOMAINS, ...allowedOrigins])];

app.use(cors({
  origin: (origin, cb) => {
    // Sin origen = petición móvil nativa o curl → permitir
    if (!origin) return cb(null, true);
    // Comparación EXACTA: usar startsWith() aquí permitiría que un origen como
    // "https://mbolamusic.com.attacker.com" pasara el filtro por tener el
    // dominio propio como prefijo.
    const ok = ALL_ORIGINS.includes(origin);
    if (ok) return cb(null, true);
    cb(Object.assign(new Error('CORS no permitido'), { status: 403 }));
  },
  credentials: true,
  methods:  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,   // preflight en caché 24 h
}));

// ── 3. Rate limiting ──────────────────────────────────────────────────────────
// Global: 200 req / 15 min por IP
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiadas peticiones. Inténtalo más tarde.' },
  skip: req => req.path === '/health' || req.path === '/health-check',
}));

// Auth: 20 intentos / 15 min (protege login y registro)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiados intentos. Espera 15 minutos.' },
});
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

// ── 4. Body parsers ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── 5. Rutas estáticas ────────────────────────────────────────────────────────
app.use('/admin', express.static(path.join(__dirname, '../public/admin')));

if (process.env.STORAGE_PROVIDER !== 's3') {
  app.use('/uploads', express.static(path.join(process.cwd(), UPLOAD_DIR)));
}

// ── 6. API ────────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ── 7. Health checks ──────────────────────────────────────────────────────────
const healthHandler = (req, res) => res.json({ status: 'ok' });
app.get('/health',       healthHandler);
app.get('/health-check', healthHandler);

// ── 8. Web (al final para no interferir con /api ni /admin) ──────────────────
app.use('/', express.static(path.join(__dirname, '../website')));

// ── 9. Error handler ─────────────────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
