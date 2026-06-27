const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { UPLOAD_DIR } = require('./services/storage');

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3001', 'http://localhost:3000', 'http://192.168.1.9:3001'];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) return cb(null, true);
    cb(new Error('CORS no permitido'));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Panel de administración (HTML estático)
app.use('/admin', express.static(path.join(__dirname, '../public/admin')));

// Sitio web (landing page)
app.use('/', express.static(path.join(__dirname, '../../website')));

// Servir archivos subidos (audio/carátulas) solo en modo local
if (process.env.STORAGE_PROVIDER !== 's3') {
  app.use('/uploads', express.static(path.join(process.cwd(), UPLOAD_DIR)));
}

// API
app.use('/api', routes);

// Salud
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Manejador de errores (al final)
app.use(errorHandler);

module.exports = app;
