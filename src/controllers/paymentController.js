const prisma = require('../config/prisma');
const business = require('../config/business');
const { ok, fail } = require('../utils/response');
const { getProvider } = require('../services/payment');
const subscriptionService = require('../services/subscriptionService');
const notif = require('./notificationController');

// El monedero interno es saldo propio del usuario, no un proveedor externo:
// se verifica y descuenta atómicamente aquí mismo (nunca pasaba por aquí
// antes -- el mock provider marcaba cualquier pago con method:'WALLET' como
// completado sin comprobar ni descontar el saldo real).
async function processWalletPayment({ user, amount, purpose, trackId }) {
  let artistShare = 0, platformShare = 0;
  if (purpose === 'PER_PLAY' || purpose === 'PER_DOWNLOAD') {
    artistShare = Math.round(amount * business.revenueSplit.artist);
    platformShare = amount - artistShare;
  }

  // UPDATE atómico con condición de saldo suficiente: evita condiciones de
  // carrera entre comprobar el saldo y descontarlo (ej. doble clic rápido).
  const deducted = await prisma.user.updateMany({
    where: { id: user.id, walletBalance: { gte: amount } },
    data: { walletBalance: { decrement: amount } },
  });
  const success = deducted.count > 0;

  const payment = await prisma.payment.create({
    data: {
      userId: user.id,
      amount,
      method: 'WALLET',
      purpose,
      trackId,
      status: success ? 'COMPLETED' : 'FAILED',
      externalRef: success ? 'WALLET-' + Date.now().toString(36) : null,
      artistShare: success ? artistShare : 0,
      platformShare: success ? platformShare : 0,
      completedAt: success ? new Date() : null,
    },
  });

  return {
    payment,
    result: {
      status: success ? 'COMPLETED' : 'FAILED',
      message: success ? undefined : 'Saldo insuficiente en el monedero',
    },
  };
}

// Crea un registro de pago y lo procesa con el proveedor activo
async function processPayment({ user, amount, method, purpose, trackId = null }) {
  if (method === 'WALLET') return processWalletPayment({ user, amount, purpose, trackId });

  const provider = getProvider();
  const result = await provider.charge({
    amount,
    method,
    userId: user.id,
    purpose,
    metadata: { trackId },
  });

  // Reparto para pay-per-use
  let artistShare = 0;
  let platformShare = 0;
  if (purpose === 'PER_PLAY' || purpose === 'PER_DOWNLOAD') {
    artistShare = Math.round(amount * business.revenueSplit.artist);
    platformShare = amount - artistShare;
  }

  const statusMap = {
    COMPLETED: 'COMPLETED',
    VERIFYING: 'VERIFYING',
    PENDING: 'PENDING',
    FAILED: 'FAILED',
  };

  const payment = await prisma.payment.create({
    data: {
      userId: user.id,
      amount,
      method,
      purpose,
      trackId,
      status: statusMap[result.status] || 'PENDING',
      externalRef: result.externalRef,
      artistShare,
      platformShare,
      completedAt: result.status === 'COMPLETED' ? new Date() : null,
    },
  });

  return { payment, result };
}

// POST /api/payments/artist-subscription
async function payArtistSubscription(req, res) {
  if (req.user.role !== 'ARTIST') return fail(res, 'Solo artistas', 403);
  const { method } = req.body;

  const { payment, result } = await processPayment({
    user: req.user,
    amount: business.prices.artistMonthly,
    method,
    purpose: 'ARTIST_SUBSCRIPTION',
  });

  if (result.status === 'COMPLETED') {
    await subscriptionService.createSubscription(req.user.id, 'ARTIST_MONTHLY');
  }

  return ok(res, { payment, result });
}

// POST /api/payments/listener-subscription  body: { method, autoRenew? }
async function payListenerSubscription(req, res) {
  const { method, autoRenew } = req.body;
  const { payment, result } = await processPayment({
    user: req.user,
    amount: business.prices.listenerMonthly,
    method,
    purpose: 'LISTENER_SUBSCRIPTION',
  });

  if (result.status === 'COMPLETED') {
    const sub = await subscriptionService.createSubscription(req.user.id, 'LISTENER_MONTHLY');
    if (autoRenew) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { autoRenew: true },
      });
    }
  }

  return ok(res, { payment, result });
}

