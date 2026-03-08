const db = require('../_db');
const { requireAdmin } = require('../_adminAuth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
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

    // Page views
    let pageViews = [];
    try {
      pageViews = await db.get('page_views?select=id,page_path,referrer,screen_w,session_id,created_at&order=created_at.desc&limit=10000');
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

    // ─── Page Views Analytics ───
    const todayStr = new Date().toISOString().slice(0, 10);
    const pvSessions = new Set();
    const pvByDay = {};
    const pvByPage = {};
    const pvByReferrer = {};
    const pvScreenBuckets = { mobile: 0, tablet: 0, desktop: 0 };

    pageViews.forEach(pv => {
      pvSessions.add(pv.session_id);
      const day = (pv.created_at || '').slice(0, 10);
      if (day) pvByDay[day] = (pvByDay[day] || 0) + 1;

      if (!pvByPage[pv.page_path]) pvByPage[pv.page_path] = { views: 0, sessions: new Set() };
      pvByPage[pv.page_path].views++;
      pvByPage[pv.page_path].sessions.add(pv.session_id);

      let source = '(direct)';
      if (pv.referrer) {
        try { source = new URL(pv.referrer).hostname; } catch (_) { source = pv.referrer; }
      }
      if (!pvByReferrer[source]) pvByReferrer[source] = 0;
      pvByReferrer[source]++;

      if (pv.screen_w != null) {
        if (pv.screen_w < 768) pvScreenBuckets.mobile++;
        else if (pv.screen_w <= 1024) pvScreenBuckets.tablet++;
        else pvScreenBuckets.desktop++;
      }
    });

    const viewsToday = pvByDay[todayStr] || 0;
    const uniqueVisitors = pvSessions.size;
    const pagesPerVisitor = uniqueVisitors > 0 ? +(pageViews.length / uniqueVisitors).toFixed(1) : 0;

    const viewsByDay = Object.entries(pvByDay)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const topPages = Object.entries(pvByPage)
      .map(([page, d]) => ({ page, views: d.views, unique: d.sessions.size }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 30);

    const topReferrers_pv = Object.entries(pvByReferrer)
      .map(([source, count]) => ({ source, count, pct: pageViews.length > 0 ? +((count / pageViews.length) * 100).toFixed(1) : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const visitors = {
      total_views: pageViews.length,
      unique_visitors: uniqueVisitors,
      views_today: viewsToday,
      pages_per_visitor: pagesPerVisitor,
      views_by_day: viewsByDay,
      top_pages: topPages,
      top_referrers: topReferrers_pv,
      screen_buckets: pvScreenBuckets,
    };

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
      visitors: visitors,
    });
  } catch (err) {
    console.error('ADMIN DATA ERROR:', err.message);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
};
