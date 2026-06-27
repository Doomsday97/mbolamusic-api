const business = require('../src/config/business');

describe('Reglas de negocio', () => {
  test('precios correctos en FCFA', () => {
    expect(business.prices.artistMonthly).toBe(10000);
    expect(business.prices.listenerMonthly).toBe(2000);
    expect(business.prices.perPlay).toBe(50);
    expect(business.prices.perDownload).toBe(200);
  });

  test('reparto de ingresos suma 100%', () => {
    const { artist, platform } = business.revenueSplit;
    expect(artist + platform).toBeCloseTo(1);
  });

  test('reparto 70/30', () => {
    expect(business.revenueSplit.artist).toBe(0.7);
    expect(business.revenueSplit.platform).toBe(0.3);
  });

  test('periodo de prueba gratuita = 30 días', () => {
    expect(business.trials.listenerFreeDays).toBe(30);
  });

  test('duración suscripción = 30 días', () => {
    expect(business.subscriptionDurationDays).toBe(30);
  });

  test('reparto correcto en reproducción de 50 FCFA', () => {
    const amount = business.prices.perPlay;
    const artistShare = Math.round(amount * business.revenueSplit.artist);
    const platformShare = amount - artistShare;
    expect(artistShare).toBe(35);
    expect(platformShare).toBe(15);
    expect(artistShare + platformShare).toBe(amount);
  });

  test('reparto correcto en descarga de 200 FCFA', () => {
    const amount = business.prices.perDownload;
    const artistShare = Math.round(amount * business.revenueSplit.artist);
    const platformShare = amount - artistShare;
    expect(artistShare).toBe(140);
    expect(platformShare).toBe(60);
    expect(artistShare + platformShare).toBe(amount);
  });

  test('moneda es FCFA', () => {
    expect(business.currency).toBe('FCFA');
  });

  test('recompensa por referido = 15 días', () => {
    expect(business.referral.rewardDaysForReferrer).toBe(15);
  });
});
