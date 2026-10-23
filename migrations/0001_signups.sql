-- signups from hesh.ca/signup, written by functions/api/signup.js
CREATE TABLE signups (
  id TEXT PRIMARY KEY,                  -- random; the done screen uses it to mark an instagram follow
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,           -- lowercased; signing up again updates the same row
  phone TEXT,
  source TEXT NOT NULL,                 -- ?src= on the signup link, e.g. booth-qr
  instagram INTEGER NOT NULL DEFAULT 0, -- 1 once they tapped follow @backyardrail
  visitor_id TEXT,                      -- the site's analytics id, when the browser has one
  ip_hash TEXT NOT NULL,                -- sha-256 of the ip with a secret salt, only for the rate limit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX signups_ip_recent ON signups (ip_hash, updated_at);
