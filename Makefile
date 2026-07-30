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
# dist/ is staged by hand here, mirroring what .github/workflows/deploy.yml stages
# for the real deploy. Offline the version badge is irrelevant, so index.html is a
# plain copy rather than a version-stamped one.
#
# _headers MUST be copied in: wrangler only applies it from INSIDE the served
# directory (same reason the deploy workflow does `cp _headers dist/`). Without it
# `make dev` serves no CSP, which is exactly the header most likely to break the
# game — so this copy is what makes the CSP locally testable at all.
dev: schema
	@mkdir -p dist && cp index.html _headers dist/
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
