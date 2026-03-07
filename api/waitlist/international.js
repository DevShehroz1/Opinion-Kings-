const db = require('../_db');
const {
  getClientIP, isDisposableEmail, validateEmail, rateLimit,
} = require('../_security');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const ip = getClientIP(req);

    if (!rateLimit(ip, 5, 3600000)) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }

    const { email } = req.body;
    const cleanEmail = email ? email.trim().toLowerCase() : null;

    if (!cleanEmail || !validateEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (isDisposableEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Please use a permanent email address.' });
    }

    const country = req.headers['x-vercel-ip-country'] || 'UNKNOWN';

    // Check for existing submission
    const existing = await db.get(
      `international_waitlist?select=id,email&email=eq.${encodeURIComponent(cleanEmail)}&limit=1`
    );
    if (existing.length > 0) {
      return res.status(200).json({
        already_registered: true,
        message: "You're already on the list! We are currently operating in the USA only. We'll let you know through email when we start operating in your country."
      });
    }

    // Insert into database
    await db.post('international_waitlist', {
      email: cleanEmail,
      country_code: country,
      ip_address: ip,
    });

    return res.status(201).json({
      success: true,
      message: "We are currently operating in the USA only. We'll let you know through email when we start operating in your country."
    });
  } catch (err) {
    console.error('INTERNATIONAL JOIN ERROR:', err.message);
    if (err.message && err.message.includes('duplicate')) {
      return res.status(200).json({
        already_registered: true,
        message: "You're already on the list! We are currently operating in the USA only. We'll let you know through email when we start operating in your country."
      });
    }
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
