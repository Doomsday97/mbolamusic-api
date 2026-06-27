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

module.exports = { upload };
