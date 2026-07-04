// Reglas de negocio centralizadas de MbôláMusic.
// Cambia aquí los precios y el reparto sin tocar el resto del código.

module.exports = {
  currency: 'FCFA',

  prices: {
    artistMonthly: 10000,        // suscripción artista / mes
    listenerMonthly: 2000,       // suscripción oyente / mes
    listenerYearly: 12000,       // suscripción anual oyente
    listenerYearlyFirstTime: 10000, // precio de la primera suscripción anual del oyente
    perPlay: 50,                 // pago por reproducción
    perDownload: 200,            // pago por descarga
  },

  // Reparto de ingresos pay-per-use (reproducción/descarga sueltas)
  revenueSplit: {
    artist: 0.7,    // 70% para el artista
    platform: 0.3,  // 30% para la plataforma
  },

  trials: {
    listenerFreeDays: 30,    // 1 mes gratis para oyentes nuevos
    artistFreeDays: 30,      // 1 mes gratis para artistas nuevos
  },

  subscriptionDurationDays: 30,       // duración de un ciclo de suscripción mensual
  subscriptionDurationDaysYearly: 365, // duración de un ciclo de suscripción anual

  referral: {
    rewardDaysForReferrer: 15, // días gratis que gana quien refiere
  },

  // Reparto mensual de la suscripción de oyente (2.000 FCFA/mes)
  subscriptionSplit: {
    artistPool:    1400, // 70% → artistas (proporcional a reproducciones)
    platformShare:  600, // 30% → plataforma
  },

  // Umbral mínimo de ganancias acumuladas para efectuar el pago al artista
  payoutThreshold: 5000, // FCFA

  // Descargas gratis incluidas en la suscripción de oyente: tope mensual,
  // no cuentan como "compradas" (no son permanentes: se bloquean si la
  // suscripción vence, aunque el archivo no se borra del teléfono).
  // El tope es distinto para suscriptores de PAGO (mensual/anual) que para
  // quienes están en la prueba gratis de 1 mes.
  subscriptionDownloadsPerMonth: 250,        // LISTENER_MONTHLY / LISTENER_YEARLY
  subscriptionDownloadsPerMonthTrial: 5,     // LISTENER_FREE (prueba gratis)

  // Monto mínimo permitido para recargar o retirar el monedero
  minTransferAmount: 50, // FCFA

  // Destinos fijos para el retiro de monedero del admin (nunca a cuentas
  // personales): configurar en Render como variables de entorno.
  companyWallets: {
    MOBILE: process.env.COMPANY_WALLET_PHONE || null,
    BANK:   process.env.COMPANY_WALLET_BANK_ACCOUNT || null,
  },
};
