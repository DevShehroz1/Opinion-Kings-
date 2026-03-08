const db = require('../_db');
const { requireAdmin } = require('../_adminAuth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const admin = requireAdmin(req, res);
  if (!admin) return;

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Ledger entry id is required.' });

  const { status } = req.body || {};
  const allowed = ['pending', 'distributed', 'cancelled'];
  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ error: 'Status must be one of: pending, distributed, cancelled.' });
  }

  try {
    const result = await db.patch(
      'credits_ledger',
      `id=eq.${id}`,
      { status, last_updated: new Date().toISOString() }
    );
    return res.json({ ok: true, updated: result });
  } catch (err) {
    console.error('ADMIN LEDGER UPDATE ERROR:', err.message);
    return res.status(500).json({ error: 'Failed to update ledger entry.' });
  }
};
