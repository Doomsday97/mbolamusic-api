#!/usr/bin/env node
// Arranca el servidor inmediatamente para pasar el health check de Render,
// y luego ejecuta migraciones + RLS en segundo plano.

const { execSync } = require('child_process');

const db = process.env.DATABASE_URL || '';
const dbOk = db.startsWith('postgresql://') || db.startsWith('postgres://');

if (!dbOk) {
  console.warn('[start:prod] ⚠ DATABASE_URL no configurada o invalida.');
  console.warn('[start:prod] ⚠ Ve a Render → Environment → agrega DATABASE_URL.');
}

// 1. Arrancar el servidor primero → el health check de Render pasa en segundos
require('../src/server.js');

// 2. Ejecutar migraciones + RLS en segundo plano sin bloquear el proceso
setTimeout(() => {
  if (!dbOk) return;

  try {
    console.log('[start:prod] Ejecutando migraciones en background...');
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      env: { ...process.env, PRISMA_MIGRATE_LOCK_TIMEOUT_MS: '30000' },
      timeout: 60000,
    });
    console.log('[start:prod] Migraciones completadas.');
  } catch (e) {
    console.warn('[start:prod] ⚠ Migraciones:', e.message.split('\n')[0]);
  }

  try {
    execSync('node scripts/setup-rls.js', { stdio: 'inherit', timeout: 45000 });
  } catch (e) {
    console.warn('[start:prod] ⚠ RLS (no crítico):', e.message.split('\n')[0]);
  }
}, 3000); // 3 segundos → el servidor ya está escuchando antes de que empiecen las tareas
