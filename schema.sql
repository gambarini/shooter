-- NEON STRIKE — leaderboard schema (D1 / SQLite), roadmap item 52.
--
-- Apply locally:   npx wrangler d1 execute neon-strike --local  --file=./schema.sql
-- Apply remotely:  npx wrangler d1 execute neon-strike --remote --file=./schema.sql
-- Every statement is IF NOT EXISTS, so re-running it is a no-op (safe to re-apply
-- after a `.wrangler/state` wipe, which is how you reset the local board).

-- One row per submitted run. This keeps EVERY run, not just the top N — that is
-- what lets the endpoint answer "you ranked #347 of N". `created_at` is epoch ms
-- stamped by the Function (the pure core stays timestamp-free for testability).
CREATE TABLE IF NOT EXISTS runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  score      INTEGER NOT NULL,
  wave       INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Ranking index. `score DESC, id ASC` is the board's sort order: ties rank by who
-- got there first, which preserves the semantics of the old array-based
-- insertRun() this replaces. It also serves the rank query
-- (`count(*) WHERE score > ?`) as an index-only scan, so ranking no longer walks
-- every run the way rankOf() did.
CREATE INDEX IF NOT EXISTS runs_board ON runs (score DESC, id ASC);

-- Single-use submit tokens (absorbs roadmap item 39's token goal). GET /api/scores
-- inserts one and hands it to the page at run start; POST consumes it by DELETE.
-- A row deleted on use is a STRONGER guarantee than the HMAC token this replaces:
-- that one was replayable by its own admission, this one works exactly once. It
-- also needs no signing secret, hence no node:crypto and no SCORE_SECRET env var.
CREATE TABLE IF NOT EXISTS submit_tokens (
  token      TEXT PRIMARY KEY,
  issued_at  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Abandoned runs (page closed mid-game) leave tokens nobody will ever consume, so
-- the GET path sweeps expired rows. This index keeps that sweep cheap.
CREATE INDEX IF NOT EXISTS submit_tokens_expires ON submit_tokens (expires_at);
