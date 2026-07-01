const path = require('path');
const prisma = require('../config/prisma');
const { ok, fail } = require('../utils/response');
const storage = require('../services/storage');
const subscriptionService = require('../services/subscriptionService');
const paymentController = require('./paymentController');

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus', '.wma', '.mp4', '.webm']);
const notif = require('./notificationController');

// Reescribe audioUrl y coverUrl de cualquier track al CDN actual
function rw(track) {
  if (!track) return track;
  return {
    ...track,
    audioUrl: storage.rewriteUrl(track.audioUrl),
    coverUrl: storage.rewriteUrl(track.coverUrl),
  };
}
function rwAll(tracks) { return tracks.map(rw); }

// POST /api/tracks  (ARTIST con suscripción activa o ADMIN)  multipart: audio, cover
async function uploadTrack(req, res) {
  const isAdmin = req.user.role === 'ADMIN';
  const isArtist = req.user.role === 'ARTIST' && req.user.artistProfile;

  if (!isAdmin && !isArtist) {
    return fail(res, 'Solo artistas pueden subir música', 403);
  }

  // Artistas deben tener suscripción activa; admins no
  if (isArtist) {
    const sub = await subscriptionService.getActiveSubscription(req.user.id);
    if (!sub) {
      return fail(res, 'Necesitas una suscripción de artista activa (10.000 FCFA/mes) para publicar', 402);
    }
  }

  // Para admin: necesitamos el artistId en el body
  let artistProfileId;
  if (isAdmin) {
    const { artistId } = req.body;
    if (!artistId) return fail(res, 'El administrador debe indicar el artistId');
    const artist = await prisma.artistProfile.findUnique({ where: { id: artistId } });
    if (!artist) return fail(res, 'Artista no encontrado', 404);
    artistProfileId = artistId;
  } else {
    artistProfileId = req.user.artistProfile.id;
  }

  const { title, genre, lyrics, album, durationSec } = req.body;
  if (!title || !genre) return fail(res, 'Faltan título o género');

  const audioFile = req.files?.audio?.[0];
  const coverFile = req.files?.cover?.[0];
  if (!audioFile) return fail(res, 'Falta el archivo de audio');

  // Validar que el archivo sea audio por MIME type O por extensión
  // (Android / Flutter pueden enviar application/octet-stream para archivos de audio)
  const ext = path.extname(audioFile.originalname).toLowerCase();
  if (!audioFile.mimetype.startsWith('audio/') && !AUDIO_EXTS.has(ext)) {
    return fail(res, 'El archivo no es de audio válido (.mp3, .wav, .ogg, .flac, .aac, .m4a…)');
  }

  const track = await prisma.track.create({
    data: {
      artistId: artistProfileId,
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

  // Notificar a seguidores (solo si es artista, no admin)
  if (isArtist) {
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
  }

  return ok(res, { track: rw(track) }, 201);
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
  return ok(res, { tracks: rwAll(tracks) });
}

// GET /api/tracks/charts  -> top por reproducciones
async function charts(req, res) {
  const tracks = await prisma.track.findMany({
    where: { isPublished: true },
    include: { artist: { select: { artistName: true, id: true, userId: true } } },
    orderBy: { playCount: 'desc' },
    take: 50,
  });
  return ok(res, { tracks: rwAll(tracks) });
}

// GET /api/tracks/mine  -> catálogo del artista (incluye ocultas)
async function myTracks(req, res) {
  if (!req.user.artistProfile) return fail(res, 'No eres artista', 403);
  const tracks = await prisma.track.findMany({
    where: { artistId: req.user.artistProfile.id },
    orderBy: { createdAt: 'desc' },
  });
  return ok(res, { tracks: rwAll(tracks) });
}

// POST /api/tracks/:id/play
// Oyente con suscripción activa (incluye prueba gratis) -> reproduce.
// Admin / Artista -> bypass directo (admin no cuenta; artista cuenta con reglas normales).
// Sin suscripción -> 402.
async function playTrack(req, res) {
  const track = await prisma.track.findUnique({ where: { id: req.params.id } });
  if (!track || !track.isPublished) return fail(res, 'Canción no disponible', 404);

  const role = req.user.role;
  const isAdmin  = role === 'ADMIN';
  const isArtist = role === 'ARTIST';

  if (!isAdmin && !isArtist) {
    const hasAccess = await subscriptionService.listenerHasAccess(req.user.id);
    if (!hasAccess) {
      return res.status(402).json({
        success: false,
        data: { requiresPayment: true, options: ['LISTENER_MONTHLY', 'PER_PLAY'] },
        error: 'Tu periodo gratuito terminó. Suscríbete o paga por reproducción.',
      });
    }
  }

  if (!isAdmin) {
    await paymentController.registerPlay(req.user.id, track, true);
  }

  const t = rw(track);
  return ok(res, { audioUrl: t.audioUrl, track: t });
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
  return ok(res, { tracks: rwAll(tracks) });
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

// PATCH /api/tracks/:id  -> editar metadatos (título, género, álbum, letra, carátula)
async function updateTrack(req, res) {
  const track = await prisma.track.findUnique({ where: { id: req.params.id } });
  if (!track) return fail(res, 'No encontrada', 404);

  const isAdmin = req.user.role === 'ADMIN';
  const isOwner = req.user.artistProfile && track.artistId === req.user.artistProfile.id;
  if (!isAdmin && !isOwner) return fail(res, 'No es tu canción', 403);

  const { title, genre, album, lyrics } = req.body;
  const data = {};
  if (title)  data.title  = title;
  if (genre)  data.genre  = genre;
  if (album  !== undefined) data.album  = album;
  if (lyrics !== undefined) data.lyrics = lyrics;

  // Si se sube nueva carátula, reemplazar la anterior
  const coverFile = req.files?.cover?.[0];
  if (coverFile) {
    if (track.coverUrl) storage.deleteFile(track.coverUrl).catch(() => {});
    data.coverUrl = await storage.upload(coverFile);
  }

  if (Object.keys(data).length === 0) return fail(res, 'Sin cambios que guardar');

  const updated = await prisma.track.update({ where: { id: track.id }, data });
  return ok(res, { track: rw(updated) });
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
  return ok(res, { track: rw(track) });
}

// POST /api/tracks/:id/like  -> da o quita "me gusta" (toggle)
async function toggleLike(req, res) {
  const userId  = req.user.id;
  const trackId = req.params.id;

  const existing = await prisma.trackLike.findUnique({
    where: { userId_trackId: { userId, trackId } },
  });

  if (existing) {
    await prisma.$transaction([
      prisma.trackLike.delete({ where: { userId_trackId: { userId, trackId } } }),
      prisma.track.update({ where: { id: trackId }, data: { likeCount: { decrement: 1 } } }),
    ]);
    return ok(res, { liked: false });
  } else {
    await prisma.$transaction([
      prisma.trackLike.create({ data: { userId, trackId } }),
      prisma.track.update({ where: { id: trackId }, data: { likeCount: { increment: 1 } } }),
    ]);
    return ok(res, { liked: true });
  }
}

// GET /api/tracks/:id/liked  -> ¿el usuario actual ha dado like?
async function isLiked(req, res) {
  const existing = await prisma.trackLike.findUnique({
    where: { userId_trackId: { userId: req.user.id, trackId: req.params.id } },
  });
  return ok(res, { liked: !!existing });
}

// GET /api/tracks/liked  -> canciones con like del usuario
async function likedTracks(req, res) {
  const likes = await prisma.trackLike.findMany({
    where: { userId: req.user.id },
    include: {
      track: {
        include: { artist: { select: { artistName: true, userId: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const tracks = likes.filter((l) => l.track.isPublished).map((l) => rw(l.track));
  return ok(res, { tracks });
}

module.exports = {
  uploadTrack, updateTrack, listTracks, charts, myTracks, playTrack, deleteTrack,
  feed, followArtist, unfollowArtist, myFollowing, getTrack,
  toggleLike, isLiked, likedTracks,
};
