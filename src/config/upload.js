const multer = require('multer');
const path = require('path');
const { v4: uuid } = require('uuid');
const { ensureDir, UPLOAD_DIR } = require('../services/storage');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, ensureDir());
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuid()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB máx por archivo
});

// Para avatares: almacena en memoria (no depende del disco efímero de Render)
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB máx para fotos de perfil
});

// Adjuntos del chat de soporte: foto o video corto (máx. ~15 s)
const uploadChatMedia = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB máx
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes o videos'));
    }
  },
});

module.exports = { upload, uploadMemory, uploadChatMedia };
