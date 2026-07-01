/**
 * Cron job: cada hora, borra definitivamente (BD + archivos en R2) las
 * canciones que fueron eliminadas por su artista hace más de 48 horas.
 * Antes de ese plazo, la canción sigue existiendo (oculta) y puede
 * restaurarse con POST /api/tracks/:id/restore.
 */
const cron = require('node-cron');
const prisma = require('../config/prisma');
const storage = require('../services/storage');

const RETENTION_HOURS = 48;

async function purgeExpiredTracks() {
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);
  const expired = await prisma.track.findMany({
    where: { deletedAt: { lte: cutoff } },
    select: { id: true, title: true, audioUrl: true, coverUrl: true },
  });

  for (const t of expired) {
    await storage.deleteFile(t.audioUrl).catch(() => {});
    if (t.coverUrl) await storage.deleteFile(t.coverUrl).catch(() => {});
    await prisma.track.delete({ where: { id: t.id } });
  }

  return expired.length;
}

function start() {
  cron.schedule('0 * * * *', async () => {
    try {
      const count = await purgeExpiredTracks();
      if (count > 0) console.log(`[cron] Purgadas ${count} canciones eliminadas hace más de ${RETENTION_HOURS}h`);
    } catch (err) {
      console.error('[cron] Error purgando canciones eliminadas:', err);
    }
  });

  console.log('[cron] Job de purga de canciones eliminadas programado (cada hora)');
}

module.exports = { start, purgeExpiredTracks };
