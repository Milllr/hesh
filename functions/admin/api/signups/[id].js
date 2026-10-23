// DELETE /admin/api/signups/<id>   takes someone off the list

import { json } from '../../../../lib/http.js';

export async function onRequestDelete({ env, params }) {
  const res = await env.DB.prepare('DELETE FROM signups WHERE id = ?1').bind(String(params.id)).run();
  return res.meta.changes ? json({ ok: true }) : json({ error: 'no such signup' }, 404);
}
