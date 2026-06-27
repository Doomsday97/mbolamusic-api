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

// POST /api/payments/listener-subscription
async function payListenerSubscription(req, res) {
  const { method } = req.body;
  const { payment, result } = await processPayment({
    user: req.user,
    amount: business.prices.listenerMonthly,
    method,
    purpose: 'LISTENER_SUBSCRIPTION',
  });

  if (result.status === 'COMPLETED') {
    await subscriptionService.createSubscription(req.user.id, 'LISTENER_MONTHLY');
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

// POST /api/payments/wallet-topup  body: { amount, method }
async function walletTopup(req, res) {
  const { amount, method } = req.body;
  if (!amount || amount <= 0) return fail(res, 'Monto inválido');

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

  return ok(res, { payment, result });
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
  await prisma.play.create({ data: { userId, trackId: track.id, bySubscription } });
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
  listPayments,
  registerPlay,
  flutterwaveWebhook,
  adminConfirmPayment,
  adminRejectPayment,
};
