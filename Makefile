.PHONY: serve dev schema test playtest

# These comments explain ONLY why each recipe is written the way it is — the
# staging, the copies, the explicit filename. What each target gives you and when
# to run it is CLAUDE.md's "Run / verify" — point there, never restate it here.

serve:
	@echo "NEON STRIKE → http://localhost:8000  (Ctrl+C to stop)"
	@python3 -m http.server 8000

# Needs no Cloudflare account beyond the one-time `npx wrangler login`; the D1 it
# talks to is local SQLite under .wrangler/state, so nothing here touches network.
#
# dist/ is staged by hand here, mirroring what .github/workflows/deploy.yml stages
# for the real deploy. Offline the version badge is irrelevant, so index.html is a
# plain copy rather than a version-stamped one.
#
# _headers MUST be copied in: wrangler only applies it from INSIDE the served
# directory (same reason the deploy workflow does `cp _headers dist/`), so
# deleting this line drops the CSP from the local run.
dev: schema
	@mkdir -p dist && cp index.html _headers dist/
	@echo "NEON STRIKE + leaderboard → http://localhost:8788  (Ctrl+C to stop)"
	@npx wrangler pages dev

# Apply the leaderboard schema to the LOCAL D1. Idempotent (every statement is
# IF NOT EXISTS), so `make dev` runs it every time.
schema:
	@npx wrangler d1 execute neon-strike --local --file=./schema.sql >/dev/null
	@echo "local D1 schema applied"

# The filename is named explicitly on purpose: pointed at a directory, `node
# --test` exits 0 with "no tests found", so a renamed or deleted test file would
# pass silently instead of failing.
test:
	@node --test lib/leaderboard-core.test.mjs

# Unattended browser playtest (roadmap item 58). tools/playtest/README.md owns
# what it runs, what it checks and every ARGS option — keep that out of this
# comment as well; a third copy of that paragraph is how the first one drifted
# (item 74). `node tools/playtest/run.mjs --help` prints the flags.
playtest:
	@node tools/playtest/run.mjs $(ARGS)
