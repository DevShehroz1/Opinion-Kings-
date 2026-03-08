const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../database');
const {
  generateCode,
  MAX_WAITLIST,
  BOOST_PER_REFERRAL,
  REWARD_MILESTONES,
  getNextReward,
} = require('../utils');
const { isDisposableEmail, rateLimit: secRateLimit, getClientIP } = require('../../api/_security');

const router = express.Router();

let stmts;
function prepareStatements() {
  if (stmts) return stmts;
  const db = getDb();

  stmts = {
    countUsers: db.prepare('SELECT COUNT(*) AS cnt FROM waitlist_users'),
    findByEmail: db.prepare('SELECT * FROM waitlist_users WHERE email = ?'),
    findByPhone: db.prepare('SELECT * FROM waitlist_users WHERE phone = ?'),
    findByCode: db.prepare('SELECT * FROM waitlist_users WHERE referral_code = ?'),
    findById: db.prepare('SELECT * FROM waitlist_users WHERE id = ?'),

    insertUser: db.prepare(`
      INSERT INTO waitlist_users (full_name, email, phone, referral_code, referrer_id, ip_address)
      VALUES (@full_name, @email, @phone, @referral_code, @referrer_id, @ip_address)
    `),

    insertReferral: db.prepare(`
      INSERT OR IGNORE INTO referrals (referrer_id, referred_user_id)
      VALUES (@referrer_id, @referred_user_id)
    `),

    bumpReferrer: db.prepare(`
      UPDATE waitlist_users
         SET referral_count = referral_count + 1,
             boost_points   = boost_points + @boost
       WHERE id = @id
    `),

    grantCredits: db.prepare(`
      UPDATE waitlist_users
         SET credits_earned = credits_earned + @credits
       WHERE id = @id
    `),

    grantVip: db.prepare(`
      UPDATE waitlist_users SET vip_badge = 1 WHERE id = @id
    `),

    hasReward: db.prepare(`
      SELECT 1 FROM reward_events WHERE user_id = @user_id AND type = @type LIMIT 1
    `),

    insertReward: db.prepare(`
      INSERT INTO reward_events (user_id, type, amount) VALUES (@user_id, @type, @amount)
    `),

    upsertLedger: db.prepare(`
      INSERT INTO credits_ledger (user_id, email, full_name, referral_code, referral_count, total_credits, vip_badge, last_updated)
      VALUES (@user_id, @email, @full_name, @referral_code, @referral_count, @total_credits, @vip_badge, strftime('%Y-%m-%dT%H:%M:%f','now'))
      ON CONFLICT(user_id) DO UPDATE SET
        referral_count = @referral_count,
        total_credits  = @total_credits,
        vip_badge      = @vip_badge,
        last_updated   = strftime('%Y-%m-%dT%H:%M:%f','now')
    `),

    insertShareClick: db.prepare(`
      INSERT INTO share_clicks (user_id, channel) VALUES (@user_id, @channel)
    `),

    findByIp: db.prepare(`
      SELECT id, referral_code FROM waitlist_users WHERE ip_address = ? ORDER BY id DESC LIMIT 10
    `),

    flagUser: db.prepare(`
      UPDATE waitlist_users SET flagged_reason = @reason WHERE id = @id
    `),

    // position = how many users are ahead of you + 1 (1 = best)
    positionOf: db.prepare(`
      SELECT COUNT(*) + 1 AS pos FROM waitlist_users
       WHERE boost_points > (SELECT boost_points FROM waitlist_users WHERE id = ?)
          OR (boost_points = (SELECT boost_points FROM waitlist_users WHERE id = ?)
              AND created_at < (SELECT created_at FROM waitlist_users WHERE id = ?))
    `),

    leaderboard: db.prepare(`
      SELECT id, full_name, email, phone, boost_points, referral_count, vip_badge, created_at
        FROM waitlist_users
       ORDER BY boost_points DESC, created_at ASC
       LIMIT ?
    `),
  };
  return stmts;
}

