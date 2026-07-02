require('dotenv').config();

// Red de seguridad: en Express 4, un error lanzado (o una promesa rechazada)
// dentro de un controlador `async` sin su propio try/catch NO se reenvía al
// errorHandler -- se convierte en un unhandledRejection que, en Node.js
// moderno, termina TODO el proceso por defecto. Eso tumbaba el servidor
// entero para todos los usuarios por un solo request malformado (ej. un
// filtro de estado de pago inválido). Registrar estos handlers evita que un
// error de un solo request derribe el servicio completo.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

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
