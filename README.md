# hesh.ca

Backyard Rail. A freestyle ski rail jam in a London, Ontario backyard.

Live at [hesh.ca](https://hesh.ca). Instagram [@backyardrail](https://instagram.com/backyardrail).

## What this is

A single-page scroll story with an era-chaptered timeline, photo strips,
two video sections and a signup form. Static site, no build step: plain
HTML with inline CSS and JS, plus images, fonts and video. The signup form
posts to a Pages Function that checks Cloudflare Turnstile and saves to D1.
The site tracks its own visits into the same database, and a private portal at
`/admin` shows signups, visits and who opened each outreach link.

## Layout

```
public/
  index.html      the whole site, inline CSS + JS
  signup.html     signup page (Turnstile widget, posts to /api/signup)
  t.js            the site's tracker, on both pages (posts to /api/t)
  admin/          the /admin portal: sign-in page, dashboard, its CSS and JS
  _headers        security headers (CSP, framing, HSTS)
  img/            photos by era (roots, build, jam1, jam2, allseason, redbull)
  fonts/          Hubot Sans, Michroma (both OFL, licences alongside)
  *.mp4           the two video clips
functions/
  api/signup.js   POST /api/signup: Turnstile, field checks, rate limit, save to D1
  api/instagram.js  POST /api/instagram: marks a signup that tapped follow
  api/t.js        POST /api/t: tracking batches from t.js
  r/[code].js     /r/<code>: outreach links, records the open and redirects
  admin/          the sign-in gate (_middleware.js) and the portal's api
lib/              code the functions share (sessions, Turnstile, visitor details, daily totals)
migrations/       D1 schema for the hesh-signups database
wrangler.jsonc    Cloudflare Pages config: output dir, D1 binding, vars
```

## Deploying

Cloudflare Pages project `hesh`, built from `main` on every push (no build
command, output directory `public`). `functions/` deploys with it.

Secrets live on the Pages project, not in the repo:

```
npx wrangler pages secret list --project-name hesh
```

`TURNSTILE_SECRET` is the secret key of the "hesh.ca signup" Turnstile widget,
`IP_SALT` is random and hashes IPs (nothing stores a raw IP), and `ADMIN_PASSWORD`
is the `/admin` password, 12 characters or more. Pages only picks up a changed
secret on the next deployment.

```
npx wrangler pages secret put ADMIN_PASSWORD --project-name hesh
```

## Admin

[hesh.ca/admin](https://hesh.ca/admin), behind the password and Turnstile. Five
wrong passwords from one network locks it for 15 minutes, 30 from anywhere for
an hour. A session lasts 14 days; changing `ADMIN_PASSWORD` signs every browser out.

- **overview**: visitors, visits, time on site, signups, where visits came from,
  where people are, what they read, video, clicks, photos, the snow gun, the form
- **outreach**: make a link per email (`hesh.ca/r/<code>`), then see whether it was
  opened, by a person or a company's mail scanner, and everything they did after
- **signups**: the list, with what each person looked at first, and a CSV export
- **visitors**: every browser, with every visit and event
- **live**: who's on the site right now

Signing in marks that browser as yours, so your own visits stay out of the numbers.
Mark another device as yours from its visitor page.

### How tracking is stored

Built to fit D1's free plan (100,000 rows written and 5 million read a day) at well
over 1,000 visits a day:

- A visit is one row in `sessions`. Every event in it is packed into its `log`
  column, and each batch from the page (`public/t.js` sends one every 20 seconds
  at most, and when the tab closes) is one update of that row. A full visit with a
  signup measured 16 rows written; most visits are fewer.
- The visitor row is written once a visit, not once a page.
- The overview reads finished days from `days` and `day_counts`, which are added up
  in SQL the first time they're asked for (`lib/rollup.js`). Only today is counted
  from the visits. Days run midnight to midnight in Ontario.
- Marking a visitor as a bot or as you redoes the daily totals from their first visit.
- Nothing is thrown away: the visitor and link pages show every event from the logs.

To read a visit's events in SQL: `SELECT e.value FROM sessions, json_each('[' || log || ']') e WHERE id = '<visit id>'`.

## Signups

Saved in the D1 database `hesh-signups`, one row per email. To see them (or use /admin):

```
npx wrangler d1 execute hesh-signups --remote --command "SELECT name, email, phone, source, instagram, created_at FROM signups ORDER BY created_at DESC"
```

Schema changes go in a new file in `migrations/`, then:

```
npx wrangler d1 migrations apply hesh-signups --remote
```

To run it locally, put Turnstile's test keys in `.dev.vars` (gitignored):

```
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
IP_SALT=local-dev-only
ALLOW_TEST_KEYS=1
ADMIN_PASSWORD=any-local-password
```

then `npx wrangler d1 migrations apply hesh-signups --local` and `npx wrangler pages dev`.
`ALLOW_TEST_KEYS` only exists locally; production accepts real tokens only.

## History

This repo was reconstructed in September 2026 from the live site after the
original project folder was lost. The site had been deployed by hand with
Wrangler and was never under version control.