// position 1 = best → display rank #1. position N = worst → display rank #5000
// display_rank = MAX_WAITLIST - position + 1  (so #1 in position shows as #5000... no)
// Actually: user wants "start from 5000 downward". So the LAST person = #5000, best person = #1
// But with boosts you move UP (lower number). So display_rank = position directly.
// Wait re-reading: "start from 5000 to onward" means new signups start around #5000 and climb up.
// So: display_rank = MAX_WAITLIST + 1 - position.  position 1 (best) = #5000... no that's backwards.
// 
// Let me think: 5000 spots. You join, you're near the back = #5000. You get referrals, you climb
// toward #1. So: display_rank = total_users + 1 - position? No.
// Simplest: display_rank = MAX_WAITLIST - position + 1
// If position=1 (best) → rank = 5000. If position=5000 (worst) → rank = 1. That's INVERTED.
//
// Correct: position 1 = best = should show LOW number (close to #1 = front of line).
// "start from 5000" means when you first join with 0 boosts you're ~#5000.
// So display_rank = MAX_WAITLIST - (total - position) = MAX_WAITLIST - total + position
// When total=1, position=1 → rank = 5000 - 1 + 1 = 5000 ✓ (only person, at back)
// When total=100, position=1 (best) → rank = 5000 - 100 + 1 = 4901 ✓
// When total=100, position=100 (worst) → rank = 5000 - 100 + 100 = 5000 ✓
// This works! Lower rank number = closer to front.

function computeDisplayRank(userId, totalUsers) {
  const s = prepareStatements();
  const pos = s.positionOf.get(userId, userId, userId).pos;
  return MAX_WAITLIST - totalUsers + pos;
}

function displayName(user) {
  if (user.full_name && user.full_name.trim()) {
    const parts = user.full_name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return parts[0] + ' ' + parts[parts.length - 1][0] + '.';
    }
    return parts[0];
  }
  if (user.email) {
    return user.email.split('@')[0];
  }
  return 'Anonymous';
}

function userPayload(user, displayRank, totalUsers) {
  return {
    user_id: user.id,
    full_name: user.full_name,
    email: user.email,
    referral_code: user.referral_code,
    referral_link: `${process.env.BASE_URL || 'http://localhost:3001'}/waitlist.html?ref=${user.referral_code}`,
    rank: displayRank,
    total_users: totalUsers,
    referral_count: user.referral_count,
    boost_points: user.boost_points,
    credits_earned: user.credits_earned,
    vip_badge: !!user.vip_badge,
    next_reward: getNextReward(user.referral_count),
  };
}

function processRewards(referrer) {
  const s = prepareStatements();
  for (const m of REWARD_MILESTONES) {
    if (referrer.referral_count + 1 >= m.threshold) {
      const already = s.hasReward.get({ user_id: referrer.id, type: m.type });
      if (!already) {
        s.insertReward.run({ user_id: referrer.id, type: m.type, amount: m.credits });
        if (m.credits > 0) s.grantCredits.run({ credits: m.credits, id: referrer.id });
        if (m.vip) s.grantVip.run({ id: referrer.id });
      }
    }
  }
}

// ─── POST /api/waitlist/join ─────────────────────────────────────────
router.post('/join', (req, res) => {
  const s = prepareStatements();
  const db = getDb();
  const { full_name, email, phone, referral_code } = req.body;

  if (!email && !phone) {
    return res.status(400).json({ error: 'Email or phone is required.' });
  }
  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ error: 'Full name is required.' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }
  if (email && isDisposableEmail(email)) {
    return res.status(400).json({ error: 'Please use a permanent email address (temporary/disposable emails are not allowed).' });
  }

  const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';

  const existing = email ? s.findByEmail.get(email) : s.findByPhone.get(phone);
  if (existing) {
    const totalUsers = s.countUsers.get().cnt;
    const rank = computeDisplayRank(existing.id, totalUsers);
    return res.json({ already_joined: true, ...userPayload(existing, rank, totalUsers) });
  }

  const totalUsers = s.countUsers.get().cnt;
  if (totalUsers >= MAX_WAITLIST) {
    return res.status(409).json({ error: 'Waitlist is full. Stay tuned for launch!' });
  }

  let referrer = null;
  if (referral_code) {
    referrer = s.findByCode.get(referral_code);
    if (!referrer) {
      return res.status(400).json({ error: 'Invalid referral code.' });
    }
    if (referrer.email && referrer.email === email) {
      return res.status(400).json({ error: 'You cannot refer yourself.' });
    }
  }

  // Detect IP-based referral loops
  let flaggedReason = null;
  if (referrer && clientIp && clientIp !== 'unknown') {
    const sameIpUsers = s.findByIp.all(clientIp);
    if (sameIpUsers.some(u => u.referral_code === referral_code)) {
      flaggedReason = 'self_referral_ip';
    }
  }

  const newCode = generateCode();

  const joinTx = db.transaction(() => {
    const info = s.insertUser.run({
      full_name: full_name.trim(),
      email: email || null,
      phone: phone || null,
      referral_code: newCode,
      referrer_id: referrer ? referrer.id : null,
      ip_address: clientIp,
    });
    const newUserId = info.lastInsertRowid;

    if (flaggedReason) {
      s.flagUser.run({ reason: flaggedReason, id: newUserId });
    }

    if (referrer) {
      s.insertReferral.run({ referrer_id: referrer.id, referred_user_id: newUserId });
      s.bumpReferrer.run({ boost: BOOST_PER_REFERRAL, id: referrer.id });
      processRewards(referrer);

      // Upsert credits ledger for the referrer
      const updatedReferrer = s.findById.get(referrer.id);
      s.upsertLedger.run({
        user_id: updatedReferrer.id,
        email: updatedReferrer.email,
        full_name: updatedReferrer.full_name,
        referral_code: updatedReferrer.referral_code,
        referral_count: updatedReferrer.referral_count,
        total_credits: updatedReferrer.credits_earned,
        vip_badge: updatedReferrer.vip_badge,
      });
    }

    return newUserId;
  });

  try {
    const newUserId = joinTx();
    const user = s.findById.get(newUserId);
    const total = s.countUsers.get().cnt;
    const rank = computeDisplayRank(newUserId, total);

    const top10 = s.leaderboard.all(10).map((u, i) => ({
      rank: MAX_WAITLIST - total + i + 1,
      display_name: displayName(u),
      referrals: u.referral_count,
      boost_points: u.boost_points,
      badge: !!u.vip_badge,
    }));

    const response = {
      ...userPayload(user, rank, total),
      leaderboard_preview: top10,
    };

    if (referrer) {
      const referrerRefreshed = s.findById.get(referrer.id);
      const referrerRank = computeDisplayRank(referrer.id, total);
      response.referrer_update = {
        referrer_new_rank: referrerRank,
        referrer_boost_points: referrerRefreshed.boost_points,
        referrer_referral_count: referrerRefreshed.referral_count,
      };
    }

    return res.status(201).json(response);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'This email or phone is already on the waitlist.' });
    }
    throw err;
  }
});

