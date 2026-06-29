'use strict';
/**
 * Activa Row Level Security (RLS) en las tablas sensibles de PostgreSQL.
 * Ejecutar una sola vez: node scripts/setup-rls.js
 *
 * El usuario de Prisma (propietario de las tablas) sigue teniendo acceso total.
 * Cualquier otro usuario que consiga conectarse a la BD directamente verá
 * todas las tablas bloqueadas salvo que pase las políticas definidas.
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SENSITIVE_TABLES = [
  '"User"',
  '"SecurityQuestion"',
  '"ChatMessage"',
  '"Notification"',
  '"ArtistProfile"',
  '"Subscription"',
  '"Payment"',
  '"Play"',
  '"Download"',
  '"Playlist"',
  '"PlaylistItem"',
  '"Follow"',
  '"Referral"',
  '"MonthlyDistribution"',
  '"ArtistMonthlyEarning"',
];

async function main() {
  console.log('🔐 Activando Row Level Security…\n');

  for (const table of SENSITIVE_TABLES) {
    // 1. Habilitar RLS en la tabla
    await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    console.log(`  ✅ RLS habilitado en ${table}`);

    // 2. Política permisiva para el propietario (rol que usa Prisma)
    //    El nombre de la política incluye la tabla sin comillas para evitar conflictos.
    const policyName = `owner_all_${table.replace(/"/g, '')}`;
    const currentUser = await prisma.$queryRaw`SELECT current_user AS u`;
    const owner = currentUser[0].u;

    // Eliminar si ya existe (re-ejecutar el script es idempotente)
    await prisma.$executeRawUnsafe(
      `DROP POLICY IF EXISTS "${policyName}" ON ${table};`
    );
    await prisma.$executeRawUnsafe(
      `CREATE POLICY "${policyName}" ON ${table}
         FOR ALL
         TO "${owner}"
         USING (true)
         WITH CHECK (true);`
    );
    console.log(`  ✅ Política de acceso total para "${owner}" en ${table}\n`);
  }

  // Tablas públicas (canciones publicadas, perfiles de artista) — lectura libre
  const PUBLIC_READ = ['"Track"'];
  for (const table of PUBLIC_READ) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    const policyName = `public_read_${table.replace(/"/g, '')}`;
    await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS "${policyName}" ON ${table};`);
    await prisma.$executeRawUnsafe(
      `CREATE POLICY "${policyName}" ON ${table}
         FOR SELECT
         TO PUBLIC
         USING ("isPublished" = true);`
    );
    const ownerPolicy = `owner_all_${table.replace(/"/g, '')}`;
    const currentUser = await prisma.$queryRaw`SELECT current_user AS u`;
    const owner = currentUser[0].u;
    await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS "${ownerPolicy}" ON ${table};`);
    await prisma.$executeRawUnsafe(
      `CREATE POLICY "${ownerPolicy}" ON ${table}
         FOR ALL TO "${owner}" USING (true) WITH CHECK (true);`
    );
    console.log(`  ✅ RLS en ${table}: lectura pública (isPublished=true) + acceso total al propietario`);
  }

  console.log('\n🎉 RLS configurado correctamente.');
}

main()
  .catch(e => { console.error('❌ Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
