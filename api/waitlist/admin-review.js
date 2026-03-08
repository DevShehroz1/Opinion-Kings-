const db = require('../_db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const allUsers = await db.get('waitlist_users?select=id');
    const totalUsers = allUsers.length;

    const flaggedUsers = await db.get(
      'waitlist_users?select=id,full_name,email,referral_code,referral_count,ip_address,flagged_reason,created_at&flagged_reason=not.is.null&order=id.desc'
    );

    let shareStats = [];
    try {
      const clicks = await db.get('share_clicks?select=channel');
      const counts = {};
      clicks.forEach(c => { counts[c.channel] = (counts[c.channel] || 0) + 1; });
      shareStats = Object.entries(counts).map(([channel, clicks]) => ({ channel, clicks }));
    } catch (_) {}

    let creditsLedger = [];
    try {
      creditsLedger = await db.get('credits_ledger?select=*&order=total_credits.desc');
    } catch (_) {}

    const topReferrers = await db.get(
      'waitlist_users?select=id,full_name,email,referral_code,referral_count,credits_earned,vip_badge,ip_address&referral_count=gt.0&order=referral_count.desc&limit=20'
    );

    return res.json({
      total_users: totalUsers,
      flagged_users: flaggedUsers,
      share_stats: shareStats,
      credits_ledger: creditsLedger,
      top_referrers: topReferrers,
    });
  } catch (err) {
    console.error('ADMIN REVIEW ERROR:', err.message);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
};
