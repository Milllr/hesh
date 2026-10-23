// who is visiting: the hesh_vid cookie, where Cloudflare says they are, and what they're on.

import { readCookie } from './http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// set by the server, so it lasts (Safari caps cookies made in page scripts at 7 days)
export function visitorId(request) {
  const v = readCookie(request, 'hesh_vid');
  return UUID.test(v) ? v : '';
}

export function visitorCookie(id) {
  return `hesh_vid=${id}; Path=/; Max-Age=34560000; Secure; HttpOnly; SameSite=Lax`;
}

export function place(request) {
  const cf = request.cf || {};
  const s = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null);
  return {
    country: s(cf.country, 8),
    region: s(cf.region, 80),
    city: s(cf.city, 80),
    timezone: s(cf.timezone, 60),
    asn: Number.isInteger(cf.asn) ? cf.asn : null,
    as_org: s(cf.asOrganization, 120),
  };
}

// link previews, crawlers, scripts and headless browsers
export const BOT_UA = /\bbot\b|bot\/|bot;|crawl|spider|slurp|scan|preview|monitor|headless|lighthouse|pagespeed|phantom|selenium|puppeteer|playwright|python|curl|wget|httpclient|okhttp|java\/|go-http|axios|node-fetch|undici|facebookexternalhit|whatsapp|telegram|discord|slack|embedly|skype/i;

// where a visit came from, in a word: a ?src= tag, the referring site, or the app it opened in.
// worked out once when the visit starts, so the overview can count by it. An outreach link
// beats all of these, and /admin checks link_code for that first.
const HOSTS = [[/instagram\.com$/, 'instagram'], [/facebook\.com$|fb\.com$|messenger\.com$/, 'facebook'], [/google\./, 'google'],
  [/bing\.com$/, 'bing'], [/duckduckgo\.com$/, 'duckduckgo'], [/^t\.co$|twitter\.com$|^x\.com$/, 'x'], [/tiktok\.com$/, 'tiktok'],
  [/linkedin\.com$|lnkd\.in$/, 'linkedin'], [/reddit\.com$/, 'reddit'], [/snapchat\.com$/, 'snapchat'], [/youtube\.com$/, 'youtube']];
const APPS = [[/Instagram/, 'instagram'], [/Facebook/, 'facebook'], [/TikTok/, 'tiktok'], [/Snapchat/, 'snapchat']];

export function sourceOf(referrer, campaign, browser) {
  const c = new URLSearchParams(campaign || '');
  const tag = c.get('src') || c.get('utm_source') || c.get('ref');
  if (tag) return tag.toLowerCase().slice(0, 40);
  if (c.has('igsh') || c.has('igshid')) return 'instagram';
  if (c.has('fbclid')) return 'facebook';
  if (c.has('gclid')) return 'google ads';
  if (c.has('ttclid')) return 'tiktok';
  if (referrer) {
    try {
      const host = new URL(referrer).hostname.replace(/^(www|m|l|lm)\./, '');
      if (!/(^|\.)hesh\.ca$|pages\.dev$|^localhost$|^127\./.test(host)) {
        const known = HOSTS.find(([re]) => re.test(host));
        return known ? known[1] : host.slice(0, 60);
      }
    } catch {}
  }
  const app = APPS.find(([re]) => re.test(browser || ''));
  return app ? app[1] : 'direct or unknown';
}

// `touch` is the page's maxTouchPoints: an iPad says it's a Mac unless you ask that
export function device(ua, touch = 0) {
  let tablet = /iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua);
  const phone = !tablet && /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua);
  let os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'other';
  if (os === 'macOS' && touch > 1) { os = 'iOS'; tablet = true; }
  const browser = /Instagram/.test(ua) ? 'Instagram app'
    : /FBAN|FBAV/.test(ua) ? 'Facebook app'
    : /musical_ly|TikTok|BytedanceWebview/i.test(ua) ? 'TikTok app'
    : /Snapchat/.test(ua) ? 'Snapchat app'
    : /LinkedInApp/.test(ua) ? 'LinkedIn app'
    : /GSA\//.test(ua) ? 'Google app'
    : /Edg(A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'other';
  return { device: tablet ? 'tablet' : phone ? 'phone' : 'desktop', os, browser };
}
