#!/usr/bin/env node
const { execSync } = require('child_process');

const db = process.env.DATABASE_URL || '';
const dbOk = db.startsWith('postgresql://') || db.startsWith('postgres://');

if (dbOk) {
  console.log('[start:prod] Ejecutando migraciones...');
  try {
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('[start:prod] Migraciones completadas.');
  } catch (e) {
    console.error('[start:prod] ERROR en migraciones:', e.message);
    process.exit(1);
  }
} else {
  console.warn('[start:prod] ⚠ DATABASE_URL no configurada o invalida.');
  console.warn('[start:prod] ⚠ Ve a Render → Environment → agrega DATABASE_URL.');
  console.warn('[start:prod] ⚠ El servidor arrancara pero las peticiones a la DB fallaran.');
}

require('../src/server.js');
