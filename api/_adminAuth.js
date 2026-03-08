const crypto = require('crypto');

const SECRET = process.env.ADMIN_PASSWORD || '';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

function generateToken(email) {
  const payload = JSON.stringify({ email: email.toLowerCase(), exp: Date.now() + TOKEN_EXPIRY });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyToken(token) {
  if (!token || !SECRET) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(b64).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    if (!ADMIN_EMAILS.includes(payload.email)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function requireAdmin(req, res) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Unauthorized.' });
    return null;
  }
  return payload;
}

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

function checkPassword(password) {
  return password === SECRET;
}

module.exports = { generateToken, verifyToken, requireAdmin, isAdminEmail, checkPassword };
