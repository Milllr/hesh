// the gate in front of everything under /admin: the pages, their scripts and /admin/api/*.
// without a valid session only the sign-in page, its script and the sign-in call get through;
// pages redirect to it and api calls get 401. Every answer is uncached, unindexed and unframeable,
// and carries a CSP with no inline script, so a visitor's text shown in the portal can't run.

import { isAdmin } from '../../lib/admin.js';

const OPEN = new Set(['/admin/login', '/admin/login.js', '/admin/admin.css', '/admin/api/login']);
const TURNSTILE = 'https://challenges.cloudflare.com';

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const signedIn = await isAdmin(request, env);

  let res;
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.headers.get('Origin') !== url.origin) {
    // changes only come from the portal's own pages
    res = new Response(JSON.stringify({ error: 'not allowed' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  } else if (signedIn && path === '/admin/login') {
    res = Response.redirect(new URL('/admin/', url).href, 302);
  } else if (signedIn || OPEN.has(path)) {
    res = await next();
  } else if (path.startsWith('/admin/api/')) {
    res = new Response(JSON.stringify({ error: 'sign in' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  } else {
    res = Response.redirect(new URL('/admin/login', url).href, 302);
  }

  res = new Response(res.body, res);
  const h = res.headers;
  const login = path === '/admin/login';
  h.set('Content-Security-Policy', [
    "default-src 'none'",
    login ? `script-src 'self' ${TURNSTILE}` : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    login ? `frame-src ${TURNSTILE}` : "frame-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; '));
  h.set('Cache-Control', 'no-store');
  h.set('X-Robots-Tag', 'noindex, nofollow');
  h.set('X-Frame-Options', 'DENY');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  return res;
}
