// hesh.ca/signup posts here, the only way into the signup list. Checks, in order:
//   1. a json body from our own page, capped at 4 KB
//   2. the fields: name, email, optional phone (cheap, and a typo shouldn't burn the turnstile token)
//   3. turnstile siteverify, fail closed: success, the "signup" action and one of our hostnames
//   4. at most 30 signups per network per 10 minutes, counted only once a person is proven
//      (generous because everyone at a jam shares the house wifi)
//   5. upsert by email into D1 (hesh-signups)
// every refusal is { error, code } so the page can say what went wrong.
// same origin only: the page calls this with a relative url, so no cors headers.

const MAX_BODY = 4096;
const ACTION = 'signup';
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9 +().-]{7,25}$/;
const SOURCE = /^[a-z0-9_-]{1,40}$/i;
const VISITOR = /^[\w-]{1,64}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function fail(code, error, status) {
  return json({ error, code }, status);
}

function field(v) {
  return typeof v === 'string' ? v.trim() : '';
}

async function verifyTurnstile(env, token, ip) {
  let result;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    if (!res.ok) return false;
    result = await res.json();
  } catch {
    return false;
  }
  if (!result.success) return false;
  // local dev only (.dev.vars): turnstile's published test keys answer from example.com with no action
  if (env.ALLOW_TEST_KEYS === '1' && result.metadata && result.metadata.result_with_testing_key === true) return true;
  const hosts = (env.TURNSTILE_HOSTNAMES || '').split(',').map((h) => h.trim()).filter(Boolean);
  return result.action === ACTION && hosts.includes(result.hostname);
}

async function hashIp(ip, salt) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + ip));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  // fail closed: without the secret, the salt or the database nobody signs up
  if (!env.TURNSTILE_SECRET || !env.IP_SALT || !env.DB) return fail('config', 'signups are not set up', 503);

  // 1. body
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return fail('origin', 'not allowed', 403);
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return fail('invalid', 'send json', 415);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return fail('invalid', 'too big', 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return fail('invalid', 'too big', 413);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail('invalid', 'body must be json', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('invalid', 'body must be an object', 400);

  // 2. fields
  const name = field(body.name);
  const email = field(body.email).toLowerCase();
  const phone = field(body.phone);
  if (!name || name.length > 80) return fail('name', 'add your name', 400);
  if (email.length > 120 || !EMAIL.test(email)) return fail('email', 'that email doesn\'t look right', 400);
  if (phone && !PHONE.test(phone)) return fail('phone', 'that phone number doesn\'t look right', 400);
  const source = typeof body.source === 'string' && SOURCE.test(body.source) ? body.source : 'site';
  const instagram = body.instagram === true ? 1 : 0;
  const visitorId = typeof body.visitorId === 'string' && VISITOR.test(body.visitorId) ? body.visitorId : null;
  const token = typeof body.token === 'string' ? body.token : '';
  if (!token || token.length > 2048) return fail('turnstile', 'verification missing, try again', 400);

  // 3. turnstile
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await verifyTurnstile(env, token, ip))) return fail('turnstile', 'couldn\'t check you\'re a person, try again', 403);

  // 4. per-network limit
  const ipHash = await hashIp(ip, env.IP_SALT);
  const now = new Date();
  try {
    const since = new Date(now.getTime() - RATE_WINDOW_MS).toISOString();
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM signups WHERE ip_hash = ?1 AND updated_at > ?2').bind(ipHash, since).first();
    if (recent && recent.n >= RATE_LIMIT) return fail('rate', 'lots of signups from here, try again in a few minutes', 429);

    // 5. save; signing up again with the same email updates the row and keeps a phone given earlier
    const row = await env.DB.prepare(
      `INSERT INTO signups (id, name, email, phone, source, instagram, visitor_id, ip_hash, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
       ON CONFLICT (email) DO UPDATE SET
         name = excluded.name,
         phone = COALESCE(excluded.phone, signups.phone),
         source = excluded.source,
         instagram = MAX(signups.instagram, excluded.instagram),
         visitor_id = COALESCE(excluded.visitor_id, signups.visitor_id),
         ip_hash = excluded.ip_hash,
         updated_at = excluded.updated_at
       RETURNING id`
    ).bind(crypto.randomUUID(), name, email, phone || null, source, instagram, visitorId, ipHash, now.toISOString()).first();
    return json({ ok: true, id: row.id });
  } catch (err) {
    console.error('[signup] d1 error:', err && err.message);
    return fail('server', 'couldn\'t save that, try again', 500);
  }
}