// GET /api/payments/listener-subscription-yearly/price
// Devuelve el precio que le corresponde al oyente autenticado: 10.000 FCFA la
// primera vez que se suscribe al plan anual, 12.000 FCFA en adelante.
async function getListenerYearlyPrice(req, res) {
  const price = await subscriptionService.listenerYearlyPrice(req.user.id);
  return ok(res, price);
}

// POST /api/payments/listener-subscription-yearly  body: { method, autoRenew? }
async function payListenerYearlySubscription(req, res) {
  const { method, autoRenew } = req.body;
  const { amount } = await subscriptionService.listenerYearlyPrice(req.user.id);

  const { payment, result } = await processPayment({
    user: req.user,
    amount,
    method,
    purpose: 'LISTENER_SUBSCRIPTION_YEARLY',
  });

  if (result.status === 'COMPLETED') {
    const sub = await subscriptionService.createSubscription(req.user.id, 'LISTENER_YEARLY');
    if (autoRenew) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { autoRenew: true },
      });
    }
  }

  return ok(res, { payment, result });
}

const PAYMENT_METHODS = ['SIM_BALANCE', 'BANK_TRANSFER', 'CARD', 'WALLET'];

// POST /api/payments/per-play   body: { trackId, method }
async function payPerPlay(req, res) {
  const { trackId, method } = req.body;
  if (!PAYMENT_METHODS.includes(method)) return fail(res, `Método de pago inválido: ${method}`);
  try {
    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (!track) return fail(res, 'Canción no encontrada', 404);

    const { payment, result } = await processPayment({
      user: req.user,
      amount: business.prices.perPlay,
      method,
      purpose: 'PER_PLAY',
      trackId,
    });

    if (result.status === 'COMPLETED') {
      await registerPlay(req.user.id, track, false);
      await creditArtist(track.artistId, payment.artistShare);
    }

    return ok(res, { payment, result });
  } catch (e) {
    return fail(res, 'Error al procesar el pago', 500);
  }
}

// GET /api/payments/download-status/:trackId
// Permite al cliente saber, ANTES de mostrar el selector de método de pago,
// si el usuario ya compró esta descarga (p. ej. en otra sesión, o si borró
// el archivo local/cambió de cuenta y volvió), para saltar directo a
// descargar en vez de volver a pedirle que pague.
async function downloadStatus(req, res) {
  const { trackId } = req.params;
  const existingDownload = await prisma.download.findFirst({
    where: { userId: req.user.id, trackId },
  });
  return ok(res, { alreadyPurchased: !!existingDownload });
}

// POST /api/payments/per-download   body: { trackId, method }
async function payPerDownload(req, res) {
  const { trackId, method } = req.body;
  try {
  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track) return fail(res, 'Canción no encontrada', 404);

  // Si el usuario ya compró esta descarga antes (existe un Download suyo para
  // esta pista), no se le vuelve a cobrar: solo se le reenvía el audioUrl para
  // que pueda volver a descargarla (p. ej. tras cambiar de cuenta en el mismo
  // dispositivo y volver, o tras borrar el archivo local).
  const existingDownload = await prisma.download.findFirst({
    where: { userId: req.user.id, trackId },
  });
  if (existingDownload) {
    return ok(res, {
      payment: null,
      result: { status: 'COMPLETED' },
      audioUrl: track.audioUrl,
    });
  }

  // El administrador gestiona la plataforma, no es un usuario de pago-por-uso:
  // tiene acceso completo sin cargo, igual que ya ocurre con la reproducción.
  if (req.user.role === 'ADMIN') {
    await prisma.download.create({ data: { userId: req.user.id, trackId } });
    await prisma.track.update({
      where: { id: trackId },
      data: { downloadCount: { increment: 1 } },
    });
    return ok(res, {
      payment: null,
      result: { status: 'COMPLETED' },
      audioUrl: track.audioUrl,
    });
  }

  if (!PAYMENT_METHODS.includes(method)) return fail(res, `Método de pago inválido: ${method}`);

  const { payment, result } = await processPayment({
    user: req.user,
    amount: business.prices.perDownload,
    method,
    purpose: 'PER_DOWNLOAD',
    trackId,
  });

  if (result.status === 'COMPLETED') {
    await prisma.download.create({ data: { userId: req.user.id, trackId } });
    await prisma.track.update({
      where: { id: trackId },
      data: { downloadCount: { increment: 1 } },
    });
    await creditArtist(track.artistId, payment.artistShare);
  }

  return ok(res, { payment, result, audioUrl: track.audioUrl });
  } catch (e) {
    return fail(res, 'Error al procesar el pago', 500);
  }
}

