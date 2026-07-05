// Tests for getActiveArtistSubscription / getActiveListenerSubscription –
// validan que un usuario con AMBAS suscripciones activas a la vez (artista
// que también paga como oyente, o viceversa) obtiene la suscripción
// correcta para cada contexto, sin importar cuál vence más tarde. Bug real
// encontrado: getActiveSubscription() (sin filtro de tipo) devolvía la
// suscripción de OYENTE de un artista en vez de la de ARTISTA porque tenía
// un vencimiento más lejano.

jest.mock('@prisma/client', () => {
  const state = { subscriptions: [] };
  const PrismaClient = jest.fn().mockImplementation(() => ({
    subscription: {
      findMany: jest.fn().mockImplementation(({ where, orderBy }) => {
        const typeMatch = (t) =>
          typeof where.type === 'string' ? t === where.type : where.type.in.includes(t);
        let rows = state.subscriptions.filter((s) =>
          s.userId === where.userId && s.status === where.status && typeMatch(s.type));
        if (orderBy && orderBy.endDate === 'desc') {
          rows = [...rows].sort((a, b) => new Date(b.endDate) - new Date(a.endDate));
        }
        return Promise.resolve(rows);
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

describe('suscripción cruzada artista/oyente (caso real: Malabo)', () => {
  beforeEach(() => {
    prisma.__state.subscriptions.length = 0;
  });

  test('artista con suscripción de OYENTE de vencimiento más lejano -> getActiveArtistSubscription ignora la de oyente', async () => {
    prisma.__state.subscriptions.push(
      { userId: 'malabo', status: 'ACTIVE', type: 'ARTIST_FREE', endDate: futureDate(5) },
      { userId: 'malabo', status: 'ACTIVE', type: 'LISTENER_MONTHLY', endDate: futureDate(30) },
    );
    const sub = await subscriptionService.getActiveArtistSubscription('malabo');
    expect(sub).not.toBeNull();
    expect(sub.type).toBe('ARTIST_FREE');
  });

  test('el mismo artista con getActiveListenerSubscription obtiene su plan de oyente', async () => {
    prisma.__state.subscriptions.push(
      { userId: 'malabo', status: 'ACTIVE', type: 'ARTIST_FREE', endDate: futureDate(5) },
      { userId: 'malabo', status: 'ACTIVE', type: 'LISTENER_MONTHLY', endDate: futureDate(30) },
    );
    const sub = await subscriptionService.getActiveListenerSubscription('malabo');
    expect(sub).not.toBeNull();
    expect(sub.type).toBe('LISTENER_MONTHLY');
  });

  test('artista con plan de pago Y prueba gratis activos -> prevalece el de pago', async () => {
    prisma.__state.subscriptions.push(
      { userId: 'a1', status: 'ACTIVE', type: 'ARTIST_FREE', endDate: futureDate(20) },
      { userId: 'a1', status: 'ACTIVE', type: 'ARTIST_MONTHLY', endDate: futureDate(10) },
    );
    const sub = await subscriptionService.getActiveArtistSubscription('a1');
    expect(sub.type).toBe('ARTIST_MONTHLY');
  });

  test('artista sin ninguna suscripción de artista activa -> null (aunque tenga una de oyente)', async () => {
    prisma.__state.subscriptions.push(
      { userId: 'a2', status: 'ACTIVE', type: 'LISTENER_MONTHLY', endDate: futureDate(30) },
    );
    const sub = await subscriptionService.getActiveArtistSubscription('a2');
    expect(sub).toBeNull();
  });

  test('suscripción de artista expirada no cuenta', async () => {
    prisma.__state.subscriptions.push(
      { userId: 'a3', status: 'ACTIVE', type: 'ARTIST_FREE', endDate: futureDate(-1) },
    );
    const sub = await subscriptionService.getActiveArtistSubscription('a3');
    expect(sub).toBeNull();
  });
});
