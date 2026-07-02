const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Usuario: obtener su conversación con admin ──────────────────────────────
async function getMyMessages(req, res) {
  try {
    const messages = await prisma.chatMessage.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'asc' },
    });

    // Marcar como leídos los mensajes del admin que el usuario no ha leído
    await prisma.chatMessage.updateMany({
      where: { userId: req.user.id, fromAdmin: true, isRead: false },
      data: { isRead: true },
    });

    res.json({ success: true, data: messages, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
}

// Sube el adjunto (si lo hay) al almacenamiento activo y devuelve { mediaUrl, mediaType }
async function _uploadAttachment(file) {
  if (!file) return { mediaUrl: null, mediaType: null };
  const storage = require('../services/storage');
  const mediaUrl = await storage.upload(file);
  const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
  return { mediaUrl, mediaType };
}

// ── Usuario: enviar mensaje al admin ───────────────────────────────────────
async function sendMessage(req, res) {
  const body = (req.body.body || '').trim();
  if (!body && !req.file) {
    return res.status(400).json({ success: false, data: null, error: 'El mensaje no puede estar vacío' });
  }
  try {
    const { mediaUrl, mediaType } = await _uploadAttachment(req.file);
    const msg = await prisma.chatMessage.create({
      data: {
        userId:    req.user.id,
        fromAdmin: false,
        body,
        mediaUrl,
        mediaType,
      },
    });
    res.json({ success: true, data: msg, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
}

// ── Usuario: cuántos mensajes no leídos tiene ──────────────────────────────
async function unreadCount(req, res) {
  try {
    const count = await prisma.chatMessage.count({
      where: { userId: req.user.id, fromAdmin: true, isRead: false },
    });
    res.json({ success: true, data: { count }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
}

// ── Admin: listar todas las conversaciones con resumen ─────────────────────
async function adminListConversations(req, res) {
  try {
    // Agrupar por userId: último mensaje + mensajes no leídos (del usuario al admin)
    const rows = await prisma.chatMessage.groupBy({
      by: ['userId'],
      _count: { id: true },
      _max:   { createdAt: true },
    });

    // Enriquecer con datos del usuario y mensajes sin leer
    const enriched = await Promise.all(rows.map(async (r) => {
      const [user, unread, last] = await Promise.all([
        prisma.user.findUnique({
          where: { id: r.userId },
          select: { id: true, username: true, email: true, role: true },
        }),
        prisma.chatMessage.count({
          where: { userId: r.userId, fromAdmin: false, isRead: false },
        }),
        prisma.chatMessage.findFirst({
          where:   { userId: r.userId },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      return { user, unreadFromUser: unread, lastMessage: last };
    }));

    enriched.sort((a, b) => {
      const ta = a.lastMessage?.createdAt ?? 0;
      const tb = b.lastMessage?.createdAt ?? 0;
      return tb - ta;
    });

    res.json({ success: true, data: enriched, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
}

// ── Admin: obtener mensajes de un usuario concreto ─────────────────────────
async function adminGetMessages(req, res) {
  const { userId } = req.params;
  try {
    const messages = await prisma.chatMessage.findMany({
      where:   { userId },
      orderBy: { createdAt: 'asc' },
    });

    // Marcar como leídos los mensajes del usuario que el admin no ha leído
    await prisma.chatMessage.updateMany({
      where: { userId, fromAdmin: false, isRead: false },
      data:  { isRead: true },
    });

    res.json({ success: true, data: messages, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
}

// ── Admin: responder a un usuario ─────────────────────────────────────────
async function adminSendMessage(req, res) {
  const { userId } = req.params;
  const body = (req.body.body || '').trim();
  if (!body && !req.file) {
    return res.status(400).json({ success: false, data: null, error: 'El mensaje no puede estar vacío' });
  }
  try {
    // Verificar que el usuario existe
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, data: null, error: 'Usuario no encontrado' });

    const { mediaUrl, mediaType } = await _uploadAttachment(req.file);
    const msg = await prisma.chatMessage.create({
      data: {
        userId,
        fromAdmin: true,
        body,
        mediaUrl,
        mediaType,
      },
    });

    // Crear notificación para el usuario
    const notifBody = body
      ? (body.length > 80 ? body.slice(0, 80) + '…' : body)
      : (mediaType === 'video' ? '📹 Video' : '📷 Imagen');
    await prisma.notification.create({
      data: {
        userId,
        type:  'ADMIN_MESSAGE',
        title: 'Mensaje del administrador',
        body:  notifBody,
      },
    });

    res.json({ success: true, data: msg, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
}

// ── Traducir un mensaje del chat (usuario o admin) ─────────────────────────
const TRANSLATE_LANGS = ['es', 'fr', 'pt', 'en'];

async function translateMessage(req, res) {
  const text = (req.body.text || '').trim();
  const target = req.body.target;
  if (!text) {
    return res.status(400).json({ success: false, data: null, error: 'Falta el texto a traducir' });
  }
  if (!TRANSLATE_LANGS.includes(target)) {
    return res.status(400).json({ success: false, data: null, error: 'Idioma de destino no soportado' });
  }
  if (text.length > 2000) {
    return res.status(400).json({ success: false, data: null, error: 'Texto demasiado largo para traducir' });
  }
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      return res.status(502).json({ success: false, data: null, error: 'Servicio de traducción no disponible' });
    }
    const json = await resp.json();
    const translatedText = Array.isArray(json[0])
      ? json[0].map((chunk) => (Array.isArray(chunk) ? chunk[0] : '')).join('')
      : '';
    const detectedLanguage = typeof json[2] === 'string' ? json[2] : null;
    res.json({ success: true, data: { translatedText, detectedLanguage }, error: null });
  } catch (e) {
    res.status(502).json({ success: false, data: null, error: 'No se pudo traducir el mensaje' });
  }
}

module.exports = {
  getMyMessages,
  sendMessage,
  unreadCount,
  adminListConversations,
  adminGetMessages,
  adminSendMessage,
  translateMessage,
};
