const { addDays, isExpired } = require('../src/utils/dates');

describe('Utilidades de fecha', () => {
  test('addDays suma correctamente', () => {
    const base = new Date('2024-01-01T00:00:00Z');
    const result = addDays(base, 30);
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0);  // enero (0-indexed) — 1 ene + 30 días = 31 ene
    expect(result.getDate()).toBe(31);
  });

  test('addDays no muta la fecha original', () => {
    const base = new Date('2024-01-01T00:00:00Z');
    addDays(base, 10);
    expect(base.getDate()).toBe(1);
  });

  test('isExpired detecta fecha pasada', () => {
    const past = new Date(Date.now() - 1000);
    expect(isExpired(past)).toBe(true);
  });

  test('isExpired detecta fecha futura', () => {
    const future = new Date(Date.now() + 60000);
    expect(isExpired(future)).toBe(false);
  });

  test('isExpired acepta string de fecha', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isExpired(past)).toBe(true);
  });
});
