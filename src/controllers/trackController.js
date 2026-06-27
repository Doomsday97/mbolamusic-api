const prisma = require('../config/prisma');
const { ok, fail } = require('../utils/response');
const storage = require('../services/storage');
const subscriptionService = require('../services/subscriptionService');
const paymentController = require('./paymentController');
const notif = require('./notificationController');

// POST /api/tracks  (solo ARTIST con suscripción activa)  multipart: audio, cover
async function uploadTrack(req, res) {
  if (req.user.role !== 'ARTIST' || !req.user.artistProfile) {
    return fail(res, 'Solo artistas pueden subir música', 403);
  }

  // Debe tener suscripción de artista activa
  const sub = await subscriptionService.getActiveSubscription(req.user.id);
  if (!sub) {
    return fail(res, 'Necesitas una suscripción de artista activa (10.000 FCFA/mes) para publicar', 402);
  }

  const { title, genre, lyrics, album, durationSec } = req.body;
  if (!title || !genre) return fail(res, 'Faltan título o género');

  const audioFile = req.files?.audio?.[0];
  const coverFile = req.files?.cover?.[0];
  if (!audioFile) return fail(res, 'Falta el archivo de audio');

  // Validación básica de tipo de audio
  if (!audioFile.mimetype.startsWith('audio/')) {
    return fail(res, 'El archivo no es de audio válido');
  }

  const track = await prisma.track.create({
    data: {
      artistId: req.user.artistProfile.id,
      title,
      genre,
      lyrics,
      album,
      durationSec: parseInt(durationSec) || 0,
      audioUrl: await storage.upload(audioFile),
      coverUrl: coverFile ? await storage.upload(coverFile) : null,
      isPublished: true,
    },
  });

  // Notificar a seguidores
  const followers = await prisma.follow.findMany({
    where: { followingId: req.user.id },
    select: { followerId: true },
  });
  for (const f of followers) {
    notif.create(
      f.followerId,
      'NEW_TRACK',
      'Nueva canción',
      `${req.user.artistProfile.artistName} acaba de subir "${title}"`,
    );
  }

  return ok(res, { track }, 201);
}

// GET /api/tracks?genre=...&search=...  -> catálogo público (solo publicadas)
async function listTracks(req, res) {
  const { genre, search } = req.query;
  const where = { isPublished: true };
  if (genre && genre !== 'all') where.genre = genre;
  if (search) where.title = { contains: search, mode: 'insensitive' };

  const tracks = await prisma.track.findMany({
    where,
    include: { artist: { select: { artistName: true, id: true, userId: true } } },
    orderBy: { releaseDate: 'desc' },
    take: 100,
  });
  return ok(res, { tracks });
}

// GET /api/tracks/charts  -> top por reproducciones
async function charts(req, res) {
  const tracks = await prisma.track.findMany({
    where: { isPublished: true },
    include: { artist: { select: { artistName: true, id: true, userId: true } } },
    orderBy: { playCount: 'desc' },
    take: 50,
  });
  return ok(res, { tracks });
}

// GET /api/tracks/mine  -> catálogo del artista (incluye ocultas)
async function myTracks(req, res) {
  if (!req.user.artistProfile) return fail(res, 'No eres artista', 403);
  const tracks = await prisma.track.findMany({
    where: { artistId: req.user.artistProfile.id },
    orderBy: { createdAt: 'desc' },
  });
  return ok(res, { tracks });
}

// POST /api/tracks/:id/play
// Si el oyente tiene suscripción activa -> reproduce gratis.
// Si no -> responde 402 indicando que debe pagar 50 FCFA (per-play).
async function playTrack(req, res) {
  const track = await prisma.track.findUnique({ where: { id: req.params.id } });
  if (!track || !track.isPublished) return fail(res, 'Canción no disponible', 404);

  const hasAccess = await subscriptionService.listenerHasAccess(req.user.id);
  if (!hasAccess) {
    return res.status(402).json({
      success: false,
      data: { requiresPayment: true, options: ['LISTENER_MONTHLY', 'PER_PLAY'] },
      error: 'Tu periodo gratuito terminó. Suscríbete o paga por reproducción.',
    });
  }

  await paymentController.registerPlay(req.user.id, track, true);
  return ok(res, { audioUrl: track.audioUrl, track });
}

