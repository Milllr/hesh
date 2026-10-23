// helpers shared by the functions in functions/

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

export function readCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

// a json object from one of our own pages, at most `max` bytes.
// returns { body } or { status } to refuse with.
export async function readJson(request, max) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return { status: 403 };
  if (Number(request.headers.get('Content-Length') || 0) > max) return { status: 413 };
  const raw = await request.text();
  if (raw.length > max) return { status: 413 };
  try {
    const body = JSON.parse(raw);
    if (body && typeof body === 'object' && !Array.isArray(body)) return { body };
  } catch {}
  return { status: 400 };
}

// a short single-line string from untrusted input, or null
export function clip(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
  return s || null;
}

export async function hashIp(ip, salt) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + ip));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
