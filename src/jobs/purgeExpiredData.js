/**
 * Cron job diario: borra definitivamente los registros que ya superaron el
 * plazo de conservación fijado en la Política de Privacidad (§4 Plazos de
 * Conservación), independientemente de si la cuenta sigue activa o fue
 * eliminada por un admin:
 *   - Pagos y transacciones: 10 años (obligación contable).
 *   - Registros de reproducción y descarga: 2 años.
 *
 * No afecta a los datos de la cuenta en sí (eso lo gestiona
 * adminController.deleteAccount, que anonimiza de inmediato al eliminar).
 */
const cron = require('node-cron');
const prisma = require('../config/prisma');

const PAYMENT_RETENTION_YEARS = 10;
const PLAY_DOWNLOAD_RETENTION_YEARS = 2;

function yearsAgo(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d;
}

async function purgeExpiredData() {
  const paymentCutoff = yearsAgo(PAYMENT_RETENTION_YEARS);
  const playDownloadCutoff = yearsAgo(PLAY_DOWNLOAD_RETENTION_YEARS);

  const [payments, plays, downloads] = await Promise.all([
    prisma.payment.deleteMany({ where: { createdAt: { lt: paymentCutoff } } }),
    prisma.play.deleteMany({ where: { createdAt: { lt: playDownloadCutoff } } }),
    prisma.download.deleteMany({ where: { createdAt: { lt: playDownloadCutoff } } }),
  ]);

  return { payments: payments.count, plays: plays.count, downloads: downloads.count };
}

function start() {
  // Todos los días a las 03:00
  cron.schedule('0 3 * * *', async () => {
    try {
      const r = await purgeExpiredData();
      const total = r.payments + r.plays + r.downloads;
      if (total > 0) {
        console.log(`[cron] Purga de retención legal: ${r.payments} pagos, ${r.plays} reproducciones, ${r.downloads} descargas`);
      }
    } catch (err) {
      console.error('[cron] Error en la purga de retención legal:', err);
    }
  });

  console.log('[cron] Job de purga de datos por retención legal programado (diario 03:00)');
}

module.exports = { start, purgeExpiredData };
