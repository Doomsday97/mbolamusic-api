/**
 * Servicio de reparto mensual de ingresos por suscripción — v2.
 *
 * Algoritmo completo (ver diagrama de flujo):
 *  1. Suscriptores válidos = LISTENER_MONTHLY activos EXCLUYENDO artistas.
 *  2. Fondo total = S × 2.000 FCFA.
 *     F_admin = 30%  (600 FCFA / suscriptor)
 *     F_artistas_max = 70% (1.400 FCFA / suscriptor — tope máximo, nunca se supera)
 *  3. Artistas elegibles = artistas con plays globales >= umbral mínimo configurable.
 *  4. Por cada suscriptor S_j:
 *     a. Obtener T_j (total plays del mes, bySubscription=true).
 *     b. Para cada artista A_i escuchado por S_j:
 *        – Si A_i es elegible  → G_ij = (r_ij / T_j) × 1.400 FCFA.
 *        – Si A_i no elegible → su parte va al remanente_j.
 *     c. Redistribuir remanente_j proporcionalmente entre los artistas elegibles
 *        que SÍ escuchó ese suscriptor.
 *     d. Si ningún artista elegible fue escuchado → 1.400 FCFA van a reserva.
 *  5. Verificar que suma total <= F_artistas_max.
 *  6. Registrar MonthlyDistribution, ArtistMonthlyEarning, AdminMonthlyEarning.
 *  7. Generar log de auditoría en consola.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Configuración ─────────────────────────────────────────────────────────────

const DEFAULT_CFG = {
  subscriptionValue: 2000,
  adminPct:          30,
  artistPct:         70,
  minPlaysThreshold: 1000,
};

/** Returns "YYYY-MM" for the month prior to `now`. */
function previousMonth(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Get monthly config (or defaults). */
async function getConfig(month) {
  const saved = await prisma.monthlyConfig.findUnique({ where: { month } });
  return saved ?? { ...DEFAULT_CFG, month };
}

/** Create or update the config for a given month. */
async function setConfig(month, params) {
  const data = {};
  if (params.subscriptionValue !== undefined) data.subscriptionValue = params.subscriptionValue;
  if (params.adminPct          !== undefined) data.adminPct          = params.adminPct;
  if (params.artistPct         !== undefined) data.artistPct         = params.artistPct;
  if (params.minPlaysThreshold !== undefined) data.minPlaysThreshold = params.minPlaysThreshold;

  return prisma.monthlyConfig.upsert({
    where:  { month },
    update: data,
    create: { month, ...DEFAULT_CFG, ...data },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Distributes `pool` FCFA across `items` using the largest-remainder method.
 * Each item must have a `weight` (non-negative number).
 * Returns the same items with an `amount: Int` field.
 */
function distributePool(pool, items) {
  if (items.length === 0) return [];
  const totalWeight = items.reduce((s, it) => s + it.weight, 0);
  if (totalWeight === 0) {
    const each = Math.floor(pool / items.length);
    const remainder = pool - each * items.length;
    return items.map((it, i) => ({ ...it, amount: each + (i < remainder ? 1 : 0) }));
  }
  let assigned = 0;
  const enriched = items.map(it => {
    const exact   = (it.weight / totalWeight) * pool;
    const floored = Math.floor(exact);
    assigned += floored;
    return { ...it, amount: floored, rem: exact - floored };
  });
  const leftover = pool - assigned;
  enriched
    .slice()
    .sort((a, b) => b.rem - a.rem)
    .slice(0, leftover)
    .forEach(it => it.amount++);
  return enriched;
}

// ── Main distribution ─────────────────────────────────────────────────────────

/**
 * Runs the monthly subscription revenue distribution for `month` ("YYYY-MM").
 * Idempotent: subscribers already processed are skipped.
 */
async function runDistribution(month) {
  const [year, mon] = month.split('-').map(Number);
  const start = new Date(year, mon - 1, 1);
  const end   = new Date(year, mon,     1);

  // ── 0. Load config ──────────────────────────────────────────────────────────
  const cfg               = await getConfig(month);
  const SUBSCRIPTION_VAL  = cfg.subscriptionValue;
  const ADMIN_PCT         = cfg.adminPct  / 100;
  const ARTIST_PCT        = cfg.artistPct / 100;
  const THRESHOLD         = cfg.minPlaysThreshold;
  const ARTIST_POOL_PER   = Math.round(SUBSCRIPTION_VAL * ARTIST_PCT);  // 1400
  const ADMIN_SHARE_PER   = SUBSCRIPTION_VAL - ARTIST_POOL_PER;         // 600

  // ── 1. Suscriptores válidos (excluyendo artistas) ───────────────────────────
  const allSubs = await prisma.subscription.findMany({
    where: {
      type:      'LISTENER_MONTHLY',
      startDate: { lt: end },
      endDate:   { gt: start },
    },
    select:   { userId: true },
    distinct: ['userId'],
  });

  const allUserIds   = allSubs.map(s => s.userId);
  const artistUsers  = await prisma.user.findMany({
    where:  { id: { in: allUserIds }, role: 'ARTIST' },
    select: { id: true },
  });
  const artistUserSet = new Set(artistUsers.map(u => u.id));
  const validSubs     = allSubs.filter(s => !artistUserSet.has(s.userId));

  const S = validSubs.length;
  if (S === 0) {
    return {
      month, total: 0, processed: 0, skipped: 0, errors: [],
      totalFund: 0, adminEarnings: 0, artistPool: 0, artistDistributed: 0, reserve: 0,
    };
  }

  const TOTAL_FUND      = S * SUBSCRIPTION_VAL;
  const ADMIN_TOTAL     = S * ADMIN_SHARE_PER;
  const ARTIST_POOL_MAX = S * ARTIST_POOL_PER;

  // ── 2. Artistas elegibles (plays globales >= umbral) ────────────────────────
  const globalGroups = await prisma.play.groupBy({
    by:    ['artistId'],
    where: {
      artistId:  { not: null },
      createdAt: { gte: start, lt: end },
    },
    _count: { id: true },
  });

  const eligibleSet = new Set(
    globalGroups
      .filter(g => g._count.id >= THRESHOLD)
      .map(g => g.artistId),
  );

  console.log(`[dist] ${month}: S=${S} subs, ${eligibleSet.size} eligible artists (threshold=${THRESHOLD})`);

  // ── 3. Procesar cada suscriptor ─────────────────────────────────────────────
  const results = { month, total: S, processed: 0, skipped: 0, errors: [] };
  const artistTotals = {}; // { artistProfileId → total FCFA }

  for (const { userId } of validSubs) {
    // Idempotency
    const existing = await prisma.monthlyDistribution.findUnique({
      where: { userId_month: { userId, month } },
    });
    if (existing) { results.skipped++; continue; }

    try {
      // Plays de este suscriptor por artista (sólo bySubscription)
      const subGroups = await prisma.play.groupBy({
        by:    ['artistId'],
        where: {
          userId,
          bySubscription: true,
          artistId:       { not: null },
          createdAt:      { gte: start, lt: end },
        },
        _count: { id: true },
      });

      const T_j = subGroups.reduce((s, g) => s + g._count.id, 0);

      // Separar elegibles y no elegibles
      const eligiblePlays    = [];
      let   remEligibleWeight = 0;
      let   remanente         = 0;

      for (const g of subGroups) {
        const r_ij     = g._count.id;
        const rawShare = T_j > 0 ? (r_ij / T_j) * ARTIST_POOL_PER : 0;
        if (eligibleSet.has(g.artistId)) {
          eligiblePlays.push({ artistId: g.artistId, playsCount: r_ij, weight: r_ij });
          remEligibleWeight += r_ij;
        } else {
          remanente += rawShare;
        }
      }

      let distributablePool;
      let reserveForSub;
      let items;

      if (eligiblePlays.length === 0) {
        // Ningún artista elegible → todo va a reserva
        distributablePool = 0;
        reserveForSub     = ARTIST_POOL_PER;
        items             = [];
      } else {
        // Redistribuir remanente entre elegibles (proporcional a plays de este sub)
        distributablePool = ARTIST_POOL_PER; // 0 va a reserva cuando hay elegibles
        reserveForSub     = 0;

        // Total pool = ARTIST_POOL_PER (elegible fraction + remanente redistributed)
        // We distribute the full ARTIST_POOL_PER using weights = plays_of_eligible_artists
        items = distributePool(ARTIST_POOL_PER, eligiblePlays);
      }

      // ── Guardar en base de datos (transacción) ────────────────────────────
      await prisma.$transaction(async (tx) => {
        await tx.monthlyDistribution.create({
          data: {
            userId,
            month,
            totalPlays:    T_j,
            artistPool:    distributablePool,
            adminShare:    ADMIN_SHARE_PER,
            reserveAmount: reserveForSub,
            processedAt:   new Date(),
            artistEarnings: items.length > 0 ? {
              create: items.map(it => ({
                artistId:   it.artistId,
                playsCount: it.playsCount,
                amount:     it.amount,
                month,
              })),
            } : undefined,
          },
        });

        for (const it of items) {
          if (it.amount > 0) {
            await tx.artistProfile.update({
              where: { id: it.artistId },
              data:  { totalEarnings: { increment: it.amount } },
            });
            artistTotals[it.artistId] = (artistTotals[it.artistId] || 0) + it.amount;
          }
        }
      });

      results.processed++;
    } catch (err) {
      results.errors.push({ userId, error: err.message });
      console.error(`[dist] Error processing subscriber ${userId}:`, err.message);
    }
  }

  // ── 4. Verificación y registro del admin ────────────────────────────────────
  const totalDistributed = Object.values(artistTotals).reduce((s, v) => s + v, 0);
  const reserve          = ARTIST_POOL_MAX - totalDistributed;

  // Sanity check: total distributed should never exceed pool
  if (totalDistributed > ARTIST_POOL_MAX + 1) {
    console.error(`[dist] INTEGRITY ERROR: distributed ${totalDistributed} > pool ${ARTIST_POOL_MAX}`);
  }

  await prisma.adminMonthlyEarning.upsert({
    where:  { month },
    update: {
      totalSubscribers: S, totalFund: TOTAL_FUND, adminAmount: ADMIN_TOTAL,
      artistPool: ARTIST_POOL_MAX, distributedAmount: totalDistributed, reserveAmount: reserve,
    },
    create: {
      month, totalSubscribers: S, totalFund: TOTAL_FUND, adminAmount: ADMIN_TOTAL,
      artistPool: ARTIST_POOL_MAX, distributedAmount: totalDistributed, reserveAmount: reserve,
    },
  });

  console.log(`[dist] ${month} done — distributed: ${totalDistributed} FCFA, reserve: ${reserve} FCFA, artists: ${Object.keys(artistTotals).length}`);

  return {
    ...results,
    totalFund:         TOTAL_FUND,
    adminEarnings:     ADMIN_TOTAL,
    artistPool:        ARTIST_POOL_MAX,
    artistDistributed: totalDistributed,
    reserve,
    eligibleArtists:   eligibleSet.size,
  };
}

// ── Query helpers ─────────────────────────────────────────────────────────────

async function getMonthlySummary() {
  const [rows, admins] = await Promise.all([
    prisma.monthlyDistribution.groupBy({
      by:      ['month'],
      _count:  { userId: true },
      _sum:    { totalPlays: true, artistPool: true, adminShare: true, reserveAmount: true },
      orderBy: { month: 'desc' },
      take:    24,
    }),
    prisma.adminMonthlyEarning.findMany({
      orderBy: { month: 'desc' },
      take:    24,
    }),
  ]);

  const adminMap = Object.fromEntries(admins.map(a => [a.month, a]));
  return rows.map(r => {
    const adm = adminMap[r.month];
    return {
      month:             r.month,
      subscribers:       r._count.userId,
      totalPlays:        r._sum.totalPlays  || 0,
      artistDistributed: adm?.distributedAmount ?? (r._sum.artistPool || 0),
      adminShare:        adm?.adminAmount        ?? (r._sum.adminShare || 0),
      reserve:           adm?.reserveAmount      ?? (r._sum.reserveAmount || 0),
      totalFund:         adm?.totalFund          ?? 0,
    };
  });
}

async function getMonthDetail(month) {
  const [earnings, adm] = await Promise.all([
    prisma.artistMonthlyEarning.groupBy({
      by:    ['artistId'],
      where: { month },
      _sum:  { playsCount: true, amount: true },
    }),
    prisma.adminMonthlyEarning.findUnique({ where: { month } }),
  ]);

  const artistIds = earnings.map(e => e.artistId);
  const profiles  = await prisma.artistProfile.findMany({
    where:  { id: { in: artistIds } },
    select: { id: true, artistName: true },
  });
  const nameMap = Object.fromEntries(profiles.map(p => [p.id, p.artistName]));

  return {
    artists: earnings
      .map(e => ({
        artistId:   e.artistId,
        artistName: nameMap[e.artistId] ?? '—',
        playsCount: e._sum.playsCount || 0,
        amount:     e._sum.amount     || 0,
      }))
      .sort((a, b) => b.amount - a.amount),
    admin: adm,
  };
}

async function getAdminReport(month) {
  const adm = await prisma.adminMonthlyEarning.findUnique({ where: { month } });
  const cfg = await getConfig(month);
  return { config: cfg, admin: adm };
}

module.exports = {
  runDistribution, previousMonth,
  getConfig, setConfig,
  getMonthlySummary, getMonthDetail, getAdminReport,
};
