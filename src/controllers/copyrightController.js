const prisma = require('../config/prisma');
const { ok, fail } = require('../utils/response');
const { sendAdminMessage } = require('./chatController');

const CLAIM_INCLUDE = {
  track: {
    select: {
      id: true, title: true, deletedAt: true,
      artist: { select: { artistName: true, userId: true } },
    },
  },
  reporter: { select: { id: true, username: true, role: true } },
};

// GET /api/admin/copyright-claims
// Endpoint solo-ADMIN (protegido en adminRoutes.js): se expone el mensaje
// real del error para diagnóstico, igual que storageDiagnostics/setupRls.
async function listClaims(req, res) {
  try {
    const claims = await prisma.copyrightClaim.findMany({
      orderBy: { createdAt: 'desc' },
      include: CLAIM_INCLUDE,
    });
    return ok(res, { claims });
  } catch (e) {
    console.error('[copyright]', e);
    return fail(res, `Error al obtener las reclamaciones: ${e.message}`, 500);
  }
}

// GET /api/copyright-claims/mine
// El usuario logueado ve el estado de las reclamaciones que él mismo envió.
async function listMyClaims(req, res) {
  try {
    const claims = await prisma.copyrightClaim.findMany({
      where: { reporterId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: CLAIM_INCLUDE,
    });
    return ok(res, { claims });
  } catch (e) {
    console.error('[copyright]', e);
    return fail(res, 'Error al obtener tus reclamaciones', 500);
  }
}

// POST /api/admin/copyright-claims   (o POST /api/copyright-claims, desde Ajustes)
// body: { trackId, claimantName, claimantEmail, reason }
async function createClaim(req, res) {
  const { trackId, claimantName, claimantEmail, reason } = req.body;
  if (!trackId || !claimantName || !claimantEmail || !reason) {
    return fail(res, 'Faltan campos obligatorios (pista, reclamante, email, motivo)');
  }
  try {
    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (!track) return fail(res, 'Canción no encontrada', 404);

    const claim = await prisma.copyrightClaim.create({
      data: { trackId, claimantName, claimantEmail, reason, reporterId: req.user.id },
      include: CLAIM_INCLUDE,
    });
    return ok(res, { claim });
  } catch (e) {
    console.error('[copyright]', e);
    return fail(res, 'Error al registrar la reclamación', 500);
  }
}

// PATCH /api/admin/copyright-claims/:id   body: { status?, adminNotes? }
async function updateClaim(req, res) {
  const { id } = req.params;
  const { status, adminNotes } = req.body;
  const VALID_STATUSES = ['OPEN', 'CONTACTED', 'RESOLVED', 'DISMISSED'];
  if (status && !VALID_STATUSES.includes(status)) {
    return fail(res, `Estado inválido: ${status}`);
  }
  try {
    const data = {};
    if (status) {
      data.status = status;
      if (status === 'RESOLVED') data.resolvedAt = new Date();
    }
    if (adminNotes !== undefined) data.adminNotes = adminNotes;

    const claim = await prisma.copyrightClaim.update({ where: { id }, data });
    return ok(res, { claim });
  } catch (e) {
    console.error('[copyright]', e);
    return fail(res, 'Error al actualizar la reclamación', 500);
  }
}

// POST /api/admin/copyright-claims/:id/contact   body: { message }
// Envía un mensaje (por el chat de soporte ya existente) al usuario que subió
// la canción reclamada, y marca la reclamación como CONTACTED.
async function contactClaim(req, res) {
  const { id } = req.params;
  const message = (req.body.message || '').trim();
  if (!message) return fail(res, 'El mensaje no puede estar vacío');
  try {
    const claim = await prisma.copyrightClaim.findUnique({
      where: { id },
      include: { track: { include: { artist: true } } },
    });
    if (!claim) return fail(res, 'Reclamación no encontrada', 404);

    const targetUserId = claim.track.artist.userId;
    await sendAdminMessage(targetUserId, { body: message });

    const updated = await prisma.copyrightClaim.update({
      where: { id },
      data: { status: 'CONTACTED', contactedAt: new Date() },
    });
    return ok(res, { claim: updated });
  } catch (e) {
    if (e.status) return fail(res, e.message, e.status);
    console.error('[copyright]', e);
    return fail(res, 'Error al contactar al usuario', 500);
  }
}

module.exports = { listClaims, listMyClaims, createClaim, updateClaim, contactClaim };
