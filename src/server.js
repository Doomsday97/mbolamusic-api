require('dotenv').config();
const app  = require('./app');
const jobs = require('./jobs/monthlyDistribution');
const purgeJob = require('./jobs/purgeDeletedTracks');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🎵 MbôláMusic API escuchando en http://localhost:${PORT}`);
  console.log(`   Proveedor de pago: ${process.env.PAYMENT_PROVIDER || 'mock'}`);
  jobs.start();
  purgeJob.start();
});
