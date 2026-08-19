# NEON STRIKE — project guide

Single-file 3D arena wave shooter. All code lives in `index.html` (CSS → HUD markup → one
`<script type="module">` using three.js from the unpkg CDN). No build step and no runtime
dependencies. The game has no unit tests — it is verified by `make playtest` (automated
browser run, item 58) plus playing it. The only unit-tested code is the leaderboard
backend's pure core (`lib/leaderboard-core.mjs`), covered by
`lib/leaderboard-core.test.mjs` under plain `node --test`; the deploy workflow runs it as a
gate, so it must stay green.

## Run / verify

- `make serve` → http://localhost:8000 (static only: `/api/scores` 404s, board shows
  OFFLINE). `open index.html` works too, but pointer lock is more reliable over http.
- `make dev` → http://localhost:8788 — the full stack, including the leaderboard Function
  against a real local D1. Use this whenever a change touches `functions/` or `lib/`.
- `make test` → the leaderboard core's unit tests (the same command CI gates deploys on).
- `make playtest` → the unattended browser playtest (`tools/playtest/`, item 58). ~45s:
  dedicated Chrome, several waves, two death/restart cycles, and it fails on leaked
  per-run state, leaked GPU resources, dropped pooled objects, point lights over budget,
  console errors, or a frame-time regression. Run it after any change to `index.html`;
  read `tools/playtest/README.md` before extending it.
- Minimum verification after any change: `make playtest`, THEN play it yourself — start a
  run, play 3+ waves, die or restart once, play 1 more wave. The harness cannot judge
  feel, audio, bloom intensity or readability, and the Session Log should say what it
  could not judge.
- Test both a fresh run AND a restart — most state-leak bugs only show on the second run.

## Deploy

Cloudflare Pages, Direct Upload, driven entirely by `.github/workflows/deploy.yml` on
pushes to `main` — never from Cloudflare's dashboard (the project is deliberately not
git-connected, and that choice is a one-way door). `_headers` carries the security/cache
headers; `wrangler.toml` carries the D1 binding. Live: https://neon-strike-7b6.pages.dev/

## Roadmap workflow (the progressive loop)

**The roadmap/plan is managed in NOTION, not in this repo.** The Notion page
"NEON STRIKE — Roadmap HQ" is the single source of truth for feature work; `PLAN.md` is
only a stub pointing there. Read AND update the plan via the Notion MCP tools
(`mcp__notion__*`). If the Notion MCP server is not connected, stop and ask the user to
connect it (`/mcp`) — do not fall back to editing PLAN.md.

- HQ page (workflow, conventions, reminders): https://app.notion.com/p/39b2711a768d819cbb8de2a85019926b
- Roadmap database (one row per item, spec in the row's page):
  https://app.notion.com/p/368c46f62b7d45918ce31e9042a9e4c0
  — data source `collection://2bab5b91-2cad-44b1-8aa3-2f820594f0c4`
- Session Log database (one entry per session):
  https://app.notion.com/p/112e601ffa444653a30a0b178a3e7315
  — data source `collection://8d944ded-d820-4bde-9cdd-e9b83c5349b6`

Each session does exactly ONE item:

1. **Pick**: query the Roadmap database and take the first `todo` item in phase order
   (`#` order), unless the user names one. Respect dependencies noted on the HQ page
   (item 6 before 7–11).
2. **Claim**: set the item's Status to `wip` in the Roadmap database.
3. **Read first**: the "Codebase conventions" section of the HQ page, the item's row page
   (spec), and the functions named in its "Hook points" before writing any code.
4. **Implement**: stay within the item's scope. If you discover a bug or an improvement
   outside scope, note it in the Session Log entry instead of fixing it now.
5. **Verify**: run the game, exercise every "Done when" criterion of the item, plus the
   minimum verification above.
6. **Close out**:
   - Commit the code: `PLAN item N: <short description>`.
   - Tag the commit `vMAJOR.MINOR.PATCH` (annotated: `git tag -a v0.x.0 -m "..."`) and
     `git push --tags` — a shipped feature bumps MINOR, a bugfix bumps PATCH, staying in
     `v0.x` pre-1.0. This is the version the live site's badge self-reports (see item 35).
   - Set the item's Status to `done` and fill its `Commit hash` property with the short
     hash. (The `Commit` column is a read-only formula that renders the hash as a clickable
     GitHub commit link — don't write to it.)
   - Create a Session Log entry in Notion (format on the HQ page): what landed, tuning
     values chosen, anything the next session should know.

One item = one commit. Don't batch items; the point is each change is playable and
revertable on its own.

The six steps above are the whole loop, and running them by hand in one session is always a
valid way to work. `/roadmap-item` is the same loop packaged as a skill — solo by default,
so it spawns nothing. Add `fanout` (`/roadmap-item fanout`) to bracket the edit with two
read-only agent fan-outs: recon before it (hook anchors, precedent, `resetGame` inventory,
touch surfaces, convention landmines) and review after it (state leaks, point-light budget,
touch parity, conventions, one agent per "Done when" bullet). The fan-outs only produce a
brief and a findings list — the edit, the browser playtest, every Notion write and the
commit/tag stay in the main session in both modes. Worth the extra agents for unfamiliar
code, new entity types, or four-plus "Done when" bullets; skip them for tuning and copy.

## Code rules (summary — full version in the Notion HQ page conventions)

- Pool anything spawned per-hit/per-frame (see `particlePool` / `tracerPool` patterns).
- Everything added to the scene must be cleaned up in `resetGame` and disposed properly
  (see `disposeEnemy`); new per-run state lives on `state` or `mods` and resets there too.
- Audio is synthesized via the `sfx` object (`beep`/`noiseBurst`) — never audio files.
- Keep the neon aesthetic: cyan `#00f0ff`, hot pink `#ff2e88`, emissive glow everywhere.
- New abilities/keys need a touch-control counterpart (see the `#touch` block) or an
  explicit keyboard-only note in the Session Log.
