const prisma = require('../config/prisma');
const { ok, fail } = require('../utils/response');

// GET /api/playlists  -> mis playlists (con conteo de tracks)
async function list(req, res) {
  const playlists = await prisma.playlist.findMany({
    where: { userId: req.user.id },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return ok(res, { playlists });
}

// POST /api/playlists  body: { name }
async function create(req, res) {
  const { name } = req.body;
  if (!name?.trim()) return fail(res, 'El nombre es obligatorio');
  const playlist = await prisma.playlist.create({
    data: { userId: req.user.id, name: name.trim() },
    include: { _count: { select: { items: true } } },
  });
  return ok(res, { playlist }, 201);
}

// GET /api/playlists/:id  -> detalle con tracks
async function detail(req, res) {
  const playlist = await prisma.playlist.findUnique({
    where: { id: req.params.id },
    include: {
      items: {
        include: {
          track: {
            include: { artist: { select: { artistName: true, id: true, userId: true } } },
          },
        },
        orderBy: { addedAt: 'asc' },
      },
    },
  });
  if (!playlist) return fail(res, 'Playlist no encontrada', 404);
  if (playlist.userId !== req.user.id) return fail(res, 'No tienes acceso', 403);
  return ok(res, { playlist });
}

// POST /api/playlists/:id/tracks  body: { trackId }
async function addTrack(req, res) {
  const { trackId } = req.body;
  if (!trackId) return fail(res, 'Falta trackId');

  const playlist = await prisma.playlist.findUnique({ where: { id: req.params.id } });
  if (!playlist) return fail(res, 'Playlist no encontrada', 404);
  if (playlist.userId !== req.user.id) return fail(res, 'No tienes acceso', 403);

  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track) return fail(res, 'Canción no encontrada', 404);

  await prisma.playlistItem.upsert({
    where: { playlistId_trackId: { playlistId: playlist.id, trackId } },
    create: { playlistId: playlist.id, trackId },
    update: {},
  });
  return ok(res, { added: true });
}

// DELETE /api/playlists/:id/tracks/:trackId
async function removeTrack(req, res) {
  const playlist = await prisma.playlist.findUnique({ where: { id: req.params.id } });
  if (!playlist) return fail(res, 'Playlist no encontrada', 404);
  if (playlist.userId !== req.user.id) return fail(res, 'No tienes acceso', 403);

  await prisma.playlistItem.deleteMany({
    where: { playlistId: req.params.id, trackId: req.params.trackId },
  });
  return ok(res, { removed: true });
}

// DELETE /api/playlists/:id
async function deletePlaylist(req, res) {
  const playlist = await prisma.playlist.findUnique({ where: { id: req.params.id } });
  if (!playlist) return fail(res, 'Playlist no encontrada', 404);
  if (playlist.userId !== req.user.id) return fail(res, 'No tienes acceso', 403);
  await prisma.playlist.delete({ where: { id: req.params.id } });
  return ok(res, { deleted: true });
}

// GET /api/playlists/track/:trackId/in  -> ¿en qué playlists está esta canción?
async function trackInPlaylists(req, res) {
  const items = await prisma.playlistItem.findMany({
    where: {
      trackId: req.params.trackId,
      playlist: { userId: req.user.id },
    },
    select: { playlistId: true },
  });
  return ok(res, { playlistIds: items.map((i) => i.playlistId) });
}

module.exports = { list, create, detail, addTrack, removeTrack, deletePlaylist, trackInPlaylists };
