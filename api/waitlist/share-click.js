const db = require('../_db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user_id, channel } = req.body;

    if (!user_id || !channel) {
      return res.status(400).json({ error: 'user_id and channel are required.' });
    }

    const allowed = ['twitter', 'whatsapp', 'copy'];
    if (!allowed.includes(channel)) {
      return res.status(400).json({ error: 'Invalid channel.' });
    }

    const rows = await db.get(`waitlist_users?select=id&id=eq.${Number(user_id)}&limit=1`);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await db.post('share_clicks', { user_id: Number(user_id), channel });
    return res.json({ ok: true });
  } catch (err) {
    console.error('SHARE-CLICK ERROR:', err.message);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
};
