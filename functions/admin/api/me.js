// answers 200 only behind the gate (_middleware.js answers 401 otherwise). The sign-in page asks,
// because a link from email arrives without the SameSite=Strict session cookie.

import { json } from '../../../lib/http.js';

export function onRequestGet() {
  return json({ ok: true });
}
