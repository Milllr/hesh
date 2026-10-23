-- site tracking and outreach links, read by the /admin portal.
-- written by functions/api/t.js (the page beacon), functions/r/[code].js (outreach links),
-- functions/admin/api/login.js, and lib/rollup.js (the daily totals).
--
-- built for the free D1 plan's 100,000 rows written a day. A visit is one row: every event
-- in it is packed into sessions.log, and each batch from the page is one UPDATE of that row.
-- that's about 15 rows written a visit. Indexes are few on purpose, since each index on a
-- table is another row written per insert.

-- one per outreach email: hesh.ca/r/<code> sends them to the site and records the open
CREATE TABLE links (
  code TEXT PRIMARY KEY,                -- the part after /r/, lowercase
  label TEXT NOT NULL,                  -- who it went to, e.g. "Jane at Acme"
  org TEXT,
  email TEXT,                           -- where it was sent, for your reference
  note TEXT,
  dest TEXT NOT NULL DEFAULT '/',       -- where the link lands on the site
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- every open of an outreach link, including mail scanners that never load the page
CREATE TABLE link_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  at TEXT NOT NULL,
  visitor_id TEXT,                      -- the browser's hesh_vid cookie (new if it had none)
  method TEXT,
  ua TEXT,
  country TEXT, region TEXT, city TEXT,
  asn INTEGER, as_org TEXT,             -- the network, e.g. a company or an ISP
  ip_hash TEXT,
  scanner INTEGER NOT NULL DEFAULT 0    -- 1 when it looks like a mail scanner rather than a person
);
CREATE INDEX link_hits_code ON link_hits (code);
CREATE INDEX link_hits_visitor ON link_hits (visitor_id);

-- one per browser (the hesh_vid cookie). Written once a visit, not once a page.
CREATE TABLE visitors (
  id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,              -- when its latest visit started
  link_code TEXT,                       -- the first outreach link this browser opened
  first_referrer TEXT,
  first_landing TEXT,
  first_campaign TEXT,                  -- ?src= / utm tags on the first visit
  first_source TEXT,                    -- those, in a word: instagram, booth-qr, google...
  country TEXT, region TEXT, city TEXT, timezone TEXT,
  asn INTEGER, as_org TEXT,
  device TEXT, os TEXT, browser TEXT, ua TEXT,
  screen TEXT, lang TEXT,
  ip_hash TEXT,
  bot INTEGER NOT NULL DEFAULT 0,       -- 1 when it looks automated
  me INTEGER NOT NULL DEFAULT 0         -- 1 for the admin's own browsers
);
CREATE INDEX visitors_last ON visitors (last_seen);
-- only browsers that came in on an outreach link are in this one, so it costs nothing for the rest
CREATE INDEX visitors_link ON visitors (link_code) WHERE link_code IS NOT NULL;

-- one per visit: a run of page views with no 30 minute gap, and everything that happened in it
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                  -- made by the page
  visitor_id TEXT NOT NULL,
  day TEXT NOT NULL,                    -- the date it started in Ontario, YYYY-MM-DD, for the daily totals
  started_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  link_code TEXT,                       -- set when the visit came straight from an outreach link
  landing TEXT,
  referrer TEXT,
  campaign TEXT,
  source TEXT,                          -- referrer and campaign in a word, worked out once here
  pageviews INTEGER NOT NULL DEFAULT 0,
  engaged_ms INTEGER NOT NULL DEFAULT 0,  -- time the tab was visible and in use
  max_scroll INTEGER NOT NULL DEFAULT 0,  -- percent of the page
  interacted INTEGER NOT NULL DEFAULT 0,  -- 1 once they scrolled, tapped, clicked or typed
  flags INTEGER NOT NULL DEFAULT 0,       -- 1 reached the signup section, 2 opened /signup, 4 signed up, 8 tapped instagram
  beacons INTEGER NOT NULL DEFAULT 0,     -- batches received, for the rate limits
  n INTEGER NOT NULL DEFAULT 0,           -- events in log
  -- every event, oldest first, as comma-joined json arrays: [ms after started_at, type, label, value, path]
  -- (label, value and path left off when empty; path is / unless it says otherwise). Read it as
  -- json by wrapping it in [ ], e.g. json_each('[' || log || ']').
  log TEXT NOT NULL DEFAULT '',
  last TEXT,                              -- the newest event, for the live view
  country TEXT, region TEXT, city TEXT,
  as_org TEXT,
  device TEXT, os TEXT, browser TEXT,
  ip_hash TEXT
);
CREATE INDEX sessions_visitor ON sessions (visitor_id);
CREATE INDEX sessions_started ON sessions (started_at);
CREATE INDEX sessions_ip ON sessions (ip_hash, started_at);

-- the overview's numbers for finished days, made from sessions the first time /admin asks
-- for them, so a long date range reads a row a day instead of every visit and every event.
-- meta.rollup_to is the first day not done yet; marking a visitor as a bot (or as you) moves it back.
CREATE TABLE days (
  day TEXT PRIMARY KEY,
  visits INTEGER NOT NULL,
  visitors INTEGER NOT NULL,
  pageviews INTEGER NOT NULL,
  engaged INTEGER NOT NULL,
  interacted INTEGER NOT NULL,
  halfway INTEGER NOT NULL,
  saw_signup INTEGER NOT NULL,
  opened_signup INTEGER NOT NULL,
  signed_up INTEGER NOT NULL
) WITHOUT ROWID;

-- the same days, counted by source, place, device, and event type and label
CREATE TABLE day_counts (
  day TEXT NOT NULL,
  dim TEXT NOT NULL,                    -- source | place | device | event
  a TEXT NOT NULL,                      -- source; country; device; event type
  b TEXT NOT NULL,                      -- region; os; event label
  c TEXT NOT NULL,                      -- city; browser
  n INTEGER NOT NULL,                   -- visits, or events
  visits INTEGER NOT NULL,              -- visits with the event
  total INTEGER NOT NULL,               -- the events' values added up (seconds read, ms held...)
  PRIMARY KEY (day, dim, a, b, c)
) WITHOUT ROWID;

CREATE TABLE meta (
  k TEXT PRIMARY KEY,
  v TEXT
) WITHOUT ROWID;

-- admin sign-in attempts, for the lockout
CREATE TABLE admin_logins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  ok INTEGER NOT NULL
);
CREATE INDEX admin_logins_at ON admin_logins (at);

-- a shared booth device signs many people up, so signups find their visitor by this
CREATE INDEX signups_visitor ON signups (visitor_id);
