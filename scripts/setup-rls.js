'use strict';
/**
 * Activa Row Level Security (RLS) en las tablas sensibles de PostgreSQL.
 * Ejecutar una sola vez: node scripts/setup-rls.js
 * También se ejecuta automáticamente en cada arranque de producción
 * (scripts/start-prod.js) y puede volver a lanzarse bajo demanda desde el
 * panel admin (POST /api/admin/setup-rls) — es idempotente.
 *
 * El usuario de Prisma (propietario de las tablas) sigue teniendo acceso total.
 * Cualquier otro usuario que consiga conectarse a la BD directamente verá
 * todas las tablas bloqueadas salvo que pase las políticas definidas.
 */

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

// Tablas públicas (canciones publicadas) — lectura libre + acceso total al propietario
const PUBLIC_READ = ['"Track"'];

/**
 * Ejecuta la activación de RLS usando el cliente Prisma recibido.
 * Reutilizable tanto desde la CLI como desde el panel admin.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {(msg: string) => void} [log] - opcional, por defecto console.log
 */
async function run(prisma, log = console.log) {
  const results = { sensitiveTables: [], publicTables: [] };
  const currentUser = await prisma.$queryRaw`SELECT current_user AS u`;
  const owner = currentUser[0].u;

  for (const table of SENSITIVE_TABLES) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    const policyName = `owner_all_${table.replace(/"/g, '')}`;
    await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS "${policyName}" ON ${table};`);
    await prisma.$executeRawUnsafe(
      `CREATE POLICY "${policyName}" ON ${table}
         FOR ALL TO "${owner}" USING (true) WITH CHECK (true);`
    );
    log(`  ✅ RLS + política de acceso total para "${owner}" en ${table}`);
    results.sensitiveTables.push(table);
  }

  for (const table of PUBLIC_READ) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    const readPolicy = `public_read_${table.replace(/"/g, '')}`;
    await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS "${readPolicy}" ON ${table};`);
    await prisma.$executeRawUnsafe(
      `CREATE POLICY "${readPolicy}" ON ${table}
         FOR SELECT TO PUBLIC USING ("isPublished" = true);`
    );
    const ownerPolicy = `owner_all_${table.replace(/"/g, '')}`;
    await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS "${ownerPolicy}" ON ${table};`);
    await prisma.$executeRawUnsafe(
      `CREATE POLICY "${ownerPolicy}" ON ${table}
         FOR ALL TO "${owner}" USING (true) WITH CHECK (true);`
    );
    log(`  ✅ RLS en ${table}: lectura pública (isPublished=true) + acceso total al propietario`);
    results.publicTables.push(table);
  }

  return { owner, ...results };
}

module.exports = { run, SENSITIVE_TABLES, PUBLIC_READ };

// Ejecución directa por CLI: node scripts/setup-rls.js
if (require.main === module) {
  require('dotenv').config();
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  console.log('🔐 Activando Row Level Security…\n');
  run(prisma)
    .then(() => console.log('\n🎉 RLS configurado correctamente.'))
    .catch(e => { console.error('❌ Error:', e.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
