#!/usr/bin/env node
// Arranca el servidor inmediatamente para pasar el health check de Render,
// y luego ejecuta migraciones + RLS en segundo plano.

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const db = process.env.DATABASE_URL || '';
const dbOk = db.startsWith('postgresql://') || db.startsWith('postgres://');

if (!dbOk) {
  console.warn('[start:prod] ⚠ DATABASE_URL no configurada o invalida.');
  console.warn('[start:prod] ⚠ Ve a Render → Environment → agrega DATABASE_URL.');
}

// 1. Arrancar el servidor primero → el health check de Render pasa en segundos
require('../src/server.js');

// 2. Ejecutar migraciones + RLS en segundo plano SIN bloquear el proceso.
// IMPORTANTE: usar exec (asíncrono), no execSync — execSync bloquea todo el
// event loop mientras corre el comando, incluida la respuesta al health
// check de Render, así que si la migración tarda o se cuelga el servidor
// deja de responder por completo y el deploy se cae por timeout.
setTimeout(async () => {
  if (!dbOk) return;

  try {
    console.log('[start:prod] Ejecutando migraciones en background...');
    const { stdout } = await execAsync('npx prisma migrate deploy', {
      env: { ...process.env, PRISMA_MIGRATE_LOCK_TIMEOUT_MS: '30000' },
      timeout: 60000,
    });
    if (stdout) console.log(stdout);
    console.log('[start:prod] Migraciones completadas.');
  } catch (e) {
    console.warn('[start:prod] ⚠ Migraciones:', (e.message || '').split('\n')[0]);
    if (e.stdout) console.warn(e.stdout);
    if (e.stderr) console.warn(e.stderr);
  }

  try {
    const { stdout } = await execAsync('node scripts/setup-rls.js', { timeout: 45000 });
    if (stdout) console.log(stdout);
  } catch (e) {
    console.warn('[start:prod] ⚠ RLS (no crítico):', (e.message || '').split('\n')[0]);
  }
}, 3000); // 3 segundos → el servidor ya está escuchando antes de que empiecen las tareas
