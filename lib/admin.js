// the /admin session: a signed cookie, nothing kept on the server.
// the signing key mixes in ADMIN_PASSWORD, so changing the password signs every browser out.

import { readCookie } from './http.js';

const COOKIE = '__Host-hesh_admin';
const TTL = 14 * 24 * 3600; // seconds
export const MIN_PASSWORD = 12;

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

// fail closed: no password (or a short one), no salt or no database means nobody gets in
export function adminReady(env) {
  return !!(env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length >= MIN_PASSWORD && env.IP_SALT && env.DB);
}

function key(env, usage) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode('hesh-admin|' + env.IP_SALT + '|' + env.ADMIN_PASSWORD),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
}

export async function sessionCookie(env) {
  const body = `v1.${Math.floor(Date.now() / 1000) + TTL}.${b64url(crypto.getRandomValues(new Uint8Array(16)))}`;
  const sig = await crypto.subtle.sign('HMAC', await key(env, 'sign'), enc.encode(body));
  return `${COOKIE}=${body}.${b64url(sig)}; Path=/; Max-Age=${TTL}; Secure; HttpOnly; SameSite=Strict`;
}

export function clearedCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
}

export async function isAdmin(request, env) {
  if (!adminReady(env)) return false;
  const m = /^(v1\.(\d{10})\.[\w-]{22})\.([\w-]{43})$/.exec(readCookie(request, COOKIE));
  if (!m || Number(m[2]) < Date.now() / 1000) return false;
  try {
    return await crypto.subtle.verify('HMAC', await key(env, 'verify'), unb64url(m[3]), enc.encode(m[1]));
  } catch {
    return false;
  }
}

// compares digests, so the time taken says nothing about the password
export async function passwordMatches(env, given) {
  const [a, b] = await Promise.all([given, env.ADMIN_PASSWORD].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}
