// Selector de proveedor de pago según PAYMENT_PROVIDER en .env

const mock = require('./mockProvider');
const flutterwave = require('./flutterwaveProvider');

function getProvider() {
  const name = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
  switch (name) {
    case 'flutterwave':
      return flutterwave;
    case 'mock':
    default:
      return mock;
  }
}

module.exports = { getProvider };
