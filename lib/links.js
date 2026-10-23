// outreach link numbers, shared by the list and the single-link view

import { PEOPLE } from './report.js';

// four queries for env.DB.batch: the links, their opens, the browsers that came in on them,
// and what those browsers did. `code` narrows it to one link. Browsers come in through the
// visitors_link index, which only holds the ones with a link, however big the site gets.
export function linkStats(db, code = null) {
  const one = code ? ' AND v.link_code = ?1' : '';
  const b = (stmt) => (code ? stmt.bind(code) : stmt);
  return [
    b(db.prepare(`SELECT * FROM links${code ? ' WHERE code = ?1' : ''} ORDER BY created_at DESC`)),
    // opens from your own browsers don't count
    b(db.prepare(`SELECT h.* FROM link_hits h LEFT JOIN visitors v ON v.id = h.visitor_id
      WHERE COALESCE(v.me, 0) = 0${code ? ' AND h.code = ?1' : ''} ORDER BY h.id`)),
    b(db.prepare(`SELECT v.link_code AS code, v.id, v.bot, v.city, v.region, v.country, v.device, v.os, v.browser, v.as_org,
        COUNT(s.id) AS visits, COALESCE(SUM(s.engaged_ms), 0) AS engaged, COALESCE(SUM(s.pageviews), 0) AS pageviews,
        MIN(s.started_at) AS first_visit, MAX(s.last_at) AS last_visit, MAX(s.max_scroll) AS max_scroll, MAX(s.interacted) AS interacted
      FROM visitors v INDEXED BY visitors_link JOIN sessions s ON s.visitor_id = v.id
      WHERE v.link_code IS NOT NULL AND v.me = 0${one} GROUP BY v.id ORDER BY last_visit DESC`)),
    b(db.prepare(`SELECT code, type, label, COUNT(*) AS n, COALESCE(SUM(value), 0) AS total FROM (
        SELECT v.link_code AS code, json_extract(e.value, '$[1]') AS type, json_extract(e.value, '$[2]') AS label,
          json_extract(e.value, '$[3]') AS value
        FROM visitors v INDEXED BY visitors_link JOIN sessions s ON s.visitor_id = v.id, json_each('[' || s.log || ']') e
        WHERE v.link_code IS NOT NULL AND ${PEOPLE}${one})
      WHERE type IN ('watch', 'section', 'signup', 'instagram', 'click', 'snow')
      GROUP BY 1, 2, 3`)),
  ];
}

// one link's status, from its opens, the browsers that came in on it, and what they did
export function summarise(code, hits, visitors, moments) {
  const h = hits.filter((r) => r.code === code);
  const v = visitors.filter((r) => r.code === code);
  const people = v.filter((r) => !r.bot);
  const sum = (list, k) => list.reduce((n, r) => n + (r[k] || 0), 0);
  const engaged = sum(people, 'engaged');
  const interacted = people.some((r) => r.interacted);
  const m = moments.filter((r) => r.code === code);
  const pick = (type, test = () => true) => m.filter((r) => r.type === type && test(r));
  const highlights = [];
  const watched = sum(pick('watch'), 'total');
  if (watched) highlights.push({ kind: 'watch', seconds: watched });
  if (pick('section', (r) => r.label === 'signup').length) highlights.push({ kind: 'saw_signup' });
  if (pick('signup').length) highlights.push({ kind: 'signed_up' });
  if (pick('instagram').length || pick('click', (r) => /instagram/i.test(r.label || '')).length) highlights.push({ kind: 'instagram' });
  if (pick('snow').length) highlights.push({ kind: 'snow' });

  const status = people.length ? (interacted || engaged >= 10000 ? 'engaged' : 'visited')
    : v.length || (h.length && h.every((r) => r.scanner)) ? 'scanned'
    : h.length ? 'clicked'
    : 'unopened';
  const times = (list, k) => list.map((r) => r[k]).filter(Boolean).sort();
  return {
    status,
    opens: h.length,
    scanner_opens: h.filter((r) => r.scanner).length,
    first_open: times(h, 'at')[0] || null,
    visitors: people.length,
    visits: sum(people, 'visits'),
    pageviews: sum(people, 'pageviews'),
    engaged,
    max_scroll: Math.max(0, ...people.map((r) => r.max_scroll || 0)),
    first_visit: times(people, 'first_visit')[0] || null,
    last_visit: times(people, 'last_visit').pop() || null,
    highlights,
  };
}
