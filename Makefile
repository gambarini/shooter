.PHONY: serve dev schema test

# Static-only server: fastest way to play the game, but it has NO functions
# runtime, so /api/scores 404s and the leaderboard shows "OFFLINE". Use `make dev`
# when you need the leaderboard.
serve:
	@echo "NEON STRIKE → http://localhost:8000  (Ctrl+C to stop)"
	@python3 -m http.server 8000

# Full local stack: static site AND the leaderboard Function against a real local
# D1 (SQLite under .wrangler/state). No deploy, no network, no Cloudflare account
# needed beyond the one-time `npx wrangler login`.
#
# dist/ is staged by hand here because wrangler needs the directory to exist and
# item 53 owns the real version-stamping build; offline the version badge is
# irrelevant, so a plain copy is right.
dev: schema
	@mkdir -p dist && cp index.html dist/
	@echo "NEON STRIKE + leaderboard → http://localhost:8788  (Ctrl+C to stop)"
	@npx wrangler pages dev

# Apply the leaderboard schema to the LOCAL D1. Idempotent (every statement is
# IF NOT EXISTS), so `make dev` runs it every time.
schema:
	@npx wrangler d1 execute neon-strike --local --file=./schema.sql >/dev/null
	@echo "local D1 schema applied"

# The pure leaderboard core's unit tests — the exact command item 53's GitHub
# Actions workflow runs as a deploy gate. The filename is named explicitly on
# purpose: `node --test <dir>` exits 0 when it finds nothing.
test:
	@node --test lib/leaderboard-core.test.mjs
