# hesh.ca

Backyard Rail. A freestyle ski rail jam in a London, Ontario backyard.

Live at [hesh.ca](https://hesh.ca). Instagram [@backyardrail](https://instagram.com/backyardrail).

## What this is

A single-page scroll story with an era-chaptered timeline, photo strips,
two video sections and a signup form. Static site, no build step: plain
HTML with inline CSS and JS, plus images, fonts and video. The signup form
posts to a Pages Function that checks Cloudflare Turnstile and saves to D1.

## Layout

```
public/
  index.html      the whole site, inline CSS + JS
  signup.html     signup page (Turnstile widget, posts to /api/signup)
  _headers        security headers (CSP, framing, HSTS)
  img/            photos by era (roots, build, jam1, jam2, allseason, redbull)
  fonts/          Hubot Sans, Michroma (both OFL, licences alongside)
  *.mp4           the two video clips
functions/api/
  signup.js       POST /api/signup: Turnstile, field checks, rate limit, save to D1
  instagram.js    POST /api/instagram: marks a signup that tapped follow
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
`IP_SALT` is random and only hashes IPs for the rate limit.

## Signups

Saved in the D1 database `hesh-signups`, one row per email. To see them:

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
```

then `npx wrangler d1 migrations apply hesh-signups --local` and `npx wrangler pages dev`.
`ALLOW_TEST_KEYS` only exists locally; production accepts real tokens only.

## History

This repo was reconstructed in September 2026 from the live site after the
original project folder was lost. The site had been deployed by hand with
Wrangler and was never under version control.
