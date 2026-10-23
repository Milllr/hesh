// the overview's daily totals. Finished days are added up once, in SQL, into `days` and
// `day_counts`; the overview reads those for the past and adds up today (and anything not
// done yet) from the visits themselves. Nothing here leaves D1, so it costs the worker no time.

import { localDay, dayStart, addDays, iso } from './time.js';
import { rows } from './report.js';

const GRACE = 3 * 3600000; // a day is finished three hours after midnight, once its last visits are in
const CHUNK = 31;          // days added up per query
const CHUNKS = 3;          // per request, so a long backlog spreads over a few page loads

// the visits that count, binds ?1 ?2 (started_at range) and ?3 ?4 (day range): people only, no bots, not you
const RANGE = `FROM sessions s JOIN visitors v ON v.id = s.visitor_id
  WHERE s.started_at >= ?1 AND s.started_at < ?2 AND s.day >= ?3 AND s.day < ?4 AND v.bot = 0 AND v.me = 0`;
// the event types the overview counts by label
const COUNTED = `('section', 'watch', 'video', 'click', 'snow', 'photo', 'copy', 'form')`;

export const DAY_TOTALS = `SELECT s.day AS day, COUNT(*) AS visits, COUNT(DISTINCT s.visitor_id) AS visitors,
    COALESCE(SUM(s.pageviews), 0) AS pageviews, COALESCE(SUM(s.engaged_ms), 0) AS engaged,
    COALESCE(SUM(s.interacted), 0) AS interacted, COALESCE(SUM(s.max_scroll >= 50), 0) AS halfway,
    COALESCE(SUM((s.flags & 1) > 0), 0) AS saw_signup, COALESCE(SUM((s.flags & 2) > 0), 0) AS opened_signup,
    COALESCE(SUM((s.flags & 4) > 0), 0) AS signed_up
  ${RANGE} GROUP BY s.day`;

export const DAY_COUNTS = `
  SELECT s.day AS day, 'source' AS dim,
      CASE WHEN s.link_code IS NOT NULL THEN 'outreach link' ELSE COALESCE(s.source, 'direct or unknown') END AS a,
      '' AS b, '' AS c, COUNT(*) AS n, COUNT(*) AS visits, 0 AS total
    ${RANGE} GROUP BY 1, 3
  UNION ALL
  SELECT s.day, 'place', COALESCE(s.country, ''), COALESCE(s.region, ''), COALESCE(s.city, ''), COUNT(*), COUNT(*), 0
    ${RANGE} GROUP BY 1, 3, 4, 5
  UNION ALL
  SELECT s.day, 'device', COALESCE(s.device, ''), COALESCE(s.os, ''), COALESCE(s.browser, ''), COUNT(*), COUNT(*), 0
    ${RANGE} GROUP BY 1, 3, 4, 5
  UNION ALL
  SELECT s.day, 'event', json_extract(e.value, '$[1]'), COALESCE(json_extract(e.value, '$[2]'), ''), '',
      COUNT(*), COUNT(DISTINCT s.id), COALESCE(SUM(json_extract(e.value, '$[3]')), 0)
    FROM sessions s JOIN visitors v ON v.id = s.visitor_id, json_each('[' || s.log || ']') e
    WHERE s.started_at >= ?1 AND s.started_at < ?2 AND s.day >= ?3 AND s.day < ?4 AND v.bot = 0 AND v.me = 0
      AND json_extract(e.value, '$[1]') IN ${COUNTED}
    GROUP BY 1, 3, 4`;

// binds for RANGE: the days from `from` (a local day) up to `to` (exclusive, or open-ended)
export const span = (from, to = null) => [iso(dayStart(from)), to ? iso(dayStart(to)) : '9999', from, to || '9999'];

// adds up any finished days not done yet. Returns the first day that isn't (null when there's no data).
export async function rollUp(db, now = Date.now()) {
  const sealed = localDay(now - GRACE); // days before this one are finished
  const [mark, first] = await db.batch([
    db.prepare("SELECT v FROM meta WHERE k = 'rollup_to'"),
    db.prepare('SELECT day FROM sessions ORDER BY started_at LIMIT 1'),
  ]);
  let prev = rows(mark)[0] ? rows(mark)[0].v : null;
  let from = prev || (rows(first)[0] ? rows(first)[0].day : null);
  if (!from) return null;
  for (let i = 0; i < CHUNKS && from < sealed; i++) {
    const to = addDays(from, CHUNK) < sealed ? addDays(from, CHUNK) : sealed;
    const b = span(from, to);
    await db.batch([
      db.prepare('DELETE FROM days WHERE day >= ?1 AND day < ?2').bind(from, to),
      db.prepare('DELETE FROM day_counts WHERE day >= ?1 AND day < ?2').bind(from, to),
      db.prepare(`INSERT INTO days (day, visits, visitors, pageviews, engaged, interacted, halfway, saw_signup, opened_signup, signed_up)
        ${DAY_TOTALS}`).bind(...b),
      db.prepare(`INSERT INTO day_counts (day, dim, a, b, c, n, visits, total) ${DAY_COUNTS}`).bind(...b),
      // only moves forward from where this started, so a redo asked for meanwhile isn't lost
      db.prepare(`INSERT INTO meta (k, v) VALUES ('rollup_to', ?1)
        ON CONFLICT (k) DO UPDATE SET v = excluded.v WHERE meta.v IS ?2`).bind(to, prev),
    ]);
    prev = from = to;
  }
  return from;
}

// the totals from the day `firstDay` (SQL giving one day, binds ?1...) on need redoing,
// e.g. after a visitor is marked as a bot. They're redone on the next overview.
export function redoFrom(db, firstDay, ...binds) {
  return db.prepare(`UPDATE meta SET v = (${firstDay}) WHERE k = 'rollup_to' AND v > (${firstDay})`).bind(...binds);
}
