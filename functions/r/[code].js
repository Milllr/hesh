// outreach links: hesh.ca/r/<code> records the open, then sends them on to the site.
// made in /admin (one per email). An unknown code goes to the home page like any other link,
// so a guessed code shows nothing.
//
// corporate mail scanners open every link in an email before a person does, so each open is
// marked when it looks like one: a HEAD request, no language, a bot user agent, or a datacenter
// or security network. /admin only calls a link visited once the page itself reports in.

import { hashIp } from '../../lib/http.js';
import { visitorId, visitorCookie, place, BOT_UA } from '../../lib/visitor.js';

const CODE = /^[a-z0-9-]{3,40}$/;
const SCANNER_ORG = /microsoft|google|amazon|aws|proofpoint|mimecast|barracuda|cisco|ironport|zscaler|forcepoint|trend ?micro|sophos|fortinet|palo alto|symantec|broadcom|trustwave|cloudflare|akamai|fastly|digitalocean|ovh|hetzner|linode|oracle|vultr|leaseweb|choopa|datacamp|m247/i;

export async function onRequest({ request, env, params }) {
  const code = String(params.code || '').toLowerCase();
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
  let dest = '/';

  if (env.DB && env.IP_SALT && CODE.test(code)) {
    try {
      const link = await env.DB.prepare('SELECT dest FROM links WHERE code = ?1').bind(code).first();
      if (link) {
        dest = link.dest || '/';
        let vid = visitorId(request);
        if (!vid) {
          vid = crypto.randomUUID();
          headers.append('Set-Cookie', visitorCookie(vid));
        }
        const ua = request.headers.get('User-Agent') || '';
        const where = place(request);
        const scanner = request.method !== 'GET' || !request.headers.get('Accept-Language') || !ua || BOT_UA.test(ua)
          || SCANNER_ORG.test(where.as_org || '') ? 1 : 0;
        await env.DB.prepare(
          `INSERT INTO link_hits (code, at, visitor_id, method, ua, country, region, city, asn, as_org, ip_hash, scanner)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
        ).bind(
          code, new Date().toISOString(), vid, request.method.slice(0, 10), ua.slice(0, 300),
          where.country, where.region, where.city, where.asn, where.as_org,
          await hashIp(request.headers.get('CF-Connecting-IP') || '', env.IP_SALT), scanner
        ).run();
      }
    } catch (err) {
      console.error('[r] d1 error:', err && err.message);
    }
  }

  headers.set('Location', new URL(dest, request.url).href);
  return new Response(null, { status: 302, headers });
}
