// pieces the /admin api shares

export const PEOPLE = 'v.bot = 0 AND v.me = 0'; // leaves out bots and your own browsers

// who a visitor is, best name first: who signed up from it, then the outreach link it came in on
export const WHO = `
  (SELECT name FROM signups WHERE visitor_id = v.id ORDER BY created_at DESC LIMIT 1) AS signup_name,
  (SELECT COUNT(*) FROM signups WHERE visitor_id = v.id) AS signups,
  (SELECT label FROM links WHERE code = v.link_code) AS link_label`;

export function int(v, lo, hi, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

export const rows = (r) => r.results || [];
