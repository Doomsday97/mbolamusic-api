const multer = require('multer');
const path = require('path');
const { v4: uuid } = require('uuid');
const { ensureDir, UPLOAD_DIR } = require('../services/storage');

// Solo letras/números en la extensión servida (máx. 10 caracteres). El
// nombre original del archivo lo controla quien sube el archivo -- sin
// esto, alguien podría nombrar su archivo con comillas/HTML dentro de lo
// que path.extname() toma como "extensión" (ej. "foto.j\"pg"), y esa
// extensión termina literalmente en la URL pública servida del archivo,
// abriendo una XSS cuando esa URL se inserta sin escapar en el HTML del
// sitio/panel admin (ej. <img src="...">).
function safeExt(originalname) {
  const raw = path.extname(originalname || '').slice(1);
  const clean = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  return clean ? `.${clean.toLowerCase()}` : '';
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, ensureDir());
  },
  filename: (req, file, cb) => {
    cb(null, `${uuid()}${safeExt(file.originalname)}`);
  },
});

// Lista exacta (no prefijo) de tipos MIME permitidos -- "startsWith('image/')"
// deja pasar valores manipulados como "image/jpeg\" onerror=\"alert(1)" que
// técnicamente empiezan por "image/" pero contienen HTML/JS.
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus', '.wma', '.mp4', '.webm']);

// Se usa para subir audio ('audio') y portada ('cover') de una canción. Sin
// fileFilter, el campo 'cover' aceptaba cualquier tipo de archivo (incluido
// HTML/SVG con script embebido) y storage.js lo sirve de vuelta usando el
// mimetype que el propio cliente declaró -- eso permitía alojar contenido
// malicioso disfrazado de "portada". El campo 'audio' se valida por prefijo
// audio/ + fallback por extensión porque Android/Flutter a veces mandan
// application/octet-stream para archivos de audio válidos.
function trackFileFilter(req, file, cb) {
  if (file.fieldname === 'cover') {
    if (IMAGE_MIMES.has(file.mimetype)) return cb(null, true);
    return cb(new Error('La portada debe ser una imagen (JPEG, PNG, WEBP, GIF)'));
  }
  if (file.fieldname === 'audio') {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (file.mimetype.startsWith('audio/') || AUDIO_EXTS.has(ext)) return cb(null, true);
    return cb(new Error('El archivo no es de audio válido'));
  }
  cb(new Error('Campo de archivo no reconocido'));
}

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB máx por archivo
  fileFilter: trackFileFilter,
});

// Para avatares: almacena en memoria (no depende del disco efímero de Render)
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB máx para fotos de perfil
  fileFilter: (req, file, cb) => {
    if (IMAGE_MIMES.has(file.mimetype)) return cb(null, true);
    cb(new Error('Solo se permiten imágenes (JPEG, PNG, WEBP, GIF)'));
  },
});

// Adjuntos del chat de soporte: foto o video corto (máx. ~15 s)
const uploadChatMedia = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB máx
  fileFilter: (req, file, cb) => {
    if (IMAGE_MIMES.has(file.mimetype) || VIDEO_MIMES.has(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('Solo se permiten imágenes o videos'));
  },
});

module.exports = { upload, uploadMemory, uploadChatMedia };