// Límite mensual de 100.000 FCFA entre recargas y retiros
const MONTHLY_WALLET_LIMIT = 100000;

// Suma de recargas + retiros completados en el mes actual
async function getMonthlyWalletTotal(userId) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const agg = await prisma.payment.aggregate({
    where: {
      userId,
      purpose: { in: ['WALLET_TOPUP', 'WALLET_WITHDRAW'] },
      status: 'COMPLETED',
      createdAt: { gte: start },
    },
    _sum: { amount: true },
  });
  return agg._sum.amount || 0;
}

// POST /api/payments/wallet-topup  body: { amount, method }

async function walletTopup(req, res) {
  const { amount, method } = req.body;
  if (!amount || amount <= 0) return fail(res, 'Monto inválido');
  if (amount < business.minTransferAmount) return fail(res, `El monto mínimo es ${business.minTransferAmount} FCFA`);
  if (amount > MONTHLY_WALLET_LIMIT) return fail(res, `El monto máximo por operación es ${MONTHLY_WALLET_LIMIT} FCFA`);

  // Comprobar límite mensual
  const monthTotal = await getMonthlyWalletTotal(req.user.id);
  if (monthTotal + amount > MONTHLY_WALLET_LIMIT) {
    const remaining = MONTHLY_WALLET_LIMIT - monthTotal;
    return fail(res, `Límite mensual de ${MONTHLY_WALLET_LIMIT} FCFA superado. Puedes añadir ${remaining} FCFA más este mes.`);
  }

  const { payment, result } = await processPayment({
    user: req.user,
    amount,
    method,
    purpose: 'WALLET_TOPUP',
  });

  if (result.status === 'COMPLETED') {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { walletBalance: { increment: amount } },
    });
  }

  return ok(res, { payment, result, monthlyUsed: monthTotal + (result.status === 'COMPLETED' ? amount : 0), monthlyLimit: MONTHLY_WALLET_LIMIT });
}

// POST /api/payments/artist-earnings-withdraw  body: { amount }
// El artista transfiere parte de sus ganancias (totalEarnings) a su monedero interno
async function artistEarningsWithdraw(req, res) {
  if (req.user.role !== 'ARTIST') return fail(res, 'Solo artistas pueden retirar ganancias', 403);
  const { amount } = req.body;
  if (!amount || amount <= 0) return fail(res, 'Monto inválido');
  if (amount < business.minTransferAmount) return fail(res, `El monto mínimo para retirar es ${business.minTransferAmount} FCFA`);

  const profile = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } });
  if (!profile) return fail(res, 'Perfil de artista no encontrado', 404);

  // UPDATE atómico con condición de ganancias suficientes: evita que dos
  // solicitudes de retiro simultáneas dejen totalEarnings en negativo.
  const deducted = await prisma.artistProfile.updateMany({
    where: { id: profile.id, totalEarnings: { gte: amount } },
    data: { totalEarnings: { decrement: amount } },
  });
  if (deducted.count === 0) {
    return fail(res, `Ganancias disponibles insuficientes. Tienes ${profile.totalEarnings} FCFA.`);
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: req.user.id },
      data: { walletBalance: { increment: amount } },
    }),
    prisma.payment.create({
      data: {
        userId: req.user.id,
        amount,
        method: 'WALLET',
        status: 'COMPLETED',
        purpose: 'WALLET_TOPUP',
      },
    }),
  ]);

  const fresh = await prisma.user.findUnique({ where: { id: req.user.id } });
  return ok(res, { walletBalance: fresh.walletBalance, earningsRemaining: profile.totalEarnings - amount });
}

