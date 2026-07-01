// Conversión FCFA → EUR/USD para mostrar un valor de referencia al pagar.
// El FCFA (XAF) está fijado por tratado a 655.957 por EUR (BEAC/BCEAO), así que
// la conversión a euros es exacta. El dólar se deriva de la tasa EUR/USD, que
// se refresca periódicamente desde una API pública gratuita (sin clave).

const FCFA_PER_EUR = 655.957;
const FALLBACK_EUR_TO_USD = 1.08; // se usa si la API externa no responde
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

let cache = { eurToUsd: FALLBACK_EUR_TO_USD, updatedAt: 0 };

async function getEurToUsd() {
  const now = Date.now();
  if (now - cache.updatedAt < CACHE_TTL_MS) return cache.eurToUsd;

  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=EUR&to=USD', {
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json();
    const rate = json?.rates?.USD;
    if (typeof rate === 'number' && rate > 0) {
      cache = { eurToUsd: rate, updatedAt: now };
    }
  } catch (_) {
    // Sin conexión o API caída: se mantiene la última tasa conocida (o el fallback)
  }
  return cache.eurToUsd;
}

async function getRates() {
  const eurToUsd = await getEurToUsd();
  return {
    fcfaPerEur: FCFA_PER_EUR,
    fcfaPerUsd: Math.round((FCFA_PER_EUR / eurToUsd) * 100) / 100,
    updatedAt: cache.updatedAt || Date.now(),
  };
}

module.exports = { getRates };
