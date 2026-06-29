// Proveedor de pago SIMULADO.
// Permite probar todo el flujo sin claves reales.
// Devuelve siempre éxito (excepto si el monto es 0).

const { v4: uuid } = require('uuid');

async function charge({ amount, method, userId, purpose, metadata = {} }) {
  if (!amount || amount <= 0) {
    return { status: 'FAILED', externalRef: null, message: 'Monto inválido' };
  }

  // Transferencia bancaria y saldo SIM/Mobile Money → requieren verificación manual de admin
  if (method === 'BANK_TRANSFER') {
    return {
      status: 'VERIFYING',
      externalRef: 'TRANSFER-' + uuid().slice(0, 8),
      message: 'Sube tu comprobante. Un administrador verificará el pago.',
      bankDetails: {
        bankName: process.env.BANK_NAME || 'Banco',
        accountName: process.env.BANK_ACCOUNT_NAME || 'MbôláMusic',
        accountNumber: process.env.BANK_ACCOUNT_NUMBER || '000000000000',
        amount,
      },
    };
  }

  if (method === 'SIM_BALANCE') {
    return {
      status: 'VERIFYING',
      externalRef: 'SIM-' + uuid().slice(0, 8),
      message: 'Recarga por saldo SIM enviada. Un administrador confirmará el pago en breve.',
    };
  }

  // Tarjeta (Flutterwave) y Wallet interno → se completan al instante
  return {
    status: 'COMPLETED',
    externalRef: 'MOCK-' + uuid().slice(0, 8),
    message: 'Pago simulado completado',
  };
}

module.exports = { charge };
