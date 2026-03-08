const { generateToken, isAdminEmail, checkPassword } = require('../_adminAuth');
const { rateLimit, getClientIP } = require('../_security');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIP(req);
  if (!rateLimit(ip, 5, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  if (!isAdminEmail(email) || !checkPassword(password)) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const token = generateToken(email);
  const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  return res.json({ token, email: email.toLowerCase(), expires_at });
};
