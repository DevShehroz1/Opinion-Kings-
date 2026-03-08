const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function headers(prefer) {
  const h = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) h['Prefer'] = prefer;
  return h;
}

async function get(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function post(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers('return=representation'),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`POST ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function patch(table, filter, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: headers('return=representation'),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`PATCH ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function upsert(table, data, onConflict) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers('return=representation,resolution=merge-duplicates'),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`UPSERT ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

module.exports = { get, post, patch, upsert };
