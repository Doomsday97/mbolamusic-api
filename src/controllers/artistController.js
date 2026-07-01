const prisma = require('../config/prisma');
const { ok, fail } = require('../utils/response');
const subscriptionService = require('../services/subscriptionService');

// GET /api/artist/dashboard  -> estadísticas y estado de suscripción
async function dashboard(req, res) {
  if (!req.user.artistProfile) return fail(res, 'No eres artista', 403);
  const artistId = req.user.artistProfile.id;
  const userId   = req.user.id;

  const now          = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear  = new Date(now.getFullYear(), 0, 1);

  const [trackCount, agg, sub, followerCount, monthlyListenerRows, yearlyListenerRows, trackLikesData] =
    await Promise.all([
      prisma.track.count({ where: { artistId } }),
      prisma.track.aggregate({
        where: { artistId },
        _sum: { playCount: true, downloadCount: true, likeCount: true },
      }),
      subscriptionService.getActiveSubscription(userId),
      prisma.follow.count({ where: { followingId: userId } }),
      // Oyentes únicos este mes
      prisma.play.findMany({
        where: { artistId, createdAt: { gte: startOfMonth } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      // Oyentes únicos este año
      prisma.play.findMany({
        where: { artistId, createdAt: { gte: startOfYear } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      // Likes por canción
      prisma.track.findMany({
        where: { artistId },
        select: { id: true, title: true, likeCount: true, playCount: true },
        orderBy: { likeCount: 'desc' },
      }),
    ]);

  // Oyentes por ciudad (top 5) — usar artistId directamente
  const playsByCity = await prisma.play.findMany({
    where: { artistId },
    include: { user: { select: { city: true } } },
    take: 2000,
  });
  const cityCount = {};
  for (const p of playsByCity) {
    const c = p.user.city || 'Desconocida';
    cityCount[c] = (cityCount[c] || 0) + 1;
  }
  const topCities = Object.entries(cityCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([city, count]) => ({ city, count }));

  return ok(res, {
    subscriptionActive: !!sub,
    subscriptionEndsAt: sub?.endDate || null,
    subscriptionType: sub?.type || null,
    followerCount,
    monthlyListeners: monthlyListenerRows.length,
    yearlyListeners:  yearlyListenerRows.length,
    totalTracks:    trackCount,
    totalPlays:     agg._sum.playCount     || 0,
    totalDownloads: agg._sum.downloadCount || 0,
    totalLikes:     agg._sum.likeCount     || 0,
    totalEarnings:  req.user.artistProfile.totalEarnings,
    currency: 'FCFA',
    topCities,
    trackLikes: trackLikesData.map((t) => ({
      id: t.id,
      title: t.title,
      likeCount: t.likeCount,
      playCount: t.playCount,
    })),
  });
}

// POST /api/artist/withdraw  -> solicita retiro (registra solicitud)
async function requestWithdraw(req, res) {
  if (!req.user.artistProfile) return fail(res, 'No eres artista', 403);
  const earnings = req.user.artistProfile.totalEarnings;
  if (earnings <= 0) return fail(res, 'No tienes ganancias para retirar');

  // En un sistema real esto crearía una solicitud para que admin/finanzas pague.
  // Aquí dejamos las ganancias a 0 y devolvemos confirmación.
  await prisma.artistProfile.update({
    where: { id: req.user.artistProfile.id },
    data: { totalEarnings: 0 },
  });

  return ok(res, {
    message: 'Solicitud de retiro registrada',
    amount: earnings,
    currency: 'FCFA',
  });
}

// GET /api/artist/profile/:userId  -> perfil público de un artista
async function publicProfile(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
    include: {
      artistProfile: true,
      followers: { select: { id: true } },
    },
  });
  if (!user || !user.artistProfile) return fail(res, 'Artista no encontrado', 404);

  const tracks = await prisma.track.findMany({
    where: { artistId: user.artistProfile.id, isPublished: true },
    include: { artist: { select: { artistName: true, id: true, userId: true } } },
    orderBy: { releaseDate: 'desc' },
    take: 30,
  });

  return ok(res, {
    userId: user.id,
    username: user.username,
    artistName: user.artistProfile.artistName,
    bio: user.artistProfile.bio,
    country: user.country,
    city: user.city,
    followerCount: user.followers.length,
    totalEarnings: undefined, // no exponer ganancias públicamente
    tracks,
  });
}

// GET /api/artist/monthly-earnings  -> ingresos por suscripción (últimos 24 meses)
async function monthlyEarnings(req, res) {
  if (!req.user.artistProfile) return fail(res, 'No eres artista', 403);
  const artistId = req.user.artistProfile.id;

  const earnings = await prisma.artistMonthlyEarning.findMany({
    where:   { artistId },
    orderBy: { month: 'desc' },
    take:    24,
    select:  { month: true, playsCount: true, amount: true, isPaid: true, paidAt: true },
  });

  const totalPending = earnings.filter(e => !e.isPaid).reduce((s, e) => s + e.amount, 0);
  const totalPaid    = earnings.filter(e =>  e.isPaid).reduce((s, e) => s + e.amount, 0);

  return ok(res, { earnings, totalPending, totalPaid, currency: 'FCFA' });
}

module.exports = { dashboard, requestWithdraw, publicProfile, monthlyEarnings };
