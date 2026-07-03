const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { signToken } = require('../utils/jwt');
const { ok, fail } = require('../utils/response');
const { upload: uploadFile, rewriteUrl, deleteFile } = require('../services/storage');
const fs = require('fs');
const subscriptionService = require('../services/subscriptionService');

function genReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase(); // ej: A3F7C291
}

// Plataformas de redes sociales admitidas en el perfil de artista
const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube', 'twitter', 'whatsapp'];

// Valida y normaliza el objeto de enlaces sociales recibido del cliente.
// Solo se aceptan URLs https:// de las plataformas conocidas; el resto se ignora.
// Lanza un Error con mensaje amigable si alguna URL presente es inválida.
// Devuelve, por cada plataforma presente en `input`, la URL normalizada o
// `null` si se envió vacía (indica que el artista quiere borrar ese enlace).
// Las plataformas ausentes en `input` no se tocan (permite updates parciales).
function sanitizeSocialLinks(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const out = {};
  for (const key of SOCIAL_PLATFORMS) {
    if (!(key in input)) continue;
    const val = input[key];
    const trimmed = typeof val === 'string' ? val.trim() : '';
    if (!trimmed) { out[key] = null; continue; }
    if (!/^https:\/\/[^\s]+$/i.test(trimmed)) {
      throw new Error(`El enlace de ${key} debe ser una URL https:// válida`);
    }
    out[key] = trimmed;
  }
  return out;
}

// ----- Validación -----
const registerSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(6).optional(),
  password: z.string().min(6),
  role: z.enum(['LISTENER', 'ARTIST']),
  username: z.string().min(3),
  country: z.string().default('Guinea Ecuatorial'),
  city: z.string().optional(),
  favoriteGenres: z.array(z.string()).optional(),
  // Solo artistas:
  artistName: z.string().optional(),
  realName: z.string().optional(),
  bio: z.string().optional(),
  referralCode: z.string().optional(),
}).refine((d) => d.email || d.phone, {
  message: 'Debes indicar email o teléfono',
});

// POST /api/auth/register
async function register(req, res) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed.error.errors[0].message);
  const d = parsed.data;

  if (d.role === 'ARTIST' && !d.artistName) {
    return fail(res, 'El nombre artístico es obligatorio para artistas');
  }

  // Unicidad
  const exists = await prisma.user.findFirst({
    where: { OR: [{ email: d.email }, { phone: d.phone }, { username: d.username }] },
  });
  if (exists) return fail(res, 'Email, teléfono o usuario ya registrado');

  const passwordHash = await bcrypt.hash(d.password, 10);

  const user = await prisma.user.create({
    data: {
      email: d.email,
      phone: d.phone,
      passwordHash,
      role: d.role,
      username: d.username,
      country: d.country,
      city: d.city,
      favoriteGenres: d.favoriteGenres || [],
      artistProfile: d.role === 'ARTIST'
        ? { create: { artistName: d.artistName, realName: d.realName, bio: d.bio } }
        : undefined,
    },
    include: { artistProfile: true },
  });

  // Oyente nuevo -> 1 mes gratis automático
  if (d.role === 'LISTENER') {
    await subscriptionService.createSubscription(user.id, 'LISTENER_FREE');
  }
  // Artista nuevo -> 30 días gratis automático para poder publicar desde el principio
  if (d.role === 'ARTIST') {
    await subscriptionService.createSubscription(user.id, 'ARTIST_FREE');
  }

  // Crear código de referido propio para el nuevo usuario
  let myCode = genReferralCode();
  let attempts = 0;
  while (attempts < 5) {
    try {
      await prisma.referral.create({ data: { code: myCode, referrerId: user.id } });
      break;
    } catch {
      myCode = genReferralCode();
      attempts++;
    }
  }

  // Referido (icono de regalo)
  if (d.referralCode) {
    const ref = await prisma.referral.findUnique({ where: { code: d.referralCode } });
    if (ref && !ref.referredId) {
      await prisma.referral.update({
        where: { id: ref.id },
        data: { referredId: user.id },
      });
    }
  }

  return respondWithAuth(req, res, user, 201);
}

