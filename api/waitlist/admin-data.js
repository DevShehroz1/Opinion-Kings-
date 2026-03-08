const db = require('../_db');
const { requireAdmin } = require('../_adminAuth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = requireAdmin(req, res);
  if (!admin) return;

  try {
    // All users with all columns
    const allUsers = await db.get(
      'waitlist_users?select=*&order=boost_points.desc,created_at.asc'
    );
    const totalUsers = allUsers.length;

    // Referral chains — who referred whom
    const referralChains = await db.get(
      'referrals?select=id,referrer_id,referred_user_id,created_at,status'
    );

    // Reward events
    let rewardEvents = [];
    try {
      rewardEvents = await db.get('reward_events?select=*&order=created_at.desc');
    } catch (_) {}

    // Share clicks detail
    let shareClicksDetail = [];
    try {
      shareClicksDetail = await db.get('share_clicks?select=*&order=created_at.desc');
    } catch (_) {}

    // Credits ledger
    let creditsLedger = [];
    try {
      creditsLedger = await db.get('credits_ledger?select=*&order=total_credits.desc');
    } catch (_) {}

    // International signups
    let internationalSignups = [];
    try {
      internationalSignups = await db.get('international_waitlist?select=*&order=created_at.desc');
    } catch (_) {}

    // Compute derived data
    const flaggedUsers = allUsers.filter(u => u.flagged_reason);
    const vipUsers = allUsers.filter(u => u.vip_badge);
    const totalReferrals = allUsers.reduce((sum, u) => sum + (u.referral_count || 0), 0);
    const totalCreditsPending = creditsLedger
      .filter(l => l.status === 'pending')
      .reduce((sum, l) => sum + (l.total_credits || 0), 0);

    // Share stats aggregated by channel
    const shareStatsMap = {};
    shareClicksDetail.forEach(c => {
      shareStatsMap[c.channel] = (shareStatsMap[c.channel] || 0) + 1;
    });
    const shareStats = Object.entries(shareStatsMap).map(([channel, clicks]) => ({ channel, clicks }));

    // IP clusters (3+ signups)
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

    // Build user lookup for referrer info
    const userMap = {};
    allUsers.forEach((u, i) => {
      userMap[u.id] = u;
      u._rank = i + 1;
    });

    // Add referrer email to each user
    const enrichedUsers = allUsers.map(u => ({
      ...u,
      referrer_email: u.referrer_id && userMap[u.referrer_id] ? userMap[u.referrer_id].email : null,
    }));

    // Enrich referral chains
    const enrichedChains = referralChains.map(r => ({
      ...r,
      referrer_email: userMap[r.referrer_id] ? userMap[r.referrer_id].email : null,
      referrer_name: userMap[r.referrer_id] ? userMap[r.referrer_id].full_name : null,
      referred_email: userMap[r.referred_user_id] ? userMap[r.referred_user_id].email : null,
      referred_name: userMap[r.referred_user_id] ? userMap[r.referred_user_id].full_name : null,
    }));

    // Enrich reward events
    const enrichedRewards = rewardEvents.map(r => ({
      ...r,
      email: userMap[r.user_id] ? userMap[r.user_id].email : null,
      full_name: userMap[r.user_id] ? userMap[r.user_id].full_name : null,
    }));

    // Enrich share clicks
    const enrichedClicks = shareClicksDetail.map(c => ({
      ...c,
      email: userMap[c.user_id] ? userMap[c.user_id].email : null,
      full_name: userMap[c.user_id] ? userMap[c.user_id].full_name : null,
    }));

    return res.json({
      overview: {
        total_users: totalUsers,
        spots_remaining: 5000 - totalUsers,
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
  } catch (err) {
    console.error('ADMIN DATA ERROR:', err.message);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
};
