const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Si JWT_SECRET no está configurado, NUNCA usar un valor fijo conocido
// ("dev_secret"): cualquiera que conociera ese string podría firmar tokens
// válidos para cualquier usuario. En su lugar, generar uno aleatorio al
// arrancar el proceso -- los tokens firmados con él siguen siendo válidos
// mientras el proceso no se reinicie, pero nadie externo puede adivinarlo
// ni forzar una sesión falsa. En producción (Render) JWT_SECRET siempre
// está configurado (ver render.yaml: generateValue: true), así que esto
// solo debería activarse en un entorno mal configurado.
const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('[jwt] JWT_SECRET no configurado -- usando un secreto aleatorio generado en este arranque. Configúralo como variable de entorno en producción.');
}
const EXPIRES = process.env.JWT_EXPIRES_IN || '30d';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { signToken, verifyToken };