// GET /api/tracks/feed  -> últimas canciones de artistas que sigo
async function feed(req, res) {
  const follows = await prisma.follow.findMany({
    where: { followerId: req.user.id },
    select: { followingId: true },
  });
  if (follows.length === 0) return ok(res, { tracks: [] });

  const followedIds = follows.map((f) => f.followingId);
  // followingId es userId; necesitamos los artistProfileId
  const profiles = await prisma.artistProfile.findMany({
    where: { userId: { in: followedIds } },
    select: { id: true },
  });
  const artistIds = profiles.map((p) => p.id);

  const tracks = await prisma.track.findMany({
    where: { artistId: { in: artistIds }, isPublished: true },
    include: { artist: { select: { artistName: true, id: true, userId: true } } },
    orderBy: { releaseDate: 'desc' },
    take: 50,
  });
  return ok(res, { tracks });
}

// POST /api/tracks/follow/:userId  -> seguir a un artista
async function followArtist(req, res) {
  const targetId = req.params.userId;
  if (targetId === req.user.id) return fail(res, 'No puedes seguirte a ti mismo');

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || target.role !== 'ARTIST') return fail(res, 'Artista no encontrado', 404);

  await prisma.follow.upsert({
    where: { followerId_followingId: { followerId: req.user.id, followingId: targetId } },
    create: { followerId: req.user.id, followingId: targetId },
    update: {},
  });

  // Notificar al artista
  notif.create(
    targetId,
    'NEW_FOLLOWER',
    'Nuevo seguidor',
    `${req.user.username} ahora te sigue.`,
  );

  return ok(res, { following: true });
}

// DELETE /api/tracks/follow/:userId  -> dejar de seguir
async function unfollowArtist(req, res) {
  await prisma.follow.deleteMany({
    where: { followerId: req.user.id, followingId: req.params.userId },
  });
  return ok(res, { following: false });
}

// GET /api/tracks/following  -> lista de artistas que sigo
async function myFollowing(req, res) {
  const follows = await prisma.follow.findMany({
    where: { followerId: req.user.id },
    include: {
      following: {
        select: {
          id: true,
          username: true,
          artistProfile: { select: { artistName: true } },
        },
      },
    },
  });
  return ok(res, { following: follows.map((f) => f.following) });
}

// DELETE /api/tracks/:id  (el artista dueño)
async function deleteTrack(req, res) {
  const track = await prisma.track.findUnique({ where: { id: req.params.id } });
  if (!track) return fail(res, 'No encontrada', 404);
  if (!req.user.artistProfile || track.artistId !== req.user.artistProfile.id) {
    return fail(res, 'No es tu canción', 403);
  }
  await prisma.track.delete({ where: { id: track.id } });
  // Borrar archivos del almacenamiento (no bloqueante: el track ya fue eliminado de DB)
  storage.deleteFile(track.audioUrl).catch(() => {});
  if (track.coverUrl) storage.deleteFile(track.coverUrl).catch(() => {});
  return ok(res, { deleted: true });
}

// GET /api/tracks/:id  -> info pública de una canción (player page)
async function getTrack(req, res) {
  const track = await prisma.track.findFirst({
    where: { id: req.params.id, isPublished: true },
    include: {
      artist: { select: { artistName: true, userId: true } },
      _count: { select: { plays: true, downloads: true } },
    },
  });
  if (!track) return fail(res, 'Canción no encontrada', 404);
  return ok(res, { track });
}

module.exports = {
  uploadTrack, listTracks, charts, myTracks, playTrack, deleteTrack,
  feed, followArtist, unfollowArtist, myFollowing, getTrack,
};
