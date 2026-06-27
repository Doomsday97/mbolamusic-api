const mockProvider = require('../src/services/payment/mockProvider');

describe('Proveedor de pago simulado', () => {
  test('pago SIM_BALANCE se completa instantáneamente', async () => {
    const result = await mockProvider.charge({
      amount: 2000,
      method: 'SIM_BALANCE',
      userId: 'user-1',
      purpose: 'LISTENER_SUBSCRIPTION',
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.externalRef).toMatch(/^MOCK-/);
  });

  test('pago CARD se completa instantáneamente', async () => {
    const result = await mockProvider.charge({
      amount: 10000,
      method: 'CARD',
      userId: 'user-1',
      purpose: 'ARTIST_SUBSCRIPTION',
    });
    expect(result.status).toBe('COMPLETED');
  });

  test('pago BANK_TRANSFER queda en VERIFYING', async () => {
    const result = await mockProvider.charge({
      amount: 2000,
      method: 'BANK_TRANSFER',
      userId: 'user-1',
      purpose: 'LISTENER_SUBSCRIPTION',
    });
    expect(result.status).toBe('VERIFYING');
    expect(result.bankDetails).toBeDefined();
    expect(result.bankDetails.amount).toBe(2000);
  });

  test('monto 0 retorna FAILED', async () => {
    const result = await mockProvider.charge({
      amount: 0,
      method: 'SIM_BALANCE',
      userId: 'user-1',
      purpose: 'PER_PLAY',
    });
    expect(result.status).toBe('FAILED');
  });

  test('monto negativo retorna FAILED', async () => {
    const result = await mockProvider.charge({
      amount: -50,
      method: 'SIM_BALANCE',
      userId: 'user-1',
      purpose: 'PER_PLAY',
    });
    expect(result.status).toBe('FAILED');
  });
});
