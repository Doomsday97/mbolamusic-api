// Lógica de suscripciones: crear, comprobar vigencia y aplicar efectos
// (como ocultar/mostrar la música del artista).

const prisma = require('../config/prisma');
const business = require('../config/business');
const { addDays, isExpired } = require('../utils/dates');

// Devuelve la suscripción activa del usuario (o null).
// Si está expirada con autoRenew=true, intenta renovarla desde el wallet.
async function getActiveSubscription(userId) {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: 'ACTIVE' },
    orderBy: { endDate: 'desc' },
  });
  if (!sub) return null;

  if (!isExpired(sub.endDate)) return sub;

  // Suscripción expirada: intentar auto-renovación si está activada
  if (sub.autoRenew) {
    const renewed = await tryAutoRenew(userId, sub);
    if (renewed) return renewed;
  }

  // Sin auto-renovación o wallet insuficiente → marcar como expirada
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: 'EXPIRED' },
  });
  await applySubscriptionEffects(userId);
  return null;
}

// Intenta renovar una suscripción de oyente desde el wallet interno.
// Devuelve la nueva suscripción, o null si no hay saldo suficiente.
async function tryAutoRenew(userId, expiredSub) {
  // Los periodos gratuitos no se auto-renuevan
  if (expiredSub.type === 'ARTIST_FREE' || expiredSub.type === 'LISTENER_FREE') return null;
  const cost = expiredSub.type === 'ARTIST_MONTHLY'
    ? 10000
    : 2000; // LISTENER_MONTHLY

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { walletBalance: true } });
  if (!user || user.walletBalance < cost) return null;

  // Descontar del wallet y crear nueva suscripción en una transacción
  const [, newSub] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { walletBalance: { decrement: cost } },
    }),
    prisma.subscription.update({
      where: { id: expiredSub.id },
      data: { status: 'EXPIRED' },
    }),
  ]);

  const createdSub = await createSubscription(userId, expiredSub.type);
  // Heredar la preferencia de autoRenew
  await prisma.subscription.update({
    where: { id: createdSub.id },
    data: { autoRenew: true },
  });

  // Registrar el pago automático
  await prisma.payment.create({
    data: {
      userId,
      amount: cost,
      method: 'WALLET',
      status: 'COMPLETED',
      purpose: expiredSub.type === 'ARTIST_MONTHLY' ? 'ARTIST_SUBSCRIPTION' : 'LISTENER_SUBSCRIPTION',
      completedAt: new Date(),
    },
  });

  return createdSub;
}

// Crea (o renueva) una suscripción
async function createSubscription(userId, type) {
  const days = type === 'LISTENER_FREE'
    ? business.trials.listenerFreeDays
    : type === 'ARTIST_FREE'
      ? business.trials.artistFreeDays
      : business.subscriptionDurationDays;

  const sub = await prisma.subscription.create({
    data: {
      userId,
      type,
      status: 'ACTIVE',
      startDate: new Date(),
      endDate: addDays(new Date(), days),
    },
  });

  await applySubscriptionEffects(userId);
  return sub;
}

// Efecto clave: si el artista NO tiene suscripción de ARTISTA activa, su música
// se oculta (una suscripción de oyente en paralelo no cuenta). Si la recupera,
// vuelve a publicarse.
async function applySubscriptionEffects(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { artistProfile: true },
  });
  if (!user || user.role !== 'ARTIST' || !user.artistProfile) return;

  const hasActive = await hasActiveArtistSubscription(userId);

  await prisma.track.updateMany({
    where: { artistId: user.artistProfile.id },
    data: { isPublished: !!hasActive },
  });
}

// ¿Puede el oyente escuchar sin pagar por reproducción? (tiene suscripción activa)
async function listenerHasAccess(userId) {
  const sub = await getActiveSubscription(userId);
  return !!sub;
}

// ¿Tiene el usuario una suscripción de ARTISTA activa y vigente?
// (Un artista puede tener también una suscripción de oyente activa en paralelo;
// getActiveSubscription() solo devuelve UNA, la de vencimiento más lejano, así
// que no sirve para esta comprobación específica.)
async function hasActiveArtistSubscription(userId) {
  const subs = await prisma.subscription.findMany({
    where: { userId, status: 'ACTIVE', type: { in: ['ARTIST_MONTHLY', 'ARTIST_FREE'] } },
  });
  return subs.some((s) => !isExpired(s.endDate));
}

module.exports = {
  getActiveSubscription,
  createSubscription,
  applySubscriptionEffects,
  listenerHasAccess,
  hasActiveArtistSubscription,
  tryAutoRenew,
};