// 30 días en ms — debe coincidir con JWT_EXPIRES_IN (backend/.env)
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Responde login/registro de dos formas distintas según el cliente:
//  - Flutter Web (petición con header Origin, viene de un navegador):
//    el JWT se guarda en una cookie HttpOnly + Secure + SameSite=Strict,
//    invisible para JavaScript — protege contra robo de token vía XSS.
//    El body NO incluye el token.
//  - APK (sin header Origin): el JWT va en el body JSON, como siempre;
//    la app lo guarda cifrado con flutter_secure_storage.
function respondWithAuth(req, res, user, statusCode = 200) {
  const token = signToken({ id: user.id, role: user.role });
  const isWeb = Boolean(req.headers.origin);

  if (isWeb) {
    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    });
    return ok(res, { user: sanitize(user) }, statusCode);
  }

  return ok(res, { token, user: sanitize(user) }, statusCode);
}

// POST /api/auth/logout — solo relevante para Flutter Web (borra la cookie);
// la APK simplemente descarta el token guardado localmente.
async function logout(req, res) {
  res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
  return ok(res, { loggedOut: true });
}

// POST /api/auth/login
async function login(req, res) {
  const { identifier, password } = req.body; // identifier = email o teléfono o username
  if (!identifier || !password) return fail(res, 'Faltan credenciales');

  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { phone: identifier }, { username: identifier }] },
    include: { artistProfile: true },
  });
  if (!user) return fail(res, 'Credenciales incorrectas', 401);
  if (user.deletedAt) return fail(res, 'Esta cuenta ha sido eliminada', 403);

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return fail(res, 'Credenciales incorrectas', 401);

  return respondWithAuth(req, res, user);
}

// GET /api/auth/me
async function me(req, res) {
  return ok(res, { user: sanitize(req.user) });
}

// POST /api/auth/fcm-token — registra/actualiza el token de notificaciones push del dispositivo
async function updateFcmToken(req, res) {
  const { token } = req.body;
  if (typeof token !== 'string' || !token.trim()) return fail(res, 'Falta el token');
  await prisma.user.update({
    where: { id: req.user.id },
    data: { fcmToken: token.trim() },
  });
  return ok(res, { saved: true });
}

// GET /api/auth/my-referral
async function myReferral(req, res) {
  let ref = await prisma.referral.findFirst({ where: { referrerId: req.user.id } });
  if (!ref) {
    let code = genReferralCode();
    let attempts = 0;
    while (attempts < 5) {
      try {
        ref = await prisma.referral.create({ data: { code, referrerId: req.user.id } });
        break;
      } catch {
        code = genReferralCode();
        attempts++;
      }
    }
  }
  return ok(res, { code: ref?.code ?? null });
}

// PUT /api/auth/profile
async function updateProfile(req, res) {
  const { username, country, city, artistName, bio, socialLinks } = req.body;
  const userId = req.user.id;

  if (username && username.length < 3) return fail(res, 'El nombre de usuario debe tener al menos 3 caracteres');
  if (username) {
    const taken = await prisma.user.findFirst({ where: { username, NOT: { id: userId } } });
    if (taken) return fail(res, 'Ese nombre de usuario ya está en uso');
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(username && { username }),
      ...(country && { country }),
      ...(city !== undefined && { city }),
    },
  });

  if (req.user.role === 'ARTIST' && (artistName || bio !== undefined || socialLinks !== undefined)) {
    let socialLinksData;
    if (socialLinks !== undefined) {
      let ops;
      try {
        ops = sanitizeSocialLinks(socialLinks);
      } catch (e) {
        return fail(res, e.message);
      }
      if (ops === undefined) return fail(res, 'Formato de enlaces sociales inválido');
      const current = await prisma.artistProfile.findUnique({ where: { userId }, select: { socialLinks: true } });
      const merged = { ...(current?.socialLinks || {}), ...ops };
      for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
      socialLinksData = merged;
    }

    await prisma.artistProfile.update({
      where: { userId },
      data: {
        ...(artistName && { artistName }),
        ...(bio !== undefined && { bio }),
        ...(socialLinksData !== undefined && { socialLinks: socialLinksData }),
      },
    });
  }

  const fresh = await prisma.user.findUnique({
    where: { id: userId },
    include: { artistProfile: true },
  });

  return ok(res, { user: sanitize(fresh) });
}

// POST /api/auth/change-password  — el usuario logueado cambia su propia contraseña
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return fail(res, 'Faltan campos');
  if (newPassword.length < 6) return fail(res, 'La nueva contraseña debe tener al menos 6 caracteres');

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return fail(res, 'La contraseña actual es incorrecta', 401);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });
  return ok(res, { changed: true });
}