// POST /api/payments/wallet-withdraw  body: { amount, destination? }
// Sistema antiguo para todos los usuarios: retiro libre de su propio saldo,
// sin restricción de destino. Solo para el rol ADMIN aplica la restricción
// nueva: retira fondos de la plataforma, siempre hacia un wallet propio de
// MbôláMusic SARL (destination: 'MOBILE'|'BANK'), nunca a una cuenta personal.
async function walletWithdraw(req, res) {
  const { amount, destination } = req.body;
  if (!amount || amount <= 0) return fail(res, 'Monto inválido');
  if (amount < business.minTransferAmount) return fail(res, `El monto mínimo para retirar es ${business.minTransferAmount} FCFA`);
  if (amount > MONTHLY_WALLET_LIMIT) return fail(res, `El monto máximo por operación es ${MONTHLY_WALLET_LIMIT} FCFA`);

  const isAdmin = req.user.role === 'ADMIN';
  let destAccount = null;
  if (isAdmin) {
    destAccount = business.companyWallets[destination];
    if (!destAccount) {
      return fail(res, `Destino inválido o no configurado: ${destination}. Configura COMPANY_WALLET_PHONE / COMPANY_WALLET_BANK_ACCOUNT en el servidor.`);
    }
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return fail(res, 'Usuario no encontrado', 404);

  const monthTotal = await getMonthlyWalletTotal(req.user.id);
  if (monthTotal + amount > MONTHLY_WALLET_LIMIT) {
    const remaining = MONTHLY_WALLET_LIMIT - monthTotal;
    return fail(res, `Límite mensual de ${MONTHLY_WALLET_LIMIT} FCFA superado. Puedes retirar ${remaining} FCFA más este mes.`);
  }

  // UPDATE atómico con condición de saldo suficiente: evita que dos
  // solicitudes de retiro simultáneas sobregiren el monedero.
  const deducted = await prisma.user.updateMany({
    where: { id: req.user.id, walletBalance: { gte: amount } },
    data: { walletBalance: { decrement: amount } },
  });
  if (deducted.count === 0) return fail(res, 'Saldo insuficiente en el monedero');

  const payment = await prisma.payment.create({
    data: {
      userId: req.user.id,
      amount,
      method: 'WALLET',
      status: 'COMPLETED',
      purpose: 'WALLET_WITHDRAW',
      externalRef: isAdmin ? `SARL:${destination}:${destAccount}` : null,
    },
  });

  return ok(res, {
    payment,
    destination: isAdmin ? destination : undefined,
    destAccount: isAdmin ? destAccount : undefined,
    monthlyUsed: monthTotal + amount,
    monthlyLimit: MONTHLY_WALLET_LIMIT,
  });
}

// POST /api/payments/listener-subscription  body: { method, autoRenew }
// (now also handles the autoRenew flag)
// (already defined above, we patch it via subscriptionService)

// GET /api/subscriptions/current  → estado de suscripción actual
async function currentSubscription(req, res) {
  const sub = await subscriptionService.getActiveSubscription(req.user.id);
  return ok(res, { subscription: sub });
}

// POST /api/subscriptions/cancel  → cancela auto-renovación, deja activa hasta endDate
async function cancelSubscription(req, res) {
  const sub = await prisma.subscription.findFirst({
    where: { userId: req.user.id, status: 'ACTIVE' },
    orderBy: { endDate: 'desc' },
  });
  if (!sub) return fail(res, 'No tienes una suscripción activa');

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { autoRenew: false },
  });

  return ok(res, {
    cancelled: true,
    effectiveDate: sub.endDate,
    message: `Tu suscripción seguirá activa hasta el ${new Date(sub.endDate).toLocaleDateString('es')}, luego se cancelará.`,
  });
}

// POST /api/subscriptions/enable-auto-renew  → activa pago automático desde wallet
async function enableAutoRenew(req, res) {
  const sub = await prisma.subscription.findFirst({
    where: { userId: req.user.id, status: 'ACTIVE' },
    orderBy: { endDate: 'desc' },
  });
  if (!sub) return fail(res, 'No tienes una suscripción activa');

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { autoRenew: true },
  });

  return ok(res, { autoRenew: true });
}

