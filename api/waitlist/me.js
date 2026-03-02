const db = require('../_db');
const { MAX_WAITLIST, getNextReward, displayName, userPayload } = require('../_utils');

function findPosition(sortedUsers, userId) {
  for (let i = 0; i < sortedUsers.length; i++) {
    if (sortedUsers[i].id === userId) return i + 1;
  }
  return sortedUsers.length;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user_id, email } = req.query;

    let user;
    if (user_id) {
      const rows = await db.get(`waitlist_users?select=*&id=eq.${Number(user_id)}&limit=1`);
      user = rows[0];
    } else if (email) {
      const rows = await db.get(`waitlist_users?select=*&email=eq.${encodeURIComponent(email)}&limit=1`);
      user = rows[0];
    }
    if (!user) return res.status(404).json({ error: 'User not found on waitlist.' });

    const allUsers = await db.get('waitlist_users?select=id,full_name,email,boost_points,referral_count,vip_badge,created_at&order=boost_points.desc,created_at.asc');
    const total = allUsers.length;
    const pos = findPosition(allUsers, user.id);
    const rank = MAX_WAITLIST - total + pos;

    const top10 = allUsers.slice(0, 10).map((u, i) => ({
      rank: MAX_WAITLIST - total + i + 1,
      display_name: displayName(u),
      referrals: u.referral_count,
      boost_points: u.boost_points,
      badge: !!u.vip_badge,
    }));

    return res.json({
      ...userPayload(user, rank, total),
      leaderboard_preview: top10,
      progress_to_next_reward: getNextReward(user.referral_count),
    });
  } catch (err) {
    console.error('ME ERROR:', err.message);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
};
