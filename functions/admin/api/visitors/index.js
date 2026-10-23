// GET /admin/api/visitors?show=people|outreach|signups|all&before=<last_seen>
// browsers, most recently seen first, 100 at a time. `people` leaves out bots and your own browsers.
// the 100 are picked first, each through an index, and only their visits are added up.

import { json } from '../../../../lib/http.js';
import { PEOPLE, WHO, rows } from '../../../../lib/report.js';

const SHOW = {
  people: `FROM visitors v WHERE ${PEOPLE}`,
  outreach: `FROM visitors v INDEXED BY visitors_link WHERE v.link_code IS NOT NULL AND ${PEOPLE}`,
  // from the signups, a few hundred rows, rather than every browser looking for one that signed up
  signups: 'FROM (SELECT DISTINCT visitor_id FROM signups WHERE visitor_id IS NOT NULL) su CROSS JOIN visitors v ON v.id = su.visitor_id WHERE v.me = 0',
  all: 'FROM visitors v WHERE 1 = 1',
};

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const filter = SHOW[url.searchParams.get('show')] || SHOW.people;
  const before = url.searchParams.get('before') || '9999';
  const res = await env.DB.prepare(
    `SELECT v.id, v.first_seen, v.last_seen, v.link_code, v.city, v.region, v.country, v.device, v.os, v.browser,
       v.as_org, v.bot, v.me, v.first_source, ${WHO},
       COUNT(s.id) AS visits, COALESCE(SUM(s.pageviews), 0) AS pageviews, COALESCE(SUM(s.engaged_ms), 0) AS engaged,
       MAX(s.last_at) AS last_at, MAX(s.max_scroll) AS max_scroll, MAX(s.interacted) AS interacted
     FROM (SELECT v.* ${filter} AND v.last_seen < ?1 ORDER BY v.last_seen DESC LIMIT 100) v
     LEFT JOIN sessions s ON s.visitor_id = v.id
     GROUP BY v.id ORDER BY v.last_seen DESC`
  ).bind(before).all();
  return json({ visitors: rows(res) });
}
