// Lógica de suscripciones: crear, comprobar vigencia y aplicar efectos
// (como ocultar/mostrar la música del artista).

const prisma = require('../config/prisma');
const business = require('../config/business');
const { addDays, isExpired } = require('../utils/dates');

// Devuelve la suscripción activa del usuario (o null)
async function getActiveSubscription(userId) {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: 'ACTIVE' },
    orderBy: { endDate: 'desc' },
  });
  if (!sub) return null;
  if (isExpired(sub.endDate)) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'EXPIRED' },
    });
    await applySubscriptionEffects(userId);
    return null;
  }
  return sub;
}

// Crea (o renueva) una suscripción
async function createSubscription(userId, type) {
  const days = type === 'LISTENER_FREE'
    ? business.trials.listenerFreeDays
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

// Efecto clave: si el artista NO tiene suscripción activa, su música se oculta.
// Si la recupera, vuelve a publicarse.
async function applySubscriptionEffects(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { artistProfile: true },
  });
  if (!user || user.role !== 'ARTIST' || !user.artistProfile) return;

  const active = await prisma.subscription.findFirst({
    where: { userId, status: 'ACTIVE' },
    orderBy: { endDate: 'desc' },
  });
  const hasActive = active && !isExpired(active.endDate);

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

module.exports = {
  getActiveSubscription,
  createSubscription,
  applySubscriptionEffects,
  listenerHasAccess,
};
