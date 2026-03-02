const { customAlphabet } = require('nanoid');

const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

const MAX_WAITLIST = 5000;
const BOOST_PER_REFERRAL = 100;

const REWARD_MILESTONES = [
  { threshold: 1,  type: 'BOOST_100',    credits: 0,     vip: false, label: 'Skip 100 spots' },
  { threshold: 5,  type: 'CREDITS_10',   credits: 1000,  vip: false, label: '$10 trading credits' },
  { threshold: 25, type: 'CREDITS_75',   credits: 7500,  vip: false, label: '$75 trading credits' },
  { threshold: 50, type: 'CREDITS_300',  credits: 30000, vip: true,  label: '$300 + VIP Founder badge' },
];

function getNextReward(referralCount) {
  for (const m of REWARD_MILESTONES) {
    if (referralCount < m.threshold) {
      return { referrals_needed: m.threshold - referralCount, reward: m.label };
    }
  }
  return { referrals_needed: 0, reward: 'All milestones unlocked!' };
}

function maskEmail(email) {
  if (!email) return 'Anonymous';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${local[1]}***@${domain}`;
}

module.exports = {
  generateCode,
  MAX_WAITLIST,
  BOOST_PER_REFERRAL,
  REWARD_MILESTONES,
  getNextReward,
  maskEmail,
};
