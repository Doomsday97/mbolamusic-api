// Tests del servicio de almacenamiento (modo local)
// Los tests S3 requieren credenciales reales y se omiten aquí.

process.env.STORAGE_PROVIDER = 'local';
process.env.UPLOAD_DIR = 'uploads';

const path = require('path');
const fs = require('fs');
const os = require('os');

// Importar después de setear variables de entorno
const storage = require('../src/services/storage');

describe('Storage service — modo local', () => {
  test('publicUrl genera ruta /uploads/filename', () => {
    expect(storage.publicUrl('abc.mp3')).toBe('/uploads/abc.mp3');
  });

  test('ensureDir crea la carpeta si no existe', () => {
    const dir = storage.ensureDir();
    expect(fs.existsSync(dir)).toBe(true);
  });

  test('upload() en modo local devuelve URL pública', async () => {
    // Crear archivo temporal como simularía multer
    const tmpPath = path.join(os.tmpdir(), 'test-upload.mp3');
    fs.writeFileSync(tmpPath, 'fake audio data');

    // Copiar al directorio de uploads (como haría multer diskStorage)
    const uploadsDir = storage.ensureDir();
    const filename = 'test-track.mp3';
    const destPath = path.join(uploadsDir, filename);
    fs.copyFileSync(tmpPath, destPath);
    fs.unlinkSync(tmpPath);

    const fakeFile = { filename, path: destPath, mimetype: 'audio/mpeg' };
    const url = await storage.upload(fakeFile);
    expect(url).toBe('/uploads/test-track.mp3');

    // Limpieza
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
  });

  test('deleteFile() elimina archivo local', async () => {
    const uploadsDir = storage.ensureDir();
    const filename = 'delete-me.mp3';
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, 'data');

    await storage.deleteFile(`/uploads/${filename}`);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('deleteFile() no lanza error si el archivo no existe', async () => {
    await expect(storage.deleteFile('/uploads/no-existe.mp3')).resolves.not.toThrow();
  });
});
