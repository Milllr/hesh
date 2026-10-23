// the done screen's "follow @backyardrail" button marks the signup it just made.
// the id is the random one /api/signup handed back, so only that browser knows it;
// a guessed or stale id updates nothing.

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function onRequestPost({ request, env }) {
  if (!env.DB) return new Response(null, { status: 503 });
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const raw = await request.text();
  if (raw.length > 512) return new Response(null, { status: 413 });
  let id = '';
  try {
    id = JSON.parse(raw).id;
  } catch {}
  if (typeof id !== 'string' || !ID.test(id)) return new Response(null, { status: 400 });
  await env.DB.prepare('UPDATE signups SET instagram = 1 WHERE id = ?1').bind(id).run();
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
