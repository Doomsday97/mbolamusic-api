// Panel de administración — solo usuarios con rol ADMIN
const prisma = require('../config/prisma');
const { ok, fail } = require('../utils/response');

// GET /api/admin/stats  -> resumen general de la plataforma
async function stats(req, res) {
  const [
    totalUsers,
    totalArtists,
    totalTracks,
    totalPlays,
    totalDownloads,
    pendingPayments,
    revenueAgg,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'ARTIST' } }),
    prisma.track.count({ where: { isPublished: true } }),
    prisma.play.count(),
    prisma.download.count(),
    prisma.payment.count({ where: { status: 'VERIFYING' } }),
    prisma.payment.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amount: true, platformShare: true, artistShare: true },
    }),
  ]);

  return ok(res, {
    totalUsers,
    totalArtists,
    totalTracks,
    totalPlays,
    totalDownloads,
    pendingPayments,
    totalRevenue:   revenueAgg._sum.amount         || 0,
    platformRevenue: revenueAgg._sum.platformShare || 0,
    artistRevenue:  revenueAgg._sum.artistShare    || 0,
    currency: 'FCFA',
  });
}

// GET /api/admin/users?page=1&limit=20&role=ARTIST
async function listUsers(req, res) {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const role  = req.query.role;

  const where = role ? { role } : {};
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true, username: true, email: true, phone: true,
        role: true, country: true, city: true,
        walletBalance: true, isVerified: true, createdAt: true,
        artistProfile: { select: { artistName: true, idVerified: true, totalEarnings: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return ok(res, { users, total, page, pages: Math.ceil(total / limit) });
}

// POST /api/admin/users/:id/block  -> oculta toda la música del artista
async function blockArtist(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { artistProfile: true },
  });
  if (!user) return fail(res, 'Usuario no encontrado', 404);
  if (!user.artistProfile) return fail(res, 'No es artista');

  await prisma.track.updateMany({
    where: { artistId: user.artistProfile.id },
    data: { isPublished: false },
  });
  return ok(res, { blocked: true, message: 'Música del artista ocultada' });
}

// POST /api/admin/users/:id/unblock -> restaura la música del artista
async function unblockArtist(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { artistProfile: true },
  });
  if (!user) return fail(res, 'Usuario no encontrado', 404);
  if (!user.artistProfile) return fail(res, 'No es artista');

  await prisma.track.updateMany({
    where: { artistId: user.artistProfile.id },
    data: { isPublished: true },
  });
  return ok(res, { unblocked: true });
}

// GET /api/admin/payments?status=VERIFYING
async function listPayments(req, res) {
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const status = req.query.status;

  const where = status ? { status } : {};
  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        user: { select: { username: true, email: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.payment.count({ where }),
  ]);

  return ok(res, { payments, total, page, pages: Math.ceil(total / limit) });
}

module.exports = { stats, listUsers, blockArtist, unblockArtist, listPayments };
