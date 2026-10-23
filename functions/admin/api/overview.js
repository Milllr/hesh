// GET /admin/api/overview?days=30
// the dashboard's numbers for the last `days` days in Ontario (1 = today, by hour).
// finished days come from the daily totals (lib/rollup.js), a row a day; only the days not
// added up yet, today at least, are counted from the visits themselves.

import { json } from '../../../lib/http.js';
import { PEOPLE, rows } from '../../../lib/report.js';
import { DAY_TOTALS, DAY_COUNTS, span, rollUp } from '../../../lib/rollup.js';
import { localDay, dayStart, addDays, offsetAt, iso } from '../../../lib/time.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const days = [1, 7, 30, 90, 365].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 30;
  const now = Date.now();
  const today = localDay(now);
  const first = addDays(today, 1 - days);
  const since = iso(dayStart(first));
  const through = await rollUp(env.DB, now);
  // done days are [first, live); from live on, count the visits
  const live = through && through > first ? through : first;
  const both = [...span(live), first, live];
  const mins = Math.round(offsetAt(now) / 60000);
  const shift = `${mins >= 0 ? '+' : ''}${mins} minutes`;
  const hourly = days === 1;
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b);

  const [totals, counts, uniques, signups, signupSeries, online, outreach, byHour] = await env.DB.batch([
    q(`SELECT * FROM (
         SELECT day, visits, visitors, pageviews, engaged, interacted, halfway, saw_signup, opened_signup, signed_up
           FROM days WHERE day >= ?5 AND day < ?6
         UNION ALL ${DAY_TOTALS}) ORDER BY day`, ...both),
    q(`SELECT dim, a, b, c, SUM(n) AS n, SUM(visits) AS visits, SUM(total) AS total FROM (
         SELECT dim, a, b, c, n, visits, total FROM day_counts WHERE day >= ?5 AND day < ?6
         UNION ALL SELECT dim, a, b, c, n, visits, total FROM (${DAY_COUNTS}))
       GROUP BY dim, a, b, c`, ...both),
    // a browser that came back on three days is one visitor, so this one is counted, not added up
    q(`SELECT COUNT(*) AS visitors, COALESCE(SUM(v.first_seen >= ?1), 0) AS new_visitors
       FROM visitors v WHERE v.last_seen >= ?1 AND ${PEOPLE}`, since),
    q('SELECT COUNT(*) AS total, COALESCE(SUM(created_at >= ?1), 0) AS in_range, COALESCE(SUM(instagram), 0) AS instagram FROM signups', since),
    q(`SELECT ${hourly ? "strftime('%H', created_at, ?2)" : 'date(created_at, ?2)'} AS bucket, COUNT(*) AS signups
       FROM signups WHERE created_at >= ?1 GROUP BY bucket`, since, shift),
    q(`SELECT COUNT(DISTINCT s.visitor_id) AS n FROM sessions s JOIN visitors v ON v.id = s.visitor_id
       WHERE s.started_at >= ?1 AND s.last_at >= ?2 AND ${PEOPLE}`, iso(now - 7200000), iso(now - 120000)),
    q(`SELECT COUNT(*) AS links,
         COALESCE(SUM(EXISTS (SELECT 1 FROM visitors v WHERE v.link_code = l.code AND ${PEOPLE})), 0) AS visited
       FROM links l WHERE l.archived = 0`),
    ...(hourly ? [q(`SELECT strftime('%H', s.started_at, ?5) AS bucket, COUNT(DISTINCT s.visitor_id) AS visitors,
         COUNT(*) AS visits, SUM(s.pageviews) AS pageviews, SUM(s.engaged_ms) AS engaged
       FROM sessions s JOIN visitors v ON v.id = s.visitor_id
       WHERE s.started_at >= ?1 AND s.started_at < ?2 AND s.day >= ?3 AND s.day < ?4 AND ${PEOPLE}
       GROUP BY bucket`, ...span(today), shift)] : []),
  ]);

  const perDay = rows(totals);
  const sum = (k) => perDay.reduce((a, r) => a + (r[k] || 0), 0);
  const dims = { source: [], place: [], device: [], event: [] };
  for (const r of rows(counts)) {
    if (r.dim === 'source') dims.source.push({ name: r.a, visits: r.n });
    else if (r.dim === 'place') dims.place.push({ country: r.a || null, region: r.b || null, city: r.c || null, visits: r.n });
    else if (r.dim === 'device') dims.device.push({ device: r.a || null, os: r.b || null, browser: r.c || null, visits: r.n });
    else if (r.dim === 'event') dims.event.push({ type: r.a, label: r.b, n: r.n, visits: r.visits, total: r.total });
  }
  const buckets = [];
  for (let i = 0; i < (hourly ? 24 : days); i++) buckets.push(hourly ? String(i).padStart(2, '0') : addDays(first, i));

  return json({
    days, since, hourly, buckets,
    totals: { ...rows(uniques)[0], visits: sum('visits'), pageviews: sum('pageviews'), engaged: sum('engaged'), interacted: sum('interacted') },
    series: hourly ? rows(byHour) : perDay.map((r) => ({ bucket: r.day, visitors: r.visitors, visits: r.visits, pageviews: r.pageviews, engaged: r.engaged })),
    sources: dims.source,
    places: dims.place.sort((a, b) => b.visits - a.visits).slice(0, 12),
    devices: dims.device,
    events: dims.event,
    funnel: { visits: sum('visits'), halfway: sum('halfway'), saw_signup: sum('saw_signup'), opened_signup: sum('opened_signup'), signed_up: sum('signed_up') },
    signups: rows(signups)[0],
    signupSeries: rows(signupSeries),
    online: rows(online)[0].n,
    outreach: rows(outreach)[0],
  });
}
