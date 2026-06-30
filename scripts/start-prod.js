#!/usr/bin/env node
const { execSync } = require('child_process');

const db = process.env.DATABASE_URL || '';
const dbOk = db.startsWith('postgresql://') || db.startsWith('postgres://');

if (dbOk) {
  console.log('[start:prod] Ejecutando migraciones...');
  try {
    // Timeout extra para el advisory lock de Neon (serverless puede tardar)
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      env: { ...process.env, PRISMA_MIGRATE_LOCK_TIMEOUT_MS: '30000' },
      timeout: 60000,
    });
    console.log('[start:prod] Migraciones completadas.');
  } catch (e) {
    // No matamos el proceso: si las migraciones ya estaban aplicadas
    // o Neon da timeout en el advisory lock, el servidor arranca igual.
    console.warn('[start:prod] ⚠ Migraciones con error (servidor arranca de todas formas):', e.message.split('\n')[0]);
  }
} else {
  console.warn('[start:prod] ⚠ DATABASE_URL no configurada o invalida.');
  console.warn('[start:prod] ⚠ Ve a Render → Environment → agrega DATABASE_URL.');
  console.warn('[start:prod] ⚠ El servidor arrancara pero las peticiones a la DB fallaran.');
}

require('../src/server.js');
