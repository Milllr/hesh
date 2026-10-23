// GET    /admin/api/links/<code>   one link: every open, every browser that came in on it, and their visits
//                                   with the packed event logs (the page unpacks them into a timeline)
// PATCH  /admin/api/links/<code>   { label?, org?, email?, note?, archived? }
// DELETE /admin/api/links/<code>   removes the link and its opens; the visits stay, unlinked

import { json, readJson, clip } from '../../../../lib/http.js';
import { PEOPLE, rows } from '../../../../lib/report.js';
import { linkStats, summarise } from '../../../../lib/links.js';
import { redoFrom } from '../../../../lib/rollup.js';

export async function onRequestGet({ env, params }) {
  const code = String(params.code).toLowerCase();
  const [links, hits, visitors, moments, sessions] = await env.DB.batch([
    ...linkStats(env.DB, code),
    env.DB.prepare(
      `SELECT s.id, s.visitor_id, s.started_at, s.log FROM visitors v INDEXED BY visitors_link
       JOIN sessions s ON s.visitor_id = v.id
       WHERE v.link_code = ?1 AND ${PEOPLE} ORDER BY s.started_at DESC LIMIT 100`
    ).bind(code),
  ]);
  const link = rows(links)[0];
  if (!link) return json({ error: 'no such link' }, 404);
  return json({
    link: { ...link, ...summarise(code, rows(hits), rows(visitors), rows(moments)) },
    opens: rows(hits).map(({ ip_hash, ...h }) => h).reverse(),
    visitors: rows(visitors),
    sessions: rows(sessions),
  });
}

export async function onRequestPatch({ request, env, params }) {
  const { body, status } = await readJson(request, 4096);
  if (!body) return json({ error: 'bad request' }, status);
  const sets = [];
  const vals = [];
  for (const [k, max] of [['label', 80], ['org', 80], ['email', 120], ['note', 500]]) {
    if (k in body) { sets.push(`${k} = ?`); vals.push(clip(body[k], max)); }
  }
  if ('archived' in body) { sets.push('archived = ?'); vals.push(body.archived ? 1 : 0); }
  if ('label' in body && !vals[0]) return json({ error: 'say who it\'s for' }, 400);
  if (!sets.length) return json({ error: 'nothing to change' }, 400);
  const res = await env.DB.prepare(`UPDATE links SET ${sets.join(', ')} WHERE code = ?`).bind(...vals, String(params.code).toLowerCase()).run();
  return res.meta.changes ? json({ ok: true }) : json({ error: 'no such link' }, 404);
}

export async function onRequestDelete({ env, params }) {
  const code = String(params.code).toLowerCase();
  // the visits it brought in are found through its opens, so this never reads every visit
  const brought = 'link_code = ?1 AND visitor_id IN (SELECT visitor_id FROM link_hits WHERE code = ?1)';
  await env.DB.batch([
    redoFrom(env.DB, `SELECT MIN(day) FROM sessions WHERE ${brought}`, code), // they stop counting as outreach
    env.DB.prepare(`UPDATE sessions SET link_code = NULL WHERE ${brought}`).bind(code),
    env.DB.prepare('UPDATE visitors SET link_code = NULL WHERE link_code = ?1').bind(code),
    env.DB.prepare('DELETE FROM link_hits WHERE code = ?1').bind(code),
    env.DB.prepare('DELETE FROM links WHERE code = ?1').bind(code),
  ]);
  return json({ ok: true });
}
