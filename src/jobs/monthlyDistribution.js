/**
 * Cron job: runs on the 1st of every month at 00:05 to distribute
 * the previous month's subscription revenue among artists.
 */
const cron = require('node-cron');
const { runDistribution, previousMonth } = require('../services/subscriptionDistributionService');

function start() {
  cron.schedule('5 0 1 * *', async () => {
    const month = previousMonth();
    console.log(`[cron] Iniciando reparto mensual de suscripciones: ${month}`);
    try {
      const result = await runDistribution(month);
      console.log(`[cron] Reparto completado:`, result);
    } catch (err) {
      console.error('[cron] Error en reparto mensual:', err);
    }
  }, { timezone: 'Africa/Malabo' });

  console.log('[cron] Job de reparto mensual programado (1º de cada mes 00:05 WAT)');
}

module.exports = { start };
