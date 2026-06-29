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

// GET /api/admin/tracks
async function listAllTracks(req, res) {
  const { search, genre } = req.query;
  const where = {};
  if (search) where.title = { contains: search, mode: 'insensitive' };
  if (genre && genre !== 'all') where.genre = genre;
  const tracks = await prisma.track.findMany({
    where,
    include: {
      artist: { select: { artistName: true } },
      _count: { select: { plays: true, downloads: true } },
    },
    orderBy: { releaseDate: 'desc' },
    take: 200,
  });
  return ok(res, { tracks });
}

// GET /api/admin/artists  -> lista para el selector del formulario
async function listArtists(req, res) {
  const artists = await prisma.artistProfile.findMany({
    select: { id: true, artistName: true },
    orderBy: { artistName: 'asc' },
  });
  return ok(res, { artists });
}

// GET /api/admin/users/:id  -> detalle completo con historial de pagos
async function getUser(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, username: true, email: true, phone: true,
      role: true, country: true, city: true, isVerified: true,
      walletBalance: true, createdAt: true,
      artistProfile: { select: { artistName: true, bio: true, idVerified: true, totalEarnings: true } },
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, type: true, amount: true, status: true, createdAt: true, description: true },
      },
      plays: { select: { id: true }, take: 1 },
      downloads: { select: { id: true }, take: 1 },
      _count: { select: { plays: true, downloads: true } },
    },
  });
  if (!user) return fail(res, 'Usuario no encontrado', 404);
  return ok(res, { user });
}

// PUT /api/admin/users/:id  -> editar datos del usuario
async function updateUser(req, res) {
  const { username, email, country, city, isVerified, walletBalance } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return fail(res, 'Usuario no encontrado', 404);

  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...(username && { username }),
      ...(email && { email }),
      ...(country && { country }),
      ...(city !== undefined && { city }),
      ...(isVerified !== undefined && { isVerified }),
      ...(walletBalance !== undefined && { walletBalance: parseInt(walletBalance) }),
    },
  });
  return ok(res, { user: updated });
}

// POST /api/admin/users/:id/reset-password  -> admin resetea contraseña
async function resetPassword(req, res) {
  const bcrypt = require('bcryptjs');
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return fail(res, 'La contraseña debe tener al menos 6 caracteres');
  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash: hash } });
  return ok(res, { reset: true });
}

// POST /api/admin/tracks  -> sube sin requerir suscripción de artista
async function adminUploadTrack(req, res) {
  const { title, genre, artistId, album, durationSec, audioUrl: externalUrl } = req.body;
  if (!title || !genre || !artistId) return fail(res, 'Faltan: título, género o artista');

  const artist = await prisma.artistProfile.findUnique({ where: { id: artistId } });
  if (!artist) return fail(res, 'Artista no encontrado', 404);

  const storage = require('../services/storage');
  const audioFile = req.files?.audio?.[0];
  const coverFile = req.files?.cover?.[0];

  let audioUrl = externalUrl || '';
  if (audioFile) {
    if (!audioFile.mimetype.startsWith('audio/')) return fail(res, 'El archivo no es audio válido');
    audioUrl = await storage.upload(audioFile);
  }
  if (!audioUrl) return fail(res, 'Falta el audio (archivo o URL externa)');

  const track = await prisma.track.create({
    data: {
      artistId,
      title,
      genre,
      album: album || null,
      durationSec: parseInt(durationSec) || 0,
      audioUrl,
      coverUrl: coverFile ? await storage.upload(coverFile) : null,
      isPublished: true,
    },
    include: { artist: { select: { artistName: true } } },
  });
  return ok(res, { track }, 201);
}

// DELETE /api/admin/tracks/:id
async function adminDeleteTrack(req, res) {
  const track = await prisma.track.findUnique({ where: { id: req.params.id } });
  if (!track) return fail(res, 'Canción no encontrada', 404);
  await prisma.track.delete({ where: { id: req.params.id } });
  return ok(res, { deleted: true });
}

// PATCH /api/admin/tracks/:id/toggle
async function togglePublish(req, res) {
  const track = await prisma.track.findUnique({ where: { id: req.params.id } });
  if (!track) return fail(res, 'Canción no encontrada', 404);
  const updated = await prisma.track.update({
    where: { id: req.params.id },
    data: { isPublished: !track.isPublished },
  });
  return ok(res, { track: updated });
}

