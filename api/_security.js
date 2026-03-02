const DISPOSABLE_DOMAINS = new Set([
  'tempmail.com','throwaway.email','guerrillamail.com','mailinator.com',
  'yopmail.com','temp-mail.org','fakeinbox.com','sharklasers.com',
  'guerrillamailblock.com','grr.la','dispostable.com','trashmail.com',
  '10minutemail.com','tempail.com','burnermail.io','maildrop.cc',
  'harakirimail.com','mailnesia.com','guerrillamail.info','guerrillamail.net',
  'guerrillamail.de','mailcatch.com','tempr.email','discard.email',
  'discardmail.com','mailexpire.com','throwam.com','trashmail.me',
  'trashmail.net','receiveee.com','emailondeck.com','getairmail.com',
  'mailforspam.com','safetymail.info','tempomail.fr','getnada.com',
  'tempinbox.com','mailtemp.info','mohmal.com','emailfake.com',
  'crazymailing.com','tmail.io','tmpmail.net','tmpmail.org',
  'bupmail.com','emailtemp.org','mail-temp.com','guerrillamail.biz',
  'mintemail.com','tempmailo.com','mailtothis.com','temp-mail.io',
  'one-time.email','mytemp.email','emailnax.com','spamgourmet.com',
  'filzmail.com','zetmail.com','inboxbear.com','spamfree24.org',
  'mailnull.com','antispam.de','trashymail.com','mailzilla.com',
  'nospamfor.us','tempmailaddress.com','temp-mail.de','wegwerfmail.de',
  'wegwerfmail.net','spoofmail.de','meltmail.com','spaml.com',
  'trashinbox.com','incognitomail.org','deadfake.com','sogetthis.com',
  'einrot.com','tempsky.com','lroid.com','boximail.com','cool.fr.nf',
  'jetable.fr.nf','courriel.fr.nf','moncourrier.fr.nf','speed.1s.fr',
  'jourrapide.com','gelitik.in','example.com','test.com','mailinator.net',
  'guerrillamail.org','spam4.me','byom.de','trash-mail.com','yopmail.fr',
  'yopmail.net','nospam.ze.tc','kurzepost.de','objectmail.com',
  'proxymail.eu','rcpt.at','armyspy.com','cuvox.de','dayrep.com',
  'einrot.de','fleckens.hu','gustr.com','jourrapide.net','rhyta.com',
  'superrito.com','teleworm.us',
]);

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function isDisposableEmail(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? DISPOSABLE_DOMAINS.has(domain) : true;
}

function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false;
  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)) return false;
  const domain = email.split('@')[1];
  if (domain.length > 253) return false;
  const parts = domain.split('.');
  if (parts.some(p => p.length > 63 || p.length === 0)) return false;
  return true;
}

function validateName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 100) return false;
  if (/[<>{}()\[\]\\\/;`~|$]/.test(trimmed)) return false;
  if (/^\d+$/.test(trimmed)) return false;
  return true;
}

function checkHoneypot(body) {
  return !!body._hp;
}

function checkTimestamp(body) {
  const ts = Number(body._ts);
  if (!ts || isNaN(ts)) return false;
  if (ts < 1700000000000 || ts > 2000000000000) return false;
  return true;
}

const ipBuckets = new Map();

function rateLimit(ip, maxPerWindow, windowMs) {
  const now = Date.now();
  const key = ip;
  if (!ipBuckets.has(key)) ipBuckets.set(key, []);
  const bucket = ipBuckets.get(key).filter(t => now - t < windowMs);
  if (bucket.length >= maxPerWindow) return false;
  bucket.push(now);
  ipBuckets.set(key, bucket);
  if (ipBuckets.size > 10000) {
    for (const [k, v] of ipBuckets) {
      if (v.every(t => now - t > windowMs)) ipBuckets.delete(k);
    }
  }
  return true;
}

module.exports = {
  getClientIP,
  isDisposableEmail,
  validateEmail,
  validateName,
  checkHoneypot,
  checkTimestamp,
  rateLimit,
};
