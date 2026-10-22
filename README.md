# hesh.ca

Backyard Rail. A freestyle ski rail jam in a London, Ontario backyard.

Live at [hesh.ca](https://hesh.ca). Instagram [@backyardrail](https://instagram.com/backyardrail).

## What this is

A single-page scroll story with an era-chaptered timeline, photo strips,
two video sections and a signup form. Static site, no build step: plain
HTML with inline CSS and JS, plus images, fonts and video.

## Layout

```
public/
  index.html      the whole site, inline CSS + JS
  signup.html     signup page
  img/            photos by era (roots, build, jam1, jam2, allseason, redbull)
  fonts/          Hubot Sans, Michroma (both OFL, licences alongside)
  *.mp4           the two video clips
wrangler.jsonc    Cloudflare Worker (static assets) config
```

## Deploying

Deploys to a Cloudflare Worker serving static assets, on push to `main`.

To deploy by hand:

```
npx wrangler deploy
```

## History

This repo was reconstructed in September 2026 from the live site after the
original project folder was lost. The site had been deployed by hand with
Wrangler and was never under version control.
