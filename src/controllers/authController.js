const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { signToken } = require('../utils/jwt');
const { ok, fail } = require('../utils/response');
const subscriptionService = require('../services/subscriptionService');

function genReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase(); // ej: A3F7C291
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

  const token = signToken({ id: user.id, role: user.role });
  return ok(res, { token, user: sanitize(user) }, 201);
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

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return fail(res, 'Credenciales incorrectas', 401);

  const token = signToken({ id: user.id, role: user.role });
  return ok(res, { token, user: sanitize(user) });
}

// GET /api/auth/me
async function me(req, res) {
  return ok(res, { user: sanitize(req.user) });
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

function sanitize(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

module.exports = { register, login, me, myReferral };