// ─── GET /api/waitlist/me ────────────────────────────────────────────
router.get('/me', (req, res) => {
  const s = prepareStatements();
  const { user_id, email } = req.query;

  let user;
  if (user_id) {
    user = s.findById.get(Number(user_id));
  } else if (email) {
    user = s.findByEmail.get(email);
  }

  if (!user) {
    return res.status(404).json({ error: 'User not found on waitlist.' });
  }

  const totalUsers = s.countUsers.get().cnt;
  const rank = computeDisplayRank(user.id, totalUsers);

  const top10 = s.leaderboard.all(10).map((u, i) => ({
    rank: MAX_WAITLIST - totalUsers + i + 1,
    display_name: displayName(u),
    referrals: u.referral_count,
    boost_points: u.boost_points,
    badge: !!u.vip_badge,
  }));

  return res.json({
    ...userPayload(user, rank, totalUsers),
    leaderboard_preview: top10,
    progress_to_next_reward: getNextReward(user.referral_count),
  });
});

// ─── GET /api/waitlist/leaderboard ───────────────────────────────────
router.get('/leaderboard', (req, res) => {
  const s = prepareStatements();
  const limit = Math.min(Number(req.query.limit) || 50, 100);

  const rows = s.leaderboard.all(limit);
  const totalUsers = s.countUsers.get().cnt;

  const leaderboard = rows.map((u, i) => ({
    rank: MAX_WAITLIST - totalUsers + i + 1,
    display_name: displayName(u),
    referrals: u.referral_count,
    boost_points: u.boost_points,
    badge: !!u.vip_badge,
    joined: u.created_at,
  }));

  return res.json({ total_users: totalUsers, leaderboard });
});

// ─── Admin Auth Helpers (HMAC-SHA256) ────────────────────────────────
const ADMIN_TOKEN_EXPIRY = 24 * 60 * 60 * 1000;

