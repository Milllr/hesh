// GET  /admin/api/links   every outreach link, with whether they opened it and what they did
// POST /admin/api/links   { label, org?, email?, note?, code?, dest? } makes one

import { json, readJson, clip } from '../../../../lib/http.js';
import { rows } from '../../../../lib/report.js';
import { linkStats, summarise } from '../../../../lib/links.js';

const CODE = /^[a-z0-9-]{3,40}$/;
const DEST = /^\/(?!\/)[a-z0-9\-/#?=&]*$/i; // a path on this site; never //host
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // nothing that reads as another letter

function randomCode() {
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export async function onRequestGet({ env }) {
  const [links, hits, visitors, moments] = await env.DB.batch(linkStats(env.DB));
  return json({ links: rows(links).map((l) => ({ ...l, ...summarise(l.code, rows(hits), rows(visitors), rows(moments)) })) });
}

export async function onRequestPost({ request, env }) {
  const { body, status } = await readJson(request, 4096);
  if (!body) return json({ error: 'bad request' }, status);
  const label = clip(body.label, 80);
  if (!label) return json({ error: 'say who it\'s for' }, 400);
  const email = clip(body.email, 120);
  if (email && !EMAIL.test(email)) return json({ error: 'that email doesn\'t look right' }, 400);
  const dest = clip(body.dest, 60) || '/';
  if (!DEST.test(dest)) return json({ error: 'the landing page should start with /' }, 400);
  const custom = clip(body.code, 40);
  if (custom && !CODE.test(custom.toLowerCase())) return json({ error: 'codes are 3 to 40 letters, numbers or dashes' }, 400);

  for (let attempt = 0; attempt < 4; attempt++) {
    const code = custom ? custom.toLowerCase() : randomCode();
    try {
      await env.DB.prepare(
        'INSERT INTO links (code, label, org, email, note, dest, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
      ).bind(code, label, clip(body.org, 80), email, clip(body.note, 500), dest, new Date().toISOString()).run();
      return json({ code }, 201);
    } catch (err) {
      if (!/UNIQUE/i.test(String(err && err.message))) throw err;
      if (custom) return json({ error: 'that code is taken' }, 409);
    }
  }
  return json({ error: 'couldn\'t make a code, try again' }, 500);
}
