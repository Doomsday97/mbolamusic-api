// Notificaciones push (Firebase Cloud Messaging).
// Requiere la variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON (contenido
// completo del JSON de la cuenta de servicio de Firebase Admin SDK).
//
// firebase-admin v14 usa una API modular: no existe admin.credential.cert
// ni admin.messaging() en el import por defecto -- hay que importar cada
// servicio desde su propio subpath (firebase-admin/app, firebase-admin/messaging).
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const prisma = require('../config/prisma');

let _initialized = false;
let _app = null;

function _init() {
  if (_initialized) return _app !== null;
  _initialized = true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn('[push] FIREBASE_SERVICE_ACCOUNT_JSON no configurada; las notificaciones push están desactivadas.');
    return false;
  }
  try {
    const serviceAccount = JSON.parse(raw);
    _app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
    return true;
  } catch (e) {
    console.error('[push] No se pudo inicializar Firebase Admin:', e.message);
    return false;
  }
}

// Envía una notificación push a todos los usuarios con token FCM registrado,
// avisando que hay una nueva versión de la APK disponible.
async function broadcastUpdate({ versionName, apkUrl, releaseNotes }) {
  if (!_init()) return { sent: 0, failed: 0, disabled: true };

  const users = await prisma.user.findMany({
    where: { fcmToken: { not: null }, deletedAt: null },
    select: { id: true, fcmToken: true },
  });
  if (users.length === 0) return { sent: 0, failed: 0 };

  const message = {
    notification: {
      title: `Nueva versión disponible: ${versionName}`,
      body: releaseNotes || 'Toca para descargar la actualización.',
    },
    data: {
      type: 'APK_UPDATE',
      apkUrl: apkUrl || '',
      versionName: versionName || '',
    },
    tokens: users.map((u) => u.fcmToken),
  };

  const res = await getMessaging(_app).sendEachForMulticast(message);

  // Limpiar tokens invalidos/expirados para no reintentar en el futuro
  const invalidUserIds = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code;
    if (!r.success && (code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered')) {
      invalidUserIds.push(users[i].id);
    }
  });
  if (invalidUserIds.length > 0) {
    await prisma.user.updateMany({ where: { id: { in: invalidUserIds } }, data: { fcmToken: null } });
  }

  return { sent: res.successCount, failed: res.failureCount };
}

module.exports = { broadcastUpdate };
