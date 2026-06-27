const prisma = require('../config/prisma');
const { ok } = require('../utils/response');

// Crea una notificación para un usuario (uso interno entre controladores)
async function create(userId, type, title, body) {
  try {
    await prisma.notification.create({ data: { userId, type, title, body } });
  } catch (_) {
    // No bloquear el flujo principal si falla una notif
  }
}

// GET /api/notifications
async function list(req, res) {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const unread = notifications.filter((n) => !n.isRead).length;
  return ok(res, { notifications, unread });
}

// PATCH /api/notifications/:id/read
async function markRead(req, res) {
  await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user.id },
    data: { isRead: true },
  });
  return ok(res, { read: true });
}

// PATCH /api/notifications/read-all
async function markAllRead(req, res) {
  await prisma.notification.updateMany({
    where: { userId: req.user.id, isRead: false },
    data: { isRead: true },
  });
  return ok(res, { read: true });
}

// DELETE /api/notifications/all
async function deleteAll(req, res) {
  await prisma.notification.deleteMany({ where: { userId: req.user.id } });
  return ok(res, { deleted: true });
}

module.exports = { create, list, markRead, markAllRead, deleteAll };
