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
    ? business.prices.artistMonthly
    : expiredSub.type === 'LISTENER_YEARLY'
      ? business.prices.listenerYearly // la renovación nunca lleva el descuento de primera vez
      : business.prices.listenerMonthly; // LISTENER_MONTHLY

  // UPDATE atómico con condición de saldo suficiente: evita que una
  // renovación automática superpuesta (ej. el cron de expiración se solapa
  // con otra ejecución) descuente dos veces y deje el wallet en negativo.
  const deducted = await prisma.user.updateMany({
    where: { id: userId, walletBalance: { gte: cost } },
    data: { walletBalance: { decrement: cost } },
  });
  if (deducted.count === 0) return null;

  await prisma.subscription.update({
    where: { id: expiredSub.id },
    data: { status: 'EXPIRED' },
  });

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
      : type === 'LISTENER_YEARLY'
        ? business.subscriptionDurationDaysYearly
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

// Devuelve la suscripción de OYENTE activa y vigente del usuario (mensual,
// anual o prueba gratis), o null. A diferencia de
// listenerHasAccess/getActiveSubscription -- que no filtran por tipo y
// podrían confundirse con una suscripción de ARTISTA -- esta se usa para
// gatear beneficios exclusivos de oyente, como las descargas gratis
// incluidas en la suscripción (y para distinguir prueba gratis de pago,
// que tienen topes distintos).
async function getActiveListenerSubscription(userId) {
  const subs = await prisma.subscription.findMany({
    where: { userId, status: 'ACTIVE', type: { in: ['LISTENER_MONTHLY', 'LISTENER_YEARLY', 'LISTENER_FREE'] } },
    orderBy: { endDate: 'desc' },
  });
  const valid = subs.filter((s) => !isExpired(s.endDate));
  if (valid.length === 0) return null;
  // Si por alguna razón el usuario tiene la prueba gratis Y un plan de pago
  // activos a la vez (ej. se suscribió sin que la prueba hubiese expirado
  // antes), el plan de pago siempre prevalece para efectos de topes/beneficios.
  return valid.find((s) => s.type !== 'LISTENER_FREE') || valid[0];
}

async function hasActiveListenerSubscription(userId) {
  return !!(await getActiveListenerSubscription(userId));
}

// ¿Tiene el oyente una suscripción de PAGO (mensual o anual) activa y
// vigente? A diferencia de hasActiveListenerSubscription, esto EXCLUYE la
// prueba gratis: se usa para bloquear un nuevo pago mientras ya hay uno
// pagado vigente (debe esperar a que venza o activar autoRenew), sin
// impedir que quien está en la prueba gratis pueda suscribirse.
async function hasActivePaidListenerSubscription(userId) {
  const subs = await prisma.subscription.findMany({
    where: { userId, status: 'ACTIVE', type: { in: ['LISTENER_MONTHLY', 'LISTENER_YEARLY'] } },
  });
  return subs.some((s) => !isExpired(s.endDate));
}

// ¿Tiene el artista una suscripción de PAGO (mensual) activa y vigente?
// (excluye ARTIST_FREE, mismo motivo que arriba)
async function hasActivePaidArtistSubscription(userId) {
  const subs = await prisma.subscription.findMany({
    where: { userId, status: 'ACTIVE', type: 'ARTIST_MONTHLY' },
  });
  return subs.some((s) => !isExpired(s.endDate));
}

// ¿Ya tuvo el oyente alguna vez una suscripción anual (activa, expirada o cancelada)?
// Determina si le corresponde el precio de primera vez (10.000 FCFA) o el precio normal (12.000 FCFA).
async function hasEverHadYearlySubscription(userId) {
  const count = await prisma.subscription.count({
    where: { userId, type: 'LISTENER_YEARLY' },
  });
  return count > 0;
}

// Precio que le corresponde a este oyente por la suscripción anual ahora mismo.
async function listenerYearlyPrice(userId) {
  const hadBefore = await hasEverHadYearlySubscription(userId);
  return {
    amount: hadBefore ? business.prices.listenerYearly : business.prices.listenerYearlyFirstTime,
    isFirstTime: !hadBefore,
  };
}

module.exports = {
  getActiveSubscription,
  createSubscription,
  applySubscriptionEffects,
  listenerHasAccess,
  hasActiveArtistSubscription,
  hasActiveListenerSubscription,
  hasActivePaidListenerSubscription,
  hasActivePaidArtistSubscription,
  getActiveListenerSubscription,
  hasEverHadYearlySubscription,
  listenerYearlyPrice,
  tryAutoRenew,
};
