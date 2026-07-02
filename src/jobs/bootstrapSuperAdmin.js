// Designa automáticamente un "admin principal" (super admin) si todavía no existe
// ninguno. El super admin es el único que puede designar o quitar la función de
// administrador a otros usuarios. Se elige el usuario ADMIN más antiguo
// (normalmente el admin sembrado originalmente). Idempotente: si ya hay un
// super admin, no hace nada.

const prisma = require('../config/prisma');

async function run() {
  const existing = await prisma.user.findFirst({ where: { isSuperAdmin: true } });
  if (existing) {
    return { alreadyExists: true, superAdmin: { id: existing.id, username: existing.username } };
  }

  const oldestAdmin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
  });
  if (!oldestAdmin) {
    return { alreadyExists: false, superAdmin: null, message: 'No hay ningún usuario ADMIN todavía.' };
  }

  const updated = await prisma.user.update({
    where: { id: oldestAdmin.id },
    data: { isSuperAdmin: true },
  });

  return { alreadyExists: false, superAdmin: { id: updated.id, username: updated.username } };
}

module.exports = { run };
