require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🎵 MbôláMusic API escuchando en http://localhost:${PORT}`);
  console.log(`   Proveedor de pago: ${process.env.PAYMENT_PROVIDER || 'mock'}`);
});
