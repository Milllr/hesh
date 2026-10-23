// the page beacon (public/t.js posts here). One request carries a batch of what happened
// on a page: the view, sections read, scroll depth, clicks, video, the snow gun, the form.
// it never answers with data, and refuses quietly: tracking must never break the page.
//
// batch: { s: session id, p: path, k: ms since the visit started, m: page details (once a page),
//          e: [{ t, l, v, k }], a: engaged ms since the last batch, x: max scroll %, i: 1 once they interacted }
// an event's k is when it happened, in ms since the visit started, by the page's clock.
//
// a batch is one write: the visit's row gets the events added to its log and its counters
// bumped, in one upsert. The visitor row is written at most once a visit, when a page opens.

import { readJson, clip, hashIp } from '../../lib/http.js';
import { visitorId, visitorCookie, place, device, sourceOf, BOT_UA } from '../../lib/visitor.js';
import { isAdmin } from '../../lib/admin.js';
import { localDay, iso } from '../../lib/time.js';

const MAX_BODY = 16384;
const MAX_EVENTS = 40;
const SESSION = /^[a-z0-9]{8,32}$/i;
const TYPES = new Set(['view', 'section', 'scroll', 'click', 'video', 'watch', 'photo', 'snow', 'form', 'copy', 'error', 'signup', 'instagram']);
const WEEK = 7 * 86400000;
// per network per hour, generous because a jam shares one wifi; per visit, caps no person reaches
const IP_SESSIONS_PER_HOUR = 150;
const IP_BATCHES_PER_HOUR = 2400;
const SESSION_BATCHES = 360; // a batch every 20 seconds for two hours
const SESSION_EVENTS = 1500;

const nothing = (status = 204, headers = {}) => new Response(null, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const int = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null);

