// Tests for hasActivePaidListenerSubscription / hasActivePaidArtistSubscription
// – validan que la prueba gratis NO bloquee el pago, pero un plan de pago
// vigente sí (sin DB real, mismo patrón que chat.test.js).

jest.mock('@prisma/client', () => {
  const state = { subscriptions: [] };
  const PrismaClient = jest.fn().mockImplementation(() => ({
    subscription: {
      findMany: jest.fn().mockImplementation(({ where }) => {
        const typeMatch = (t) =>
          typeof where.type === 'string' ? t === where.type : where.type.in.includes(t);
        return Promise.resolve(state.subscriptions.filter((s) =>
          s.userId === where.userId && s.status === where.status && typeMatch(s.type)));
      }),
    },
    __state: state,
  }));
  return { PrismaClient };
});

const prisma = require('../src/config/prisma');
const subscriptionService = require('../src/services/subscriptionService');

function futureDate(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

describe('bloqueo de pago con suscripción ya activa', () => {
  beforeEach(() => {
    prisma.__state.subscriptions.length = 0;
  });

  test('oyente solo con prueba gratis activa -> NO bloqueado', async () => {
    prisma.__state.subscriptions.push({
      userId: 'u1', status: 'ACTIVE', type: 'LISTENER_FREE', endDate: futureDate(10),
    });
    expect(await subscriptionService.hasActivePaidListenerSubscription('u1')).toBe(false);
  });

  test('oyente con plan mensual de pago vigente -> bloqueado', async () => {
    prisma.__state.subscriptions.push({
      userId: 'u1', status: 'ACTIVE', type: 'LISTENER_MONTHLY', endDate: futureDate(10),
    });
    expect(await subscriptionService.hasActivePaidListenerSubscription('u1')).toBe(true);
  });

  test('oyente con plan anual de pago vigente -> bloqueado', async () => {
    prisma.__state.subscriptions.push({
      userId: 'u1', status: 'ACTIVE', type: 'LISTENER_YEARLY', endDate: futureDate(300),
    });
    expect(await subscriptionService.hasActivePaidListenerSubscription('u1')).toBe(true);
  });

  test('oyente con plan de pago YA vencido (endDate pasado) -> NO bloqueado', async () => {
    prisma.__state.subscriptions.push({
      userId: 'u1', status: 'ACTIVE', type: 'LISTENER_MONTHLY', endDate: futureDate(-1),
    });
    expect(await subscriptionService.hasActivePaidListenerSubscription('u1')).toBe(false);
  });

  test('artista solo con prueba gratis activa -> NO bloqueado', async () => {
    prisma.__state.subscriptions.push({
      userId: 'a1', status: 'ACTIVE', type: 'ARTIST_FREE', endDate: futureDate(10),
    });
    expect(await subscriptionService.hasActivePaidArtistSubscription('a1')).toBe(false);
  });

  test('artista con plan mensual de pago vigente -> bloqueado', async () => {
    prisma.__state.subscriptions.push({
      userId: 'a1', status: 'ACTIVE', type: 'ARTIST_MONTHLY', endDate: futureDate(10),
    });
    expect(await subscriptionService.hasActivePaidArtistSubscription('a1')).toBe(true);
  });
});