// POST /api/auth/security-questions  — guarda/actualiza las 4 preguntas de seguridad
async function setSecurityQuestions(req, res) {
  try {
    const { questions } = req.body; // [{ question, answer }, ...]
    if (!Array.isArray(questions) || questions.length !== 4) {
      return fail(res, 'Se requieren exactamente 4 preguntas de seguridad');
    }
    for (const q of questions) {
      if (!q.question || !q.answer || q.answer.trim().length < 2) {
        return fail(res, 'Cada pregunta debe tener una respuesta de al menos 2 caracteres');
      }
    }
    const uniqueQs = new Set(questions.map(q => q.question));
    if (uniqueQs.size !== 4) return fail(res, 'Las 4 preguntas deben ser distintas');

    // Borrar las anteriores y crear las nuevas
    await prisma.securityQuestion.deleteMany({ where: { userId: req.user.id } });
    await prisma.securityQuestion.createMany({
      data: await Promise.all(questions.map(async (q) => ({
        userId: req.user.id,
        question: q.question,
        answerHash: await bcrypt.hash(q.answer.trim().toLowerCase(), 10),
      }))),
    });
    return ok(res, { saved: true });
  } catch (e) {
    return fail(res, 'Error al guardar preguntas de seguridad: ' + e.message, 500);
  }
}

// POST /api/auth/recover-password/challenge  — devuelve 1 pregunta aleatoria
async function recoverChallenge(req, res) {
  const { identifier } = req.body;
  if (!identifier) return fail(res, 'Indica email, teléfono o usuario');
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { phone: identifier }, { username: identifier }] },
  });
  if (!user) return fail(res, 'Usuario no encontrado', 404);
  const questions = await prisma.securityQuestion.findMany({ where: { userId: user.id } });
  if (!questions.length) return fail(res, 'Este usuario no tiene preguntas de seguridad configuradas');
  const q = questions[Math.floor(Math.random() * questions.length)];
  return ok(res, { userId: user.id, questionId: q.id, question: q.question });
}

// POST /api/auth/recover-password/verify  — verifica respuesta y cambia contraseña
async function recoverVerify(req, res) {
  const { userId, questionId, answer, newPassword } = req.body;
  if (!userId || !questionId || !answer || !newPassword) return fail(res, 'Faltan campos');
  if (newPassword.length < 6) return fail(res, 'La contraseña debe tener al menos 6 caracteres');

  const q = await prisma.securityQuestion.findFirst({ where: { id: questionId, userId } });
  if (!q) return fail(res, 'Pregunta no válida', 400);

  const valid = await bcrypt.compare(answer.trim().toLowerCase(), q.answerHash);
  if (!valid) return fail(res, 'Respuesta incorrecta', 401);

  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });
  return ok(res, { reset: true });
}

// GET /api/auth/artists  (solo ADMIN) — lista de artistas para el panel de subida
async function listArtists(req, res) {
  const artists = await prisma.user.findMany({
    where: { role: 'ARTIST' },
    select: {
      id: true,
      username: true,
      artistProfile: { select: { id: true, artistName: true } },
    },
    orderBy: { username: 'asc' },
  });
  return ok(res, { artists });
}

function sanitize(user) {
  const { passwordHash, ...rest } = user;
  // No reescribir data: URLs (base64 guardado en BD); solo reescribir URLs externas
  if (rest.avatarUrl && !rest.avatarUrl.startsWith('data:')) rest.avatarUrl = rewriteUrl(rest.avatarUrl);
  return rest;
}

// POST /api/auth/avatar  — sube/cambia foto de perfil
// Usa memoryStorage: el buffer llega en req.file.buffer (sin escribir al disco)
async function updateAvatar(req, res) {
  if (!req.file) return fail(res, 'No se recibió ninguna imagen');
  if (!req.file.mimetype.startsWith('image/')) {
    return fail(res, 'El archivo debe ser una imagen (JPG, PNG, WebP…)');
  }

  // Si el avatar anterior era un archivo en el CDN (de antes de guardar en base64),
  // lo borramos para no dejar huérfanos en R2 al reemplazarlo.
  const current = await prisma.user.findUnique({ where: { id: req.user.id }, select: { avatarUrl: true } });
  if (current?.avatarUrl && !current.avatarUrl.startsWith('data:')) {
    deleteFile(current.avatarUrl).catch(() => {});
  }

  // Guardar como data URL en la BD — persiste aunque Render reinicie el servidor
  const avatarUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

  await prisma.user.update({
    where: { id: req.user.id },
    data: { avatarUrl },
  });

  const fresh = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { artistProfile: true },
  });

  return ok(res, { user: sanitize(fresh), avatarUrl });
}

module.exports = { register, login, logout, me, myReferral, updateProfile, updateAvatar, listArtists, changePassword, setSecurityQuestions, recoverChallenge, recoverVerify, updateFcmToken };
