-- Reports v2 columns for a database made before them (the live one, 2026-10-29).
-- Apply once: npx wrangler@4.150.0 d1 execute offgrid --remote --file=migrations/0002_reports_v2.sql
ALTER TABLE reports ADD COLUMN details TEXT;
ALTER TABLE reports ADD COLUMN note TEXT;
ALTER TABLE reports ADD COLUMN note_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE reports ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN on_site INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN acc_bucket INTEGER;
