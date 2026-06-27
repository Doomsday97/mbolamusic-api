// Servicio de almacenamiento de audio y carátulas.
// STORAGE_PROVIDER=local  -> guarda en disco (carpeta uploads/), válido para desarrollo.
// STORAGE_PROVIDER=s3     -> sube a cualquier almacén S3-compatible:
//   AWS S3, Backblaze B2, Wasabi, Cloudflare R2, MinIO.
//   Requiere: npm install @aws-sdk/client-s3 @aws-sdk/lib-storage

const path = require('path');
const fs = require('fs');

const PROVIDER = process.env.STORAGE_PROVIDER || 'local';
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';

// Asegura que la carpeta temporal de multer existe
function ensureDir() {
  const dir = path.join(process.cwd(), UPLOAD_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Construye la URL pública local (solo modo "local")
function publicUrl(filename) {
  return `/uploads/${filename}`;
}

// Extrae el nombre de archivo (key) desde cualquier URL pública
function keyFromUrl(url) {
  return path.basename(url);
}

// ── S3 ─────────────────────────────────────────────────────────────────────
let _s3 = null;

function getS3Client() {
  if (_s3) return _s3;
  let S3Client;
  try {
    ({ S3Client } = require('@aws-sdk/client-s3'));
  } catch {
    throw new Error(
      'Para usar S3 instala las dependencias:\n  npm install @aws-sdk/client-s3 @aws-sdk/lib-storage'
    );
  }
  _s3 = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
    // Necesario para Backblaze B2 y algunos proveedores S3-compatible
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });
  return _s3;
}

function s3PublicUrl(key) {
  if (process.env.CDN_BASE_URL) {
    return `${process.env.CDN_BASE_URL.replace(/\/$/, '')}/${key}`;
  }
  // Fallback: URL directa del bucket
  return `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${key}`;
}

// ── API pública ─────────────────────────────────────────────────────────────

/**
 * Sube un archivo al proveedor activo.
 * @param {Express.Multer.File} file  - objeto file de multer (diskStorage)
 * @returns {Promise<string>}          - URL pública del archivo subido
 */
async function upload(file) {
  if (PROVIDER === 's3') {
    const { Upload } = require('@aws-sdk/lib-storage');

    const key = file.filename;
    const fileStream = fs.createReadStream(file.path);

    const managed = new Upload({
      client: getS3Client(),
      params: {
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: fileStream,
        ContentType: file.mimetype,
        // "public-read" permite acceso directo sin firma; usa "private" + CDN si prefieres
        ACL: process.env.S3_ACL || 'public-read',
      },
    });

    await managed.done();
    fs.unlinkSync(file.path); // borrar archivo temporal
    return s3PublicUrl(key);
  }

  // Modo local: el archivo ya está en disco, solo devolvemos la URL
  return publicUrl(file.filename);
}

/**
 * Elimina un archivo por su URL pública.
 * @param {string} url - URL devuelta por upload()
 */
async function deleteFile(url) {
  if (!url) return;
  const key = keyFromUrl(url);

  if (PROVIDER === 's3') {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await getS3Client().send(
      new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key })
    );
    return;
  }

  const filePath = path.join(process.cwd(), UPLOAD_DIR, key);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = { ensureDir, publicUrl, upload, deleteFile, UPLOAD_DIR };
