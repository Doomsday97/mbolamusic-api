// Integración con Flutterwave — Mobile Money + Tarjeta en región CEMAC.
// Docs: https://developer.flutterwave.com/
// Requiere Node.js 18+ (fetch nativo) o instalar: npm install node-fetch
//
// Para activar:
//   PAYMENT_PROVIDER="flutterwave"
//   FLW_SECRET_KEY="..."
//   FLW_WEBHOOK_HASH="..."  (configura esto en el dashboard de Flutterwave)

const FLW_API = 'https://api.flutterwave.com/v3';

// Mapeo de métodos internos a tipos de Flutterwave
const FLW_TYPES = {
  SIM_BALANCE: 'mobile_money_franco', // Mobile Money zona franco CFA
  CARD:         'card',
  BANK_TRANSFER: null,                 // Transferencia bancaria manual (no Flutterwave)
};

async function charge({ amount, method, userId, purpose, metadata = {} }) {
  // Transferencias bancarias no van por Flutterwave: el admin las confirma manualmente.
  // Se resuelven aquí antes de verificar la clave, porque no llaman a la API.
  if (method === 'BANK_TRANSFER') {
    return {
      status: 'VERIFYING',
      externalRef: null,
      message: 'Transfiere el importe indicado y sube tu comprobante. Un administrador lo verificará.',
      bankDetails: {
        bankName:      process.env.BANK_NAME          || 'Banco',
        accountName:   process.env.BANK_ACCOUNT_NAME  || 'MbôláMusic',
        accountNumber: process.env.BANK_ACCOUNT_NUMBER || '000000000000',
        amount,
        currency: 'XAF',
      },
    };
  }

  const secret = process.env.FLW_SECRET_KEY;
  if (!secret) throw new Error('Flutterwave no configurado: falta FLW_SECRET_KEY');

  const flwType = FLW_TYPES[method];
  if (!flwType) throw new Error(`Método no soportado: ${method}`);

  const txRef = `mbola-${Date.now()}-${userId.slice(0, 8)}`;

  const body = {
    amount,
    currency: 'XAF',  // Franco CFA Central (CEMAC)
    tx_ref: txRef,
    redirect_url: process.env.FLW_REDIRECT_URL || '',
    customer: {
      email: metadata.email || `${userId}@mbolamusic.app`,
      name: metadata.username || userId,
      phonenumber: metadata.phone || '',
    },
  };

  // Mobile Money requiere número de teléfono y red del operador
  if (method === 'SIM_BALANCE') {
    body.phone_number = metadata.phone || '';
    body.network = metadata.network || 'MTN'; // MTN, Orange, Moov...
  }

  const resp = await fetch(`${FLW_API}/charges?type=${flwType}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();

  if (!resp.ok || data.status === 'error') {
    throw new Error(data.message || `Error Flutterwave (${resp.status})`);
  }

  const flwStatus = data.data?.status;
  const flwRef    = data.data?.id ? String(data.data.id) : null;
  // Algunos métodos (tarjeta con 3DS) necesitan redirección del usuario
  const redirectUrl = data.meta?.authorization?.redirect || null;

  return {
    status: flwStatus === 'successful' ? 'COMPLETED' : 'PENDING',
    externalRef: flwRef || txRef,
    redirectUrl,
    message: data.message,
  };
}

// Verifica la firma del webhook (header verif-hash == FLW_WEBHOOK_HASH)
function verifyWebhook(req) {
  const signature = req.headers['verif-hash'];
  const expected  = process.env.FLW_WEBHOOK_HASH;
  return !!(signature && expected && signature === expected);
}

// Extrae los datos del evento webhook de Flutterwave
function parseWebhookEvent(body) {
  return {
    externalRef: body.data?.id ? String(body.data.id) : null,
    txRef:  body.data?.tx_ref || null,
    status: body.data?.status === 'successful' ? 'COMPLETED' : 'FAILED',
  };
}

module.exports = { charge, verifyWebhook, parseWebhookEvent };
