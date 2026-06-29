const prisma = require('../config/prisma');
const business = require('../config/business');
const { ok, fail } = require('../utils/response');
const { getProvider } = require('../services/payment');
const subscriptionService = require('../services/subscriptionService');
const notif = require('./notificationController');

// Crea un registro de pago y lo procesa con el proveedor activo
async function processPayment({ user, amount, method, purpose, trackId = null }) {
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

// POST /api/payments/per-play   body: { trackId, method }
async function payPerPlay(req, res) {
  const { trackId, method } = req.body;
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
}

// POST /api/payments/per-download   body: { trackId, method }
async function payPerDownload(req, res) {
  const { trackId, method } = req.body;
  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track) return fail(res, 'Canción no encontrada', 404);

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

  const profile = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } });
  if (!profile) return fail(res, 'Perfil de artista no encontrado', 404);
  if (profile.totalEarnings < amount) return fail(res, `Ganancias disponibles insuficientes. Tienes ${profile.totalEarnings} FCFA.`);

  await prisma.$transaction([
    prisma.artistProfile.update({
      where: { id: profile.id },
      data: { totalEarnings: { decrement: amount } },
    }),
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

// POST /api/payments/wallet-withdraw  body: { amount }
async function walletWithdraw(req, res) {
  const { amount } = req.body;
  if (!amount || amount <= 0) return fail(res, 'Monto inválido');
  if (amount > MONTHLY_WALLET_LIMIT) return fail(res, `El monto máximo por operación es ${MONTHLY_WALLET_LIMIT} FCFA`);

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || user.walletBalance < amount) return fail(res, 'Saldo insuficiente en el monedero');

  const monthTotal = await getMonthlyWalletTotal(req.user.id);
  if (monthTotal + amount > MONTHLY_WALLET_LIMIT) {
    const remaining = MONTHLY_WALLET_LIMIT - monthTotal;
    return fail(res, `Límite mensual de ${MONTHLY_WALLET_LIMIT} FCFA superado. Puedes retirar ${remaining} FCFA más este mes.`);
  }

  const payment = await prisma.payment.create({
    data: {
      userId: req.user.id,
      amount,
      method: 'WALLET',
      status: 'COMPLETED',
      purpose: 'WALLET_WITHDRAW',
    },
  });

  await prisma.user.update({
    where: { id: req.user.id },
    data: { walletBalance: { decrement: amount } },
  });

  return ok(res, { payment, monthlyUsed: monthTotal + amount, monthlyLimit: MONTHLY_WALLET_LIMIT });
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
  if (user.walletBalance < payment.amount) {
    return fail(res, `Saldo insuficiente. El usuario tiene ${user.walletBalance} FCFA, se intenta reembolsar ${payment.amount} FCFA`);
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: payment.userId },
      data: { walletBalance: { decrement: payment.amount } },
    }),
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
  await prisma.play.create({
    data: { userId, trackId: track.id, artistId: track.artistId ?? null, bySubscription },
  });
  await prisma.track.update({
    where: { id: track.id },
    data: { playCount: { increment: 1 } },
  });
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
  payPerPlay,
  payPerDownload,
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