// GET /api/admin/online  -> usuarios activos (últimos 5 min)
const onlineTracker = require('../middleware/onlineTracker');
async function onlineUsers(req, res) {
  return ok(res, { users: onlineTracker.getOnline() });
}

// GET /api/admin/subscription-distributions?month=YYYY-MM
async function subscriptionDistributions(req, res) {
  const distSvc = require('../services/subscriptionDistributionService');
  if (req.query.month) {
    const detail = await distSvc.getMonthDetail(req.query.month);
    return ok(res, { month: req.query.month, ...detail });
  }
  const months = await distSvc.getMonthlySummary();
  return ok(res, { months });
}

// POST /api/admin/subscription-distributions/run  body: { month? }
async function runSubscriptionDistribution(req, res) {
  const distSvc = require('../services/subscriptionDistributionService');
  const month   = req.body?.month || distSvc.previousMonth();
  const result  = await distSvc.runDistribution(month);
  return ok(res, result);
}

// GET  /api/admin/subscription-config?month=YYYY-MM  -> config del mes
// POST /api/admin/subscription-config  body: { month, subscriptionValue?, adminPct?, artistPct?, minPlaysThreshold? }
async function subscriptionConfig(req, res) {
  const distSvc = require('../services/subscriptionDistributionService');
  if (req.method === 'POST') {
    const { month, ...params } = req.body;
    if (!month) return fail(res, 'Falta el campo month (YYYY-MM)');
    const cfg = await distSvc.setConfig(month, params);
    return ok(res, { config: cfg });
  }
  // GET
  const month = req.query.month || distSvc.previousMonth();
  const cfg   = await distSvc.getConfig(month);
  return ok(res, { config: cfg });
}

// GET /api/admin/monthly-report/:month  -> informe admin completo
async function monthlyReport(req, res) {
  const distSvc = require('../services/subscriptionDistributionService');
  const { month } = req.params;
  const data = await distSvc.getAdminReport(month);
  return ok(res, data);
}

// GET /api/admin/platform-earnings  -> ganancias disponibles de la plataforma
async function platformEarnings(req, res) {
  const [earned, withdrawn] = await Promise.all([
    prisma.payment.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { platformShare: true },
    }),
    prisma.payment.aggregate({
      where: { status: 'COMPLETED', purpose: 'PLATFORM_WITHDRAW' },
      _sum: { amount: true },
    }),
  ]);
  const totalEarned    = earned._sum.platformShare || 0;
  const totalWithdrawn = withdrawn._sum.amount     || 0;
  return ok(res, {
    totalEarned,
    totalWithdrawn,
    available: Math.max(0, totalEarned - totalWithdrawn),
  });
}

// POST /api/admin/platform-withdraw  body: { amount, bankDetails }
async function platformWithdraw(req, res) {
  const { amount, bankDetails } = req.body;
  if (!amount || amount <= 0) return fail(res, 'Monto inválido');

  const [earned, withdrawn] = await Promise.all([
    prisma.payment.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { platformShare: true },
    }),
    prisma.payment.aggregate({
      where: { status: 'COMPLETED', purpose: 'PLATFORM_WITHDRAW' },
      _sum: { amount: true },
    }),
  ]);
  const available = (earned._sum.platformShare || 0) - (withdrawn._sum.amount || 0);
  if (amount > available) {
    return fail(res, `Saldo insuficiente. Disponible: ${available} FCFA.`);
  }

  const payment = await prisma.payment.create({
    data: {
      userId: req.user.id,
      amount,
      method: 'BANK_TRANSFER',
      status: 'COMPLETED',
      purpose: 'PLATFORM_WITHDRAW',
      externalRef: bankDetails || 'Retiro plataforma',
    },
  });
  return ok(res, { payment, remaining: available - amount });
}

module.exports = {
  stats, listUsers, getUser, updateUser, resetPassword,
  blockArtist, unblockArtist, listPayments,
  listAllTracks, listArtists, adminUploadTrack, adminDeleteTrack, togglePublish,
  onlineUsers, platformEarnings, platformWithdraw,
  subscriptionDistributions, runSubscriptionDistribution,
  subscriptionConfig, monthlyReport,
};
