// Tests for referralService – validates the "50% off after 5 paying
// referrals" logic without a real DB (Prisma client fully mocked, same
// pattern as chat.test.js).

jest.mock('@prisma/client', () => {
  const state = {
    referrals: [],
    signups: [],
    credits: [],
    payments: [], // { id, discountCreditId, status }
  };
  const PrismaClient = jest.fn().mockImplementation(() => ({
    referral: {
      findUnique: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(state.referrals.find((r) => r.code === where.code) || null)),
    },
    referralSignup: {
      create: jest.fn().mockImplementation(({ data }) => {
        if (state.signups.some((s) => s.referredUserId === data.referredUserId)) {
          throw new Error('Unique constraint failed');
        }
        const row = { id: `signup-${state.signups.length + 1}`, counted: false, countedAt: null, ...data };
        state.signups.push(row);
        return Promise.resolve(row);
      }),
      findUnique: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(state.signups.find((s) => s.referredUserId === where.referredUserId) || null)),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const row = state.signups.find((s) => s.id === where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
      count: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(state.signups.filter((s) =>
          s.referrerId === where.referrerId && (where.counted === undefined || s.counted === where.counted)).length)),
    },
    referralDiscountCredit: {
      create: jest.fn().mockImplementation(({ data }) => {
        const row = { id: `credit-${state.credits.length + 1}`, usedAt: null, createdAt: new Date(), ...data };
        state.credits.push(row);
        return Promise.resolve(row);
      }),
      findMany: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(state.credits.filter((c) => c.userId === where.userId && c.usedAt === where.usedAt))),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const row = state.credits.find((c) => c.id === where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
      count: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(state.credits.filter((c) => c.userId === where.userId && c.usedAt === where.usedAt).length)),
    },
    payment: {
      findFirst: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(state.payments.find((p) =>
          p.discountCreditId === where.discountCreditId && where.status.in.includes(p.status)) || null)),
    },
    __state: state,
  }));
  return { PrismaClient };
});

jest.mock('../src/controllers/notificationController', () => ({
  create: jest.fn().mockResolvedValue({}),
}));

const prisma = require('../src/config/prisma');
const referralService = require('../src/services/referralService');

describe('referralService', () => {
  beforeEach(() => {
    prisma.__state.referrals.length = 0;
    prisma.__state.signups.length = 0;
    prisma.__state.credits.length = 0;
    prisma.__state.payments.length = 0;
    prisma.__state.referrals.push({ id: 'ref-1', code: 'ABCD1234', referrerId: 'referrer-1' });
  });

  test('linkSignup crea un ReferralSignup vinculado al código', async () => {
    await referralService.linkSignup('ABCD1234', 'user-1');
    expect(prisma.__state.signups).toHaveLength(1);
    expect(prisma.__state.signups[0]).toMatchObject({
      referralId: 'ref-1', referrerId: 'referrer-1', referredUserId: 'user-1', counted: false,
    });
  });

  test('linkSignup con código inexistente no crea nada', async () => {
    await referralService.linkSignup('NOEXISTE', 'user-1');
    expect(prisma.__state.signups).toHaveLength(0);
  });

  test('onFirstPaidSubscription marca el signup como contado una sola vez', async () => {
    await referralService.linkSignup('ABCD1234', 'user-1');
    await referralService.onFirstPaidSubscription('user-1');
    expect(prisma.__state.signups[0].counted).toBe(true);

    // Una segunda suscripción de pago del mismo usuario no debe recontarse
    const countedAtFirst = prisma.__state.signups[0].countedAt;
    await referralService.onFirstPaidSubscription('user-1');
    expect(prisma.__state.signups[0].countedAt).toBe(countedAtFirst);
  });

  test('no otorga crédito hasta llegar al 5º referido pago', async () => {
    for (let i = 1; i <= 4; i++) {
      await referralService.linkSignup('ABCD1234', `user-${i}`);
      await referralService.onFirstPaidSubscription(`user-${i}`);
    }
    expect(prisma.__state.credits).toHaveLength(0);
  });

  test('otorga un crédito de 50% al alcanzar el 5º referido pago', async () => {
    for (let i = 1; i <= 5; i++) {
      await referralService.linkSignup('ABCD1234', `user-${i}`);
      await referralService.onFirstPaidSubscription(`user-${i}`);
    }
    expect(prisma.__state.credits).toHaveLength(1);
    expect(prisma.__state.credits[0].userId).toBe('referrer-1');
  });

  test('otorga un segundo crédito al llegar al 10º referido pago', async () => {
    for (let i = 1; i <= 10; i++) {
      await referralService.linkSignup('ABCD1234', `user-${i}`);
      await referralService.onFirstPaidSubscription(`user-${i}`);
    }
    expect(prisma.__state.credits).toHaveLength(2);
  });

  test('applyDiscount aplica 50% si hay un crédito disponible', async () => {
    prisma.__state.credits.push({ id: 'credit-1', userId: 'referrer-1', usedAt: null, createdAt: new Date() });
    const { amount, credit } = await referralService.applyDiscount('referrer-1', 2000);
    expect(amount).toBe(1000);
    expect(credit.id).toBe('credit-1');
  });

  test('applyDiscount no descuenta si no hay crédito disponible', async () => {
    const { amount, credit } = await referralService.applyDiscount('referrer-1', 2000);
    expect(amount).toBe(2000);
    expect(credit).toBeNull();
  });

  test('consumeCredit marca el crédito como usado', async () => {
    prisma.__state.credits.push({ id: 'credit-1', userId: 'referrer-1', usedAt: null, createdAt: new Date() });
    await referralService.consumeCredit('credit-1');
    expect(prisma.__state.credits[0].usedAt).not.toBeNull();
  });

  test('un crédito reservado por un pago PENDING/VERIFYING/COMPLETED no está disponible', async () => {
    prisma.__state.credits.push({ id: 'credit-1', userId: 'referrer-1', usedAt: null, createdAt: new Date() });
    prisma.__state.payments.push({ id: 'pay-1', discountCreditId: 'credit-1', status: 'VERIFYING' });
    const { amount, credit } = await referralService.applyDiscount('referrer-1', 2000);
    expect(amount).toBe(2000);
    expect(credit).toBeNull();
  });

  test('un crédito reservado solo por un pago FAILED vuelve a estar disponible', async () => {
    prisma.__state.credits.push({ id: 'credit-1', userId: 'referrer-1', usedAt: null, createdAt: new Date() });
    prisma.__state.payments.push({ id: 'pay-1', discountCreditId: 'credit-1', status: 'FAILED' });
    const { amount, credit } = await referralService.applyDiscount('referrer-1', 2000);
    expect(amount).toBe(1000);
    expect(credit.id).toBe('credit-1');
  });
});
