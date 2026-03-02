const db = require('../_db');
const {
  generateCode, MAX_WAITLIST, BOOST_PER_REFERRAL,
  REWARD_MILESTONES, displayName, userPayload,
} = require('../_utils');

function findPosition(sortedUsers, userId) {
  for (let i = 0; i < sortedUsers.length; i++) {
    if (sortedUsers[i].id === userId) return i + 1;
  }
  return sortedUsers.length;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { full_name, email, phone, referral_code } = req.body;

    if (!email && !phone) return res.status(400).json({ error: 'Email or phone is required.' });
    if (!full_name || !full_name.trim()) return res.status(400).json({ error: 'Full name is required.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email format.' });

    const existingRows = await db.get(`waitlist_users?select=*&email=eq.${encodeURIComponent(email)}&limit=1`);
    if (existingRows.length > 0) {
      const existing = existingRows[0];
      const allUsers = await db.get('waitlist_users?select=id,boost_points,created_at&order=boost_points.desc,created_at.asc');
      const total = allUsers.length;
      const pos = findPosition(allUsers, existing.id);
      const rank = MAX_WAITLIST - total + pos;
      return res.json({ already_joined: true, ...userPayload(existing, rank, total) });
    }

    const allBefore = await db.get('waitlist_users?select=id');
    if (allBefore.length >= MAX_WAITLIST) return res.status(409).json({ error: 'Waitlist is full. Stay tuned for launch!' });

    let referrer = null;
    if (referral_code) {
      const refRows = await db.get(`waitlist_users?select=*&referral_code=eq.${encodeURIComponent(referral_code)}&limit=1`);
      referrer = refRows[0] || null;
      if (!referrer) return res.status(400).json({ error: 'Invalid referral code.' });
      if (referrer.email && referrer.email === email) return res.status(400).json({ error: 'You cannot refer yourself.' });
    }

    const newCode = generateCode();
    const inserted = await db.post('waitlist_users', {
      full_name: full_name.trim(),
      email: email || null,
      phone: phone || null,
      referral_code: newCode,
      referrer_id: referrer ? referrer.id : null,
    });
    const user = inserted[0];

    if (referrer) {
      try { await db.post('referrals', { referrer_id: referrer.id, referred_user_id: user.id }); } catch (_) {}
      await db.patch('waitlist_users', `id=eq.${referrer.id}`, {
        referral_count: referrer.referral_count + 1,
        boost_points: referrer.boost_points + BOOST_PER_REFERRAL,
      });

      const updatedRef = (await db.get(`waitlist_users?select=*&id=eq.${referrer.id}&limit=1`))[0];
      for (const m of REWARD_MILESTONES) {
        if (updatedRef.referral_count >= m.threshold) {
          const alreadyRows = await db.get(`reward_events?select=id&user_id=eq.${referrer.id}&type=eq.${encodeURIComponent(m.type)}&limit=1`);
          if (alreadyRows.length === 0) {
            await db.post('reward_events', { user_id: referrer.id, type: m.type, amount: m.credits });
            if (m.credits > 0) await db.patch('waitlist_users', `id=eq.${referrer.id}`, { credits_earned: updatedRef.credits_earned + m.credits });
            if (m.vip) await db.patch('waitlist_users', `id=eq.${referrer.id}`, { vip_badge: true });
          }
        }
      }
    }

    const freshUser = (await db.get(`waitlist_users?select=*&id=eq.${user.id}&limit=1`))[0];
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

    const response = { ...userPayload(freshUser, rank, total), leaderboard_preview: top10 };

    if (referrer) {
      const rr = (await db.get(`waitlist_users?select=*&id=eq.${referrer.id}&limit=1`))[0];
      const rPos = findPosition(allUsers, referrer.id);
      response.referrer_update = {
        referrer_new_rank: MAX_WAITLIST - total + rPos,
        referrer_boost_points: rr.boost_points,
        referrer_referral_count: rr.referral_count,
      };
    }

    return res.status(201).json(response);
  } catch (err) {
    console.error('JOIN ERROR:', err.message);
    if (err.message && err.message.includes('duplicate')) {
      return res.status(409).json({ error: 'This email is already on the waitlist.' });
    }
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