function adminGenerateToken(email) {
  const secret = process.env.ADMIN_PASSWORD || '';
  const payload = JSON.stringify({ email: email.toLowerCase(), exp: Date.now() + ADMIN_TOKEN_EXPIRY });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function adminVerifyToken(token) {
  const secret = process.env.ADMIN_PASSWORD || '';
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (!adminEmails.includes(payload.email)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function adminRequireAuth(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = adminVerifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Unauthorized.' });
    return null;
  }
  return payload;
}

// ─── POST /api/waitlist/admin/login ──────────────────────────────────
router.post('/admin/login', (req, res) => {
  const ip = getClientIP(req);
  if (!secRateLimit(ip, 5, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!adminEmails.includes(email.toLowerCase()) || password !== (process.env.ADMIN_PASSWORD || '')) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const token = adminGenerateToken(email);
  const expires_at = new Date(Date.now() + ADMIN_TOKEN_EXPIRY).toISOString();
  return res.json({ token, email: email.toLowerCase(), expires_at });
});

// ─── GET /api/waitlist/admin/data ────────────────────────────────────
router.get('/admin/data', (req, res) => {
  const admin = adminRequireAuth(req, res);
  if (!admin) return;

  const db = getDb();

  const allUsers = db.prepare('SELECT * FROM waitlist_users ORDER BY boost_points DESC, created_at ASC').all();
  const totalUsers = allUsers.length;

  const referralChains = db.prepare('SELECT * FROM referrals ORDER BY created_at DESC').all();

  const rewardEvents = db.prepare('SELECT * FROM reward_events ORDER BY created_at DESC').all();

  const shareClicksDetail = db.prepare('SELECT * FROM share_clicks ORDER BY created_at DESC').all();

  const creditsLedger = db.prepare('SELECT * FROM credits_ledger ORDER BY total_credits DESC').all();

  let internationalSignups = [];
  try {
    internationalSignups = db.prepare('SELECT * FROM international_waitlist ORDER BY created_at DESC').all();
  } catch (_) {}

  // Derived data
  const flaggedUsers = allUsers.filter(u => u.flagged_reason);
  const vipUsers = allUsers.filter(u => u.vip_badge);
  const totalReferrals = allUsers.reduce((sum, u) => sum + (u.referral_count || 0), 0);
  const totalCreditsPending = creditsLedger
    .filter(l => l.status === 'pending')
    .reduce((sum, l) => sum + (l.total_credits || 0), 0);

  // Share stats by channel
  const shareStatsMap = {};
  shareClicksDetail.forEach(c => {
    shareStatsMap[c.channel] = (shareStatsMap[c.channel] || 0) + 1;
  });
  const shareStats = Object.entries(shareStatsMap).map(([channel, clicks]) => ({ channel, clicks }));

  // IP clusters
  const ipMap = {};
  allUsers.forEach(u => {
    if (u.ip_address) {
      if (!ipMap[u.ip_address]) ipMap[u.ip_address] = [];
      ipMap[u.ip_address].push(u.email || u.phone || `id:${u.id}`);
    }
  });
  const ipClusters = Object.entries(ipMap)
    .filter(([, emails]) => emails.length >= 3)
    .map(([ip_address, emails]) => ({ ip_address, cnt: emails.length, emails: emails.join(', ') }))
    .sort((a, b) => b.cnt - a.cnt)
    .slice(0, 50);

  // Signups by day
  const dayMap = {};
  allUsers.forEach(u => {
    const day = (u.created_at || '').slice(0, 10);
    if (day) dayMap[day] = (dayMap[day] || 0) + 1;
  });
  const signupsByDay = Object.entries(dayMap)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Top referrers
  const topReferrers = allUsers
    .filter(u => u.referral_count > 0)
    .sort((a, b) => b.referral_count - a.referral_count)
    .slice(0, 50);

  // Milestone distribution
  const milestoneDistribution = [
    { tier: '0 referrals', count: allUsers.filter(u => (u.referral_count || 0) === 0).length },
    { tier: '1+ referrals', count: allUsers.filter(u => (u.referral_count || 0) >= 1).length },
    { tier: '5+ referrals', count: allUsers.filter(u => (u.referral_count || 0) >= 5).length },
    { tier: '25+ referrals', count: allUsers.filter(u => (u.referral_count || 0) >= 25).length },
    { tier: '50+ referrals', count: allUsers.filter(u => (u.referral_count || 0) >= 50).length },
  ];

  // User lookup for enrichment
  const userMap = {};
  allUsers.forEach((u, i) => { userMap[u.id] = u; u._rank = i + 1; });

  const enrichedUsers = allUsers.map(u => ({
    ...u,
    referrer_email: u.referrer_id && userMap[u.referrer_id] ? userMap[u.referrer_id].email : null,
  }));

  const enrichedChains = referralChains.map(r => ({
    ...r,
    referrer_email: userMap[r.referrer_id] ? userMap[r.referrer_id].email : null,
    referrer_name: userMap[r.referrer_id] ? userMap[r.referrer_id].full_name : null,
    referred_email: userMap[r.referred_user_id] ? userMap[r.referred_user_id].email : null,
    referred_name: userMap[r.referred_user_id] ? userMap[r.referred_user_id].full_name : null,
  }));

  const enrichedRewards = rewardEvents.map(r => ({
    ...r,
    email: userMap[r.user_id] ? userMap[r.user_id].email : null,
    full_name: userMap[r.user_id] ? userMap[r.user_id].full_name : null,
  }));

  const enrichedClicks = shareClicksDetail.map(c => ({
    ...c,
    email: userMap[c.user_id] ? userMap[c.user_id].email : null,
    full_name: userMap[c.user_id] ? userMap[c.user_id].full_name : null,
  }));

  return res.json({
    overview: {
      total_users: totalUsers,
      spots_remaining: MAX_WAITLIST - totalUsers,
      total_referrals: totalReferrals,
      total_credits_pending: totalCreditsPending,
      flagged_count: flaggedUsers.length,
      vip_count: vipUsers.length,
      share_clicks: shareClicksDetail.length,
      international_count: internationalSignups.length,
    },
    all_users: enrichedUsers,
    referral_chains: enrichedChains,
    reward_events: enrichedRewards,
    share_clicks_detail: enrichedClicks,
    share_stats: shareStats,
    credits_ledger: creditsLedger,
    flagged_users: flaggedUsers,
    ip_clusters: ipClusters,
    signups_by_day: signupsByDay,
    international_signups: internationalSignups,
    top_referrers: topReferrers,
    milestone_distribution: milestoneDistribution,
  });
});

// ─── PATCH /api/waitlist/admin/ledger/:id ────────────────────────────
router.patch('/admin/ledger/:id', (req, res) => {
  const admin = adminRequireAuth(req, res);
  if (!admin) return;

  const db = getDb();
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Ledger entry id is required.' });

  const { status } = req.body || {};
  const allowed = ['pending', 'distributed', 'cancelled'];
  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ error: 'Status must be one of: pending, distributed, cancelled.' });
  }

  const result = db.prepare(
    `UPDATE credits_ledger SET status = ?, last_updated = strftime('%Y-%m-%dT%H:%M:%f','now') WHERE id = ?`
  ).run(status, id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Ledger entry not found.' });
  }

  return res.json({ ok: true });
});

