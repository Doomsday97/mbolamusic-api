require('dotenv').config();
const app  = require('./app');
const jobs = require('./jobs/monthlyDistribution');
const purgeJob = require('./jobs/purgeDeletedTracks');
const purgeExpiredDataJob = require('./jobs/purgeExpiredData');
const bootstrapSuperAdmin = require('./jobs/bootstrapSuperAdmin');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🎵 MbôláMusic API escuchando en http://localhost:${PORT}`);
  console.log(`   Proveedor de pago: ${process.env.PAYMENT_PROVIDER || 'mock'}`);
  jobs.start();
  purgeJob.start();
  purgeExpiredDataJob.start();
  bootstrapSuperAdmin.run()
    .then((r) => {
      if (!r.alreadyExists && r.superAdmin) {
        console.log(`[bootstrap] Admin principal designado: ${r.superAdmin.username}`);
      }
    })
    .catch((e) => console.error('[bootstrap] Error designando admin principal:', e.message));
});