// GET /api/payments  -> historial del usuario
async function listPayments(req, res) {
  const payments = await prisma.payment.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  return ok(res, { payments });
}

// POST /api/payments/webhook/flutterwave  (sin auth — verificado por hash)
async function flutterwaveWebhook(req, res) {
  // Responder 200 inmediatamente para que Flutterwave no reintente
  res.status(200).end();

  try {
    const provider = getProvider();
    if (!provider.verifyWebhook || !provider.parseWebhookEvent) return;
    if (!provider.verifyWebhook(req)) return;

    const event = provider.parseWebhookEvent(req.body);
    if (!event.externalRef) return;

    const payment = await prisma.payment.findFirst({
      where: { externalRef: event.externalRef, status: 'PENDING' },
    });
    if (!payment) return;

    await _finalizePayment(payment, event.status);
  } catch (e) {
    console.error('[webhook:flutterwave]', e.message);
  }
}

// POST /api/payments/:id/confirm  (solo ADMIN — confirma transferencias bancarias)
async function adminConfirmPayment(req, res) {
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return fail(res, 'Pago no encontrado', 404);
  if (payment.status !== 'VERIFYING') {
    return fail(res, `El pago ya está en estado: ${payment.status}`);
  }
  await _finalizePayment(payment, 'COMPLETED');
  return ok(res, { message: 'Pago confirmado' });
}

// POST /api/payments/:id/refund  (solo ADMIN) — devuelve fondos de un WALLET_TOPUP completado
async function adminRefundPayment(req, res) {
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return fail(res, 'Pago no encontrado', 404);
  if (payment.status !== 'COMPLETED') return fail(res, 'Solo se pueden reembolsar pagos completados');
  if (payment.purpose !== 'WALLET_TOPUP') return fail(res, 'Solo se pueden reembolsar recargas de monedero');

  const user = await prisma.user.findUnique({ where: { id: payment.userId } });
  if (!user) return fail(res, 'Usuario no encontrado', 404);

  // UPDATE atómico con condición de saldo suficiente: el usuario pudo haber
  // gastado el saldo entre la comprobación y este punto (ej. otra compra en
  // curso mientras el admin revisaba el pago).
  const deducted = await prisma.user.updateMany({
    where: { id: payment.userId, walletBalance: { gte: payment.amount } },
    data: { walletBalance: { decrement: payment.amount } },
  });
  if (deducted.count === 0) {
    const fresh = await prisma.user.findUnique({ where: { id: payment.userId } });
    return fail(res, `Saldo insuficiente. El usuario tiene ${fresh.walletBalance} FCFA, se intenta reembolsar ${payment.amount} FCFA`);
  }

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED' },
    }),
    prisma.payment.create({
      data: {
        userId: payment.userId,
        amount: payment.amount,
        method: payment.method,
        status: 'COMPLETED',
        purpose: 'WALLET_WITHDRAW',
        completedAt: new Date(),
      },
    }),
  ]);

  notif.create(
    payment.userId,
    'PAYMENT_REJECTED',
    'Reembolso procesado',
    `Se han devuelto ${payment.amount} FCFA de tu monedero por reembolso del pago confirmado anteriormente.`,
  );

  return ok(res, { refunded: true, amount: payment.amount });
}

// POST /api/payments/:id/reject  (solo ADMIN)
async function adminRejectPayment(req, res) {
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return fail(res, 'Pago no encontrado', 404);
  if (!['VERIFYING', 'PENDING'].includes(payment.status)) {
    return fail(res, `El pago ya está en estado: ${payment.status}`);
  }
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'FAILED', completedAt: new Date() },
  });
  return ok(res, { message: 'Pago rechazado' });
}

