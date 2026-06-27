// Reglas de negocio centralizadas de MbôláMusic.
// Cambia aquí los precios y el reparto sin tocar el resto del código.

module.exports = {
  currency: 'FCFA',

  prices: {
    artistMonthly: 10000,    // suscripción artista / mes
    listenerMonthly: 2000,   // suscripción oyente / mes
    perPlay: 50,             // pago por reproducción
    perDownload: 200,        // pago por descarga
  },

  // Reparto de ingresos pay-per-use (reproducción/descarga sueltas)
  revenueSplit: {
    artist: 0.7,    // 70% para el artista
    platform: 0.3,  // 30% para la plataforma
  },

  trials: {
    listenerFreeDays: 30,    // 1 mes gratis para oyentes nuevos
  },

  subscriptionDurationDays: 30, // duración de un ciclo de suscripción

  referral: {
    rewardDaysForReferrer: 15, // días gratis que gana quien refiere
  },
};
