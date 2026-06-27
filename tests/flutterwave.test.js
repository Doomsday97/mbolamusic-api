// Tests del proveedor Flutterwave (sin llamadas de red reales)
const flw = require('../src/services/payment/flutterwaveProvider');

describe('Flutterwave provider', () => {
  test('lanza error si falta FLW_SECRET_KEY (SIM_BALANCE)', async () => {
    delete process.env.FLW_SECRET_KEY;
    await expect(
      flw.charge({ amount: 2000, method: 'SIM_BALANCE', userId: 'u1', purpose: 'LISTENER_SUBSCRIPTION' })
    ).rejects.toThrow('FLW_SECRET_KEY');
  });

  test('lanza error si falta FLW_SECRET_KEY (CARD)', async () => {
    delete process.env.FLW_SECRET_KEY;
    await expect(
      flw.charge({ amount: 10000, method: 'CARD', userId: 'u1', purpose: 'ARTIST_SUBSCRIPTION' })
    ).rejects.toThrow('FLW_SECRET_KEY');
  });

  test('BANK_TRANSFER devuelve VERIFYING sin llamar a la API', async () => {
    // No necesita clave — transfiere directamente
    const result = await flw.charge({
      amount: 2000,
      method: 'BANK_TRANSFER',
      userId: 'u1',
      purpose: 'LISTENER_SUBSCRIPTION',
    });
    expect(result.status).toBe('VERIFYING');
    expect(result.bankDetails).toBeDefined();
    expect(result.bankDetails.currency).toBe('XAF');
  });

  describe('verifyWebhook()', () => {
    test('devuelve false si no hay hash configurado', () => {
      delete process.env.FLW_WEBHOOK_HASH;
      const req = { headers: { 'verif-hash': 'algo' } };
      expect(flw.verifyWebhook(req)).toBe(false);
    });

    test('devuelve false si el hash no coincide', () => {
      process.env.FLW_WEBHOOK_HASH = 'secreto-correcto';
      const req = { headers: { 'verif-hash': 'hash-incorrecto' } };
      expect(flw.verifyWebhook(req)).toBe(false);
    });

    test('devuelve true si el hash coincide', () => {
      process.env.FLW_WEBHOOK_HASH = 'mi-hash';
      const req = { headers: { 'verif-hash': 'mi-hash' } };
      expect(flw.verifyWebhook(req)).toBe(true);
    });
  });

  describe('parseWebhookEvent()', () => {
    test('parsea evento successful como COMPLETED', () => {
      const body = { data: { id: 123, tx_ref: 'mbola-1-user1', status: 'successful' } };
      const event = flw.parseWebhookEvent(body);
      expect(event.status).toBe('COMPLETED');
      expect(event.externalRef).toBe('123');
      expect(event.txRef).toBe('mbola-1-user1');
    });

    test('parsea evento failed como FAILED', () => {
      const body = { data: { id: 456, tx_ref: 'mbola-2-user2', status: 'failed' } };
      const event = flw.parseWebhookEvent(body);
      expect(event.status).toBe('FAILED');
    });

    test('maneja body sin data', () => {
      const event = flw.parseWebhookEvent({});
      expect(event.externalRef).toBeNull();
      expect(event.txRef).toBeNull();
    });
  });
});