// ----- helpers -----
async function _finalizePayment(payment, status) {
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status, completedAt: status === 'COMPLETED' ? new Date() : null },
  });

  // Notificar al usuario según resultado
  const label = { COMPLETED: 'confirmado', FAILED: 'rechazado', VERIFYING: 'en verificación' };
  notif.create(
    payment.userId,
    status === 'COMPLETED' ? 'PAYMENT_CONFIRMED' : 'PAYMENT_REJECTED',
    `Pago ${label[status] || status}`,
    `Tu pago de ${payment.amount} FCFA (${payment.purpose}) está ${label[status] || status}.`,
  );

  if (status !== 'COMPLETED') return;

  // Efectos post-pago
  if (payment.purpose === 'ARTIST_SUBSCRIPTION') {
    await subscriptionService.createSubscription(payment.userId, 'ARTIST_MONTHLY');
  } else if (payment.purpose === 'LISTENER_SUBSCRIPTION') {
    await subscriptionService.createSubscription(payment.userId, 'LISTENER_MONTHLY');
  } else if (payment.purpose === 'LISTENER_SUBSCRIPTION_YEARLY') {
    await subscriptionService.createSubscription(payment.userId, 'LISTENER_YEARLY');
  } else if (payment.purpose === 'WALLET_TOPUP') {
    await prisma.user.update({
      where: { id: payment.userId },
      data: { walletBalance: { increment: payment.amount } },
    });
  } else if (payment.purpose === 'PER_PLAY' && payment.trackId) {
    const track = await prisma.track.findUnique({ where: { id: payment.trackId } });
    if (track) {
      await registerPlay(payment.userId, track, false);
      await creditArtist(track.artistId, payment.artistShare);
    }
  } else if (payment.purpose === 'PER_DOWNLOAD' && payment.trackId) {
    await prisma.download.create({
      data: { userId: payment.userId, trackId: payment.trackId },
    });
    await prisma.track.update({
      where: { id: payment.trackId },
      data: { downloadCount: { increment: 1 } },
    });
    const track = await prisma.track.findUnique({ where: { id: payment.trackId } });
    if (track) await creditArtist(track.artistId, payment.artistShare);
  }
}

async function registerPlay(userId, track, bySubscription) {
  const sub = await subscriptionService.getActiveSubscription(userId);
  const subType = sub ? sub.type : null;

  // Prueba gratuita (LISTENER_FREE / ARTIST_FREE) o sin suscripción → no cuenta.
  // Pago directo por reproducción (bySubscription=false) → siempre cuenta.
  const shouldCount =
    !bySubscription ||
    subType === 'LISTENER_MONTHLY' ||
    subType === 'LISTENER_YEARLY' ||
    subType === 'ARTIST_MONTHLY';

  // Auto-reproducciones del propio artista sobre su propia canción: capped en
  // 2.000 FCFA de ganancia, sin importar si su suscripción activa es de tipo
  // ARTIST_MONTHLY o LISTENER_MONTHLY (un artista puede pagar ambas).
  let selfPlayCapExceeded = false;
  if (shouldCount && bySubscription && track.artistId) {
    const artistProfile = await prisma.artistProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (artistProfile && artistProfile.id === track.artistId) {
      const artistPerPlay = Math.round(business.prices.perPlay * business.revenueSplit.artist);
      const maxSelfPlays  = Math.floor(2000 / (artistPerPlay || 1));
      const prevSelfPlays = await prisma.play.count({
        where: {
          userId,
          artistId: artistProfile.id,
          bySubscription: true,
          createdAt: { gte: sub.startDate },
        },
      });
      selfPlayCapExceeded = prevSelfPlays >= maxSelfPlays;
    }
  }

  await prisma.play.create({
    data: { userId, trackId: track.id, artistId: track.artistId ?? null, bySubscription },
  });

  if (shouldCount && !selfPlayCapExceeded) {
    await prisma.track.update({
      where: { id: track.id },
      data: { playCount: { increment: 1 } },
    });
  }
}

async function creditArtist(artistId, amount) {
  if (amount <= 0) return;
  await prisma.artistProfile.update({
    where: { id: artistId },
    data: { totalEarnings: { increment: amount } },
  });
}

module.exports = {
  payArtistSubscription,
  payListenerSubscription,
  payListenerYearlySubscription,
  getListenerYearlyPrice,
  payPerPlay,
  payPerDownload,
  downloadStatus,
  walletTopup,
  walletWithdraw,
  artistEarningsWithdraw,
  listPayments,
  registerPlay,
  flutterwaveWebhook,
  adminConfirmPayment,
  adminRejectPayment,
  adminRefundPayment,
  currentSubscription,
  cancelSubscription,
  enableAutoRenew,
};
