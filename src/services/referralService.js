// Sistema de descuento por referidos: por cada N usuarios nuevos que se
// registran con el código de un referidor Y pagan su primera suscripción
// (mensual o anual, oyente o artista), el referidor gana un crédito de
// descuento (business.referral.discountPercent) para su próxima suscripción.
// Las renovaciones de un mismo referido no vuelven a contar.

const prisma = require('../config/prisma');
const business = require('../config/business');
const notif = require('../controllers/notificationController');

// Vincula al usuario recién registrado con el código de referido usado (si
// existe). Un usuario solo puede tener un signup (campo único), así que
// llamadas repetidas para el mismo usuario no duplican nada.
async function linkSignup(referralCode, referredUserId) {
  if (!referralCode) return;
  const ref = await prisma.referral.findUnique({ where: { code: referralCode } });
  if (!ref) return;
  await prisma.referralSignup.create({
    data: { referralId: ref.id, referrerId: ref.referrerId, referredUserId },
  }).catch(() => {}); // ya vinculado (unique) -> ignorar
}

// Debe llamarse justo después de que un pago de suscripción (oyente o
// artista) llega a COMPLETED. Si este usuario fue referido y es su primera
// suscripción de pago, marca el signup como contado y, al alcanzar cada
// múltiplo de N, otorga un nuevo crédito de descuento al referidor.
async function onFirstPaidSubscription(userId) {
  const signup = await prisma.referralSignup.findUnique({ where: { referredUserId: userId } });
  if (!signup || signup.counted) return;

  await prisma.referralSignup.update({
    where: { id: signup.id },
    data: { counted: true, countedAt: new Date() },
  });

  const countedTotal = await prisma.referralSignup.count({
    where: { referrerId: signup.referrerId, counted: true },
  });

  if (countedTotal > 0 && countedTotal % business.referral.requiredPayingReferrals === 0) {
    await prisma.referralDiscountCredit.create({ data: { userId: signup.referrerId } });
    await notif.create(
      signup.referrerId,
      'REFERRAL_DISCOUNT',
      '¡Descuento ganado!',
      `Alcanzaste ${countedTotal} referidos con suscripción paga. Tienes un ${Math.round(business.referral.discountPercent * 100)}% de descuento disponible para tu próxima suscripción.`,
    );
  }
}

// Busca un crédito de descuento disponible (no usado y no reservado por otro
// pago en curso) para este usuario. Devuelve el crédito o null.
async function findAvailableCredit(userId) {
  const credits = await prisma.referralDiscountCredit.findMany({
    where: { userId, usedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  for (const credit of credits) {
    const reserved = await prisma.payment.findFirst({
      where: { discountCreditId: credit.id, status: { in: ['PENDING', 'VERIFYING', 'COMPLETED'] } },
    });
    if (!reserved) return credit;
  }
  return null;
}

// Aplica (si hay uno disponible) el descuento al monto y devuelve tanto el
// monto final como el crédito reservado (o null si no había ninguno).
async function applyDiscount(userId, amount) {
  const credit = await findAvailableCredit(userId);
  if (!credit) return { amount, credit: null };
  const discounted = Math.round(amount * (1 - business.referral.discountPercent));
  return { amount: discounted, credit };
}

async function consumeCredit(creditId) {
  await prisma.referralDiscountCredit.update({
    where: { id: creditId },
    data: { usedAt: new Date() },
  });
}

module.exports = {
  linkSignup,
  onFirstPaidSubscription,
  findAvailableCredit,
  applyDiscount,
  consumeCredit,
};
