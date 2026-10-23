// GET /admin/api/signups   the whole list, newest first, with what each signup's browser did on the site

import { json } from '../../../../lib/http.js';
import { rows } from '../../../../lib/report.js';

export async function onRequestGet({ env }) {
  const res = await env.DB.prepare(
    `SELECT su.id, su.name, su.email, su.phone, su.source, su.instagram, su.visitor_id, su.created_at, su.updated_at,
       v.city, v.region, v.country, v.device, v.os, v.browser, v.link_code,
       (SELECT label FROM links WHERE code = v.link_code) AS link_label,
       (SELECT COUNT(*) FROM sessions WHERE visitor_id = su.visitor_id) AS visits,
       (SELECT COALESCE(SUM(engaged_ms), 0) FROM sessions WHERE visitor_id = su.visitor_id) AS engaged,
       (SELECT COUNT(*) FROM signups o WHERE o.visitor_id = su.visitor_id) AS same_device
     FROM signups su LEFT JOIN visitors v ON v.id = su.visitor_id
     ORDER BY su.created_at DESC`
  ).all();
  return json({ signups: rows(res) });
}