export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.IP_SALT) return nothing();
  const { body, status } = await readJson(request, MAX_BODY);
  if (!body) return nothing(status);
  if (typeof body.s !== 'string' || !SESSION.test(body.s)) return nothing(400);

  const sid = body.s;
  const path = clip(body.p, 120) || '/';
  const meta = body.m && typeof body.m === 'object' ? body.m : null;
  const now = Date.now();
  const since = int(body.k, 0, WEEK) || 0;

  // the events, packed: [ms after the visit started, type, label, value, path], empty ends left off
  const packed = [];
  let views = 0, flags = 0, last = null;
  for (const e of Array.isArray(body.e) ? body.e.slice(0, MAX_EVENTS) : []) {
    if (!e || !TYPES.has(e.t)) continue;
    const label = clip(e.l, 160);
    const row = [int(e.k, 0, WEEK) ?? since, e.t, label, int(e.v, -1, 1e7), path === '/' ? null : path];
    while (row[row.length - 1] == null) row.pop();
    packed.push(last = JSON.stringify(row));
    if (e.t === 'view') views++;
    if (e.t === 'section' && label === 'signup') flags |= 1;
    if (e.t === 'view' && path.startsWith('/signup')) flags |= 2;
    if (e.t === 'signup') flags |= 4;
    if (e.t === 'instagram' || (e.t === 'click' && /instagram/i.test(label || ''))) flags |= 8;
  }
  const engaged = int(body.a, 0, 120000) || 0;
  const scroll = int(body.x, 0, 100) || 0;
  const interacted = body.i === 1 ? 1 : 0;
  if (!packed.length && !engaged && !scroll && !interacted) return nothing();

  // who: the visitor cookie, made here the first time
  let vid = visitorId(request);
  const headers = {};
  if (!vid) {
    vid = crypto.randomUUID();
    headers['Set-Cookie'] = visitorCookie(vid);
  }
  const ipHash = await hashIp(request.headers.get('CF-Connecting-IP') || '', env.IP_SALT);
  const ua = request.headers.get('User-Agent') || '';
  const dev = device(ua, meta ? int(meta.tp, 0, 20) || 0 : 0);
  const where = place(request);
  const referrer = meta ? clip(meta.r, 300) : null;
  const campaign = meta ? clip(meta.c, 160) : null;
  const source = sourceOf(referrer, campaign, dev.browser);
  const started = now - since;
  const hourAgo = iso(now - 3600000);

  try {
    const stmts = [];
    // the visitor, when a page opens: new, or back after half an hour, or now known to be you
    // or to have come in on an outreach link. Otherwise it's left alone and costs no write.
    if (meta) {
      const bot = BOT_UA.test(ua) || !ua || meta.wd === 1 ? 1 : 0;
      const me = (await isAdmin(request, env)) ? 1 : 0;
      stmts.push(env.DB.prepare(
        `INSERT INTO visitors (id, first_seen, last_seen, link_code, first_referrer, first_landing, first_campaign, first_source,
           country, region, city, timezone, asn, as_org, device, os, browser, ua, screen, lang, ip_hash, bot, me)
         SELECT ?1, ?2, ?2, (SELECT code FROM link_hits WHERE visitor_id = ?1 ORDER BY id LIMIT 1), ?3, ?4, ?5, ?6,
           ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21
         WHERE (SELECT COUNT(*) FROM sessions WHERE ip_hash = ?19 AND started_at > ?22) < ${IP_SESSIONS_PER_HOUR}
         ON CONFLICT (id) DO UPDATE SET
           last_seen = excluded.last_seen,
           link_code = COALESCE(visitors.link_code, excluded.link_code),
           country = excluded.country, region = excluded.region, city = excluded.city, timezone = excluded.timezone,
           asn = excluded.asn, as_org = excluded.as_org,
           device = excluded.device, os = excluded.os, browser = excluded.browser, ua = excluded.ua,
           screen = COALESCE(excluded.screen, visitors.screen), lang = COALESCE(excluded.lang, visitors.lang),
           ip_hash = excluded.ip_hash,
           bot = MAX(visitors.bot, excluded.bot),
           me = MAX(visitors.me, excluded.me)
         WHERE visitors.last_seen < ?23 OR excluded.me > visitors.me
           OR (visitors.link_code IS NULL AND excluded.link_code IS NOT NULL)`
      ).bind(
        vid, iso(started), referrer, path, campaign, source,
        where.country, where.region, where.city, where.timezone, where.asn, where.as_org,
        dev.device, dev.os, dev.browser, ua.slice(0, 300),
        clip(meta.sc, 20), clip(meta.lg, 20),
        ipHash, bot, me, hourAgo, iso(now - 1800000)
      ));
    }
    // the visit: made by its first batch, then each batch adds its events to the log.
    // a visit opened within two minutes of an outreach link counts as coming from it.
    // the network's visits and batches in the last hour gate both, through the sessions_ip index.
    stmts.push(env.DB.prepare(
      `INSERT INTO sessions (id, visitor_id, day, started_at, last_at, link_code, landing, referrer, campaign, source,
         pageviews, engaged_ms, max_scroll, interacted, flags, beacons, n, log, last,
         country, region, city, as_org, device, os, browser, ip_hash)
       SELECT ?1, ?2, ?3, ?4, ?5, (SELECT code FROM link_hits WHERE visitor_id = ?2 AND at > ?6 ORDER BY id DESC LIMIT 1),
         ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 1, ?16, ?17, ?18,
         ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26
       WHERE (SELECT COUNT(*) < ${IP_SESSIONS_PER_HOUR} AND COALESCE(SUM(beacons), 0) < ${IP_BATCHES_PER_HOUR}
              FROM sessions WHERE ip_hash = ?26 AND started_at > ?27)
       ON CONFLICT (id) DO UPDATE SET
         last_at = excluded.last_at,
         pageviews = sessions.pageviews + excluded.pageviews,
         engaged_ms = sessions.engaged_ms + excluded.engaged_ms,
         max_scroll = MAX(sessions.max_scroll, excluded.max_scroll),
         interacted = MAX(sessions.interacted, excluded.interacted),
         flags = sessions.flags | excluded.flags,
         beacons = sessions.beacons + 1,
         log = CASE WHEN excluded.n = 0 OR sessions.n >= ${SESSION_EVENTS} THEN sessions.log
                    WHEN sessions.n = 0 THEN excluded.log
                    ELSE sessions.log || ',' || excluded.log END,
         n = CASE WHEN sessions.n >= ${SESSION_EVENTS} THEN sessions.n ELSE sessions.n + excluded.n END,
         last = COALESCE(excluded.last, sessions.last)
       WHERE sessions.visitor_id = excluded.visitor_id AND sessions.beacons < ${SESSION_BATCHES}`
    ).bind(
      sid, vid, localDay(started), iso(started), iso(now), iso(now - 120000),
      path, referrer, campaign, source,
      views, engaged, scroll, interacted, flags, packed.length, packed.join(','), last,
      where.country, where.region, where.city, where.as_org, dev.device, dev.os, dev.browser, ipHash, hourAgo
    ));
    await env.DB.batch(stmts);
  } catch (err) {
    console.error('[t] d1 error:', err && err.message);
    return nothing(500, headers);
  }
  return nothing(204, headers);
}
