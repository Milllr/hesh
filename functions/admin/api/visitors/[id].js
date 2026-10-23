// GET   /admin/api/visitors/<id>   one browser: where and what it is, and every visit with its packed event log
// PATCH /admin/api/visitors/<id>   { me?, bot? } e.g. mark your phone as yours so it stays out of the numbers

import { json, readJson } from '../../../../lib/http.js';
import { WHO, rows } from '../../../../lib/report.js';
import { redoFrom } from '../../../../lib/rollup.js';

export async function onRequestGet({ env, params }) {
  const id = String(params.id);
  const [visitor, sessions, opens, signups] = await env.DB.batch([
    env.DB.prepare(`SELECT v.*, ${WHO} FROM visitors v WHERE v.id = ?1`).bind(id),
    env.DB.prepare(
      `SELECT id, started_at, last_at, link_code, landing, referrer, campaign, source, pageviews, engaged_ms, max_scroll,
         n, interacted, log, country, region, city, as_org, device, os, browser
       FROM sessions WHERE visitor_id = ?1 ORDER BY started_at DESC LIMIT 200`
    ).bind(id),
    env.DB.prepare(
      `SELECT h.code, h.at, h.method, h.ua, h.country, h.region, h.city, h.as_org, h.scanner, l.label
       FROM link_hits h LEFT JOIN links l ON l.code = h.code WHERE h.visitor_id = ?1 ORDER BY h.id DESC`
    ).bind(id),
    env.DB.prepare('SELECT id, name, email, phone, source, instagram, created_at FROM signups WHERE visitor_id = ?1 ORDER BY created_at DESC').bind(id),
  ]);
  const v = rows(visitor)[0];
  if (!v) return json({ error: 'no such visitor' }, 404);
  delete v.ip_hash;
  return json({ visitor: v, sessions: rows(sessions), opens: rows(opens), signups: rows(signups) });
}

export async function onRequestPatch({ request, env, params }) {
  const { body, status } = await readJson(request, 1024);
  if (!body) return json({ error: 'bad request' }, status);
  const sets = [];
  const vals = [];
  for (const k of ['me', 'bot']) {
    if (k in body) { sets.push(`${k} = ?`); vals.push(body[k] ? 1 : 0); }
  }
  if (!sets.length) return json({ error: 'nothing to change' }, 400);
  const id = String(params.id);
  // its visits move in or out of the numbers, so the daily totals from its first visit get redone
  const [, res] = await env.DB.batch([
    redoFrom(env.DB, 'SELECT MIN(day) FROM sessions WHERE visitor_id = ?1', id),
    env.DB.prepare(`UPDATE visitors SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id),
  ]);
  return res.meta.changes ? json({ ok: true }) : json({ error: 'no such visitor' }, 404);
}
