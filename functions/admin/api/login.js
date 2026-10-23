// sign in to /admin. Checks, in order:
//   1. the portal is set up (ADMIN_PASSWORD of 12+ characters, IP_SALT, TURNSTILE_SECRET, DB)
//   2. a json body from our own sign-in page
//   3. the lockout: 5 wrong passwords per network per 15 minutes, 30 in an hour from anywhere
//   4. turnstile with the "admin" action
//   5. the password, compared in constant time; every attempt is logged for the lockout
// a correct one sets the session cookie and marks this browser as yours, so your own visits
// stay out of the numbers.

import { json, readJson, hashIp } from '../../../lib/http.js';
import { verifyTurnstile } from '../../../lib/turnstile.js';
import { visitorId } from '../../../lib/visitor.js';
import { adminReady, passwordMatches, sessionCookie } from '../../../lib/admin.js';
import { redoFrom } from '../../../lib/rollup.js';

const PER_NETWORK = 5;
const PER_NETWORK_MS = 15 * 60 * 1000;
const EVERYWHERE = 30;
const EVERYWHERE_MS = 60 * 60 * 1000;

export async function onRequestPost({ request, env }) {
  if (!adminReady(env) || !env.TURNSTILE_SECRET) return json({ error: 'the admin password isn\'t set yet' }, 503);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'not allowed' }, 403);
  const { body, status } = await readJson(request, 4096);
  if (!body) return json({ error: 'bad request' }, status);

  const password = typeof body.password === 'string' ? body.password : '';
  const token = typeof body.token === 'string' ? body.token : '';
  if (!password || password.length > 256) return json({ error: 'wrong password' }, 401);
  if (!token || token.length > 2048) return json({ error: 'verification missing, try again' }, 400);

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ipHash = await hashIp(ip, env.IP_SALT);
  const now = Date.now();
  const [mine, all] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM admin_logins WHERE ok = 0 AND ip_hash = ?1 AND at > ?2')
      .bind(ipHash, new Date(now - PER_NETWORK_MS).toISOString()),
    env.DB.prepare('SELECT COUNT(*) AS n FROM admin_logins WHERE ok = 0 AND at > ?1')
      .bind(new Date(now - EVERYWHERE_MS).toISOString()),
  ]);
  if (mine.results[0].n >= PER_NETWORK || all.results[0].n >= EVERYWHERE) {
    return json({ error: 'too many tries, wait a bit' }, 429);
  }

  if (!(await verifyTurnstile(env, token, ip, 'admin'))) return json({ error: 'couldn\'t check you\'re a person, try again' }, 403);

  const ok = await passwordMatches(env, password);
  const iso = new Date(now).toISOString();
  const stmts = [env.DB.prepare('INSERT INTO admin_logins (at, ip_hash, ok) VALUES (?1, ?2, ?3)').bind(iso, ipHash, ok ? 1 : 0)];
  const vid = visitorId(request);
  if (ok && vid) {
    // the first time, this browser's visits so far leave the daily totals too
    stmts.push(redoFrom(env.DB, 'SELECT MIN(day) FROM sessions WHERE visitor_id = ?1 AND EXISTS (SELECT 1 FROM visitors WHERE id = ?1 AND me = 0)', vid));
    stmts.push(env.DB.prepare(
      `INSERT INTO visitors (id, first_seen, last_seen, ip_hash, me) VALUES (?1, ?2, ?2, ?3, 1)
       ON CONFLICT (id) DO UPDATE SET me = 1`
    ).bind(vid, iso, ipHash));
  }
  await env.DB.batch(stmts);
  if (!ok) return json({ error: 'wrong password' }, 401);
  return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(env) });
}
