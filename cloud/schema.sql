-- OFFGRID online reports (Cloudflare D1, SQLite). Reports, meta and votes are the same tables
-- as the hub (app/services/reports.py); hits, accounts, sessions and audit are cloud-only.
-- Apply with: npx wrangler d1 execute offgrid --remote --file=schema.sql (tools/cloud_admin.mjs setup)

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
  location_id TEXT, edge_id INTEGER, road_name TEXT,
  created_at REAL NOT NULL, expires_at REAL NOT NULL,
  confirms INTEGER NOT NULL DEFAULT 0, disputes INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0, removed INTEGER NOT NULL DEFAULT 0,
  -- Reports v2 (also in migrations/0002_reports_v2.sql for databases made before it)
  details TEXT, note TEXT, note_status TEXT NOT NULL DEFAULT 'none', flagged INTEGER NOT NULL DEFAULT 0,
  on_site INTEGER NOT NULL DEFAULT 0, acc_bucket INTEGER
);
CREATE INDEX IF NOT EXISTS reports_expires ON reports (expires_at);

CREATE TABLE IF NOT EXISTS votes (
  report_id TEXT NOT NULL, device_hash TEXT NOT NULL, vote TEXT NOT NULL,
  PRIMARY KEY (report_id, device_hash)
);

-- Rate limits: salted hashes of a phone id or a network address, with the time. Deleted
-- after an hour (network addresses are never stored as they are).
CREATE TABLE IF NOT EXISTS hits (key TEXT NOT NULL, at REAL NOT NULL);
CREATE INDEX IF NOT EXISTS hits_key ON hits (key, at);

-- Responder accounts, made by the admin with tools/cloud_admin.mjs. Passwords are long random
-- strings made by that tool, stored only as a salted SHA-256.
CREATE TABLE IF NOT EXISTS accounts (
  name TEXT PRIMARY KEY, salt TEXT NOT NULL, pw_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, failures INTEGER NOT NULL DEFAULT 0, locked_until REAL NOT NULL DEFAULT 0,
  created_at REAL NOT NULL
);

-- Logged-in responders: only a hash of each session token is stored.
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, name TEXT NOT NULL, expires_at REAL NOT NULL);

-- Who did what, and when (login, logout, verify, remove).
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at REAL NOT NULL, name TEXT NOT NULL, action TEXT NOT NULL, report_id TEXT
);