// ─── GET /api/waitlist/admin/review (legacy) ─────────────────────────
router.get('/admin/review', (req, res) => {
  const db = getDb();
  const secret = req.query.secret;
  if (secret !== (process.env.ADMIN_SECRET || 'admin123')) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const totalUsers = db.prepare('SELECT COUNT(*) AS cnt FROM waitlist_users').get().cnt;

  const flaggedUsers = db.prepare(`
    SELECT id, full_name, email, referral_code, referral_count, ip_address, flagged_reason, created_at
    FROM waitlist_users WHERE flagged_reason IS NOT NULL ORDER BY id DESC
  `).all();

  const shareStats = db.prepare(`
    SELECT channel, COUNT(*) AS clicks FROM share_clicks GROUP BY channel
  `).all();

  const creditsLedger = db.prepare(`
    SELECT * FROM credits_ledger ORDER BY total_credits DESC
  `).all();

  const topReferrers = db.prepare(`
    SELECT id, full_name, email, referral_code, referral_count, credits_earned, vip_badge, ip_address
    FROM waitlist_users WHERE referral_count > 0 ORDER BY referral_count DESC LIMIT 20
  `).all();

  const ipClusters = db.prepare(`
    SELECT ip_address, COUNT(*) AS cnt, GROUP_CONCAT(email, ', ') AS emails
    FROM waitlist_users WHERE ip_address IS NOT NULL
    GROUP BY ip_address HAVING cnt >= 3 ORDER BY cnt DESC LIMIT 20
  `).all();

  return res.json({
    total_users: totalUsers,
    flagged_users: flaggedUsers,
    share_stats: shareStats,
    credits_ledger: creditsLedger,
    top_referrers: topReferrers,
    ip_clusters: ipClusters,
  });
});

// ─── POST /api/waitlist/share-click ──────────────────────────────────
router.post('/share-click', (req, res) => {
  const s = prepareStatements();
  const { user_id, channel } = req.body;

  if (!user_id || !channel) {
    return res.status(400).json({ error: 'user_id and channel are required.' });
  }

  const allowed = ['twitter', 'whatsapp', 'copy'];
  if (!allowed.includes(channel)) {
    return res.status(400).json({ error: 'Invalid channel.' });
  }

  const user = s.findById.get(Number(user_id));
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  s.insertShareClick.run({ user_id: user.id, channel });
  return res.json({ ok: true });
});

module.exports = router;
