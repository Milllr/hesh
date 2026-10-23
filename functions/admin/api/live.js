// GET /admin/api/live?after=<ms>&hit=<last open id>&all=1
// who's on the site right now, the visits that changed since `after` (with their event logs,
// so the page can show what's new), and new outreach link opens. The page polls it.
// it reads only visits started in the last two hours, through the sessions_started index.

import { json } from '../../../lib/http.js';
import { PEOPLE, WHO, int, rows } from '../../../lib/report.js';
import { iso } from '../../../lib/time.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const now = Date.now();
  // the first poll fills the feed from the last half hour
  const after = int(url.searchParams.get('after'), 0, now, 0) || now - 1800000;
  const hit = int(url.searchParams.get('hit'), 0, Number.MAX_SAFE_INTEGER, 0);
  const people = url.searchParams.get('all') === '1' ? 'v.me = 0' : PEOPLE;
  const [sessions, opens] = await env.DB.batch([
    env.DB.prepare(
      `SELECT s.id, s.visitor_id, s.started_at, s.last_at, s.pageviews, s.engaged_ms, s.max_scroll, s.link_code, s.n, s.last,
         CASE WHEN s.last_at > ?3 THEN s.log END AS log,
         v.city, v.region, v.country, v.device, v.os, v.browser, v.bot, ${WHO}
       FROM sessions s JOIN visitors v ON v.id = s.visitor_id
       WHERE s.started_at >= ?1 AND s.last_at >= ?2 AND ${people} ORDER BY s.last_at DESC LIMIT 60`
    ).bind(iso(now - 7200000), iso(Math.min(after, now - 120000)), iso(after)),
    env.DB.prepare(
      `SELECT h.id, h.code, h.at, h.scanner, h.city, h.country, h.as_org, h.visitor_id, l.label
       FROM link_hits h LEFT JOIN links l ON l.code = h.code LEFT JOIN visitors v ON v.id = h.visitor_id
       WHERE h.id > ?1 AND COALESCE(v.me, 0) = 0 ORDER BY h.id DESC LIMIT 30`
    ).bind(hit),
  ]);
  return json({ now, sessions: rows(sessions), opens: rows(opens) });
}
