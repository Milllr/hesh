import { json } from '../../../lib/http.js';
import { clearedCookie } from '../../../lib/admin.js';

export function onRequestPost() {
  return json({ ok: true }, 200, { 'Set-Cookie': clearedCookie() });
}
