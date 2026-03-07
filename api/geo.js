module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const country = req.headers['x-vercel-ip-country'] || 'US';

  return res.status(200).json({
    country: country,
    is_usa: country === 'US',
  });
};
