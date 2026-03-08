const db = require('./_db');
const { getClientIP, rateLimit } = require('./_security');

const ALLOWED_ORIGINS = [
  'https://www.opinionkings.com',
  'https://opinionkings.com',
  'http://localhost:3000',
];
const PX_TOKEN = 'oK9x4Rz2qW7v';

module.exports = async function handler(req, res) {
  const origin = req.headers['origin'] || '';
  const allowedOrigin = ALLOWED_ORIGINS.find(o => o === origin) || ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(404).end();

  try {
    const { tk, page_path, referrer, user_agent, screen_w, screen_h, session_id } = req.body || {};

    // Reject if token is missing or wrong
    if (tk !== PX_TOKEN) return res.status(404).end();

    // Validate origin header — block requests with no origin or unknown origin
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return res.status(200).end();

    const ip = getClientIP(req);
    if (!rateLimit(ip, 30, 60000)) return res.status(200).end();

    if (!page_path || !session_id) return res.status(200).end();

    const country = req.headers['x-vercel-ip-country'] || null;

    await db.post('page_views', {
      page_path: String(page_path).slice(0, 500),
      referrer: referrer ? String(referrer).slice(0, 1000) : null,
      user_agent: user_agent ? String(user_agent).slice(0, 500) : null,
      screen_w: typeof screen_w === 'number' ? screen_w : null,
      screen_h: typeof screen_h === 'number' ? screen_h : null,
      session_id: String(session_id).slice(0, 64),
      ip_address: ip,
      country: country,
    });
  } catch (_) {
    // fire-and-forget
  }

  return res.status(200).json({ ok: true });
};
