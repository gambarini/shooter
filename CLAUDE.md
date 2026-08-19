# NEON STRIKE — project guide

Single-file 3D arena wave shooter. All code lives in `index.html` (CSS → HUD markup → one
`<script type="module">` using three.js from the unpkg CDN). No build step and no runtime
dependencies. The game has no unit tests — it is verified by `make playtest` (automated
browser run, item 58) plus playing it. The only unit-tested code is the leaderboard
backend's pure core (`lib/leaderboard-core.mjs`), covered by
`lib/leaderboard-core.test.mjs` under plain `node --test`; the deploy workflow runs it as a
gate, so it must stay green.

## Where each instruction lives

Every instruction has exactly ONE owner. The other surfaces point at the owner instead of
paraphrasing it — a paraphrase is the thing that drifts (item 58 updated three surfaces and
missed the fourth; item 60 needed a whole extra commit to repair a cross-reference).

| Topic | Owner |
| --- | --- |
| The roadmap loop, close-out, draining the two queues | **this file** |
| Code conventions, the point-light budget, `resetGame` rules | **this file** |
| Run / verify commands and the human half of verification | **this file** |
| Notion addresses (HQ, Roadmap, Session Log, data source IDs) | **this file** |
| *What* to build: item specs, phase order, dependencies, Session Log entry format, `Spot-checks owed` semantics | **the Notion HQ page** |
| `/roadmap-item` modes, the fan-out topology, the two workflow invocations | **`.claude/skills/roadmap-item/SKILL.md`** |
| The playtest harness: what it checks, how it drives the game, how to extend it | **`tools/playtest/README.md`** |

Notion owns *what to build*; the repo owns *how to work*.

**A process change is a one-file edit.** If a change makes you edit two owners, the split
above is wrong — fix the split rather than writing the sentence twice.

## Run / verify

- `make serve` → http://localhost:8000 (static only: `/api/scores` 404s, board shows
  OFFLINE). `open index.html` works too, but pointer lock is more reliable over http.
- `make dev` → http://localhost:8788 — the full stack, including the leaderboard Function
  against a real local D1. Use this whenever a change touches `functions/` or `lib/`.
- `make test` → the leaderboard core's unit tests (the same command CI gates deploys on).
  Required whenever a change touches `lib/` or `functions/`.
- `make playtest` → the unattended browser playtest. Required after any change to
  `index.html`.

### The automated half — `make playtest`

~45s: its own static server and its own dedicated Chrome, several waves, two death/restart
cycles, asserting the invariants a human watching the screen cannot see — leaks, pool
conservation, the point-light budget, console errors, frame time. Exits non-zero on
failure.

**`tools/playtest/README.md` is the reference** — the full check list, every option, and how
to extend it. Read it before touching the rig. If the harness cannot check something your
item needs, add a scenario or a `SNAPSHOT` field there; never hand-roll a throwaway script
(the README says why, and it is this repo's most-repeated mistake).

### The human half — still required

`make playtest` passing is not "verified". It runs with the pause handlers disabled
(`probe.driven`) and it cannot judge anything aesthetic.

1. **Play it**: start a run → 3+ waves → die or restart → 1+ more wave. Test a fresh run
   **AND** a restart — most state-leak bugs only show on the second run.
2. **Feel is not automatable**: recoil weight, audio pitch, bloom intensity, readability,
   whether a warning gives fair reaction time. Automation confirms presence, never
   intensity — these always get a user playtest as the final word.
3. **Pause paths are automation-blind**: Esc mid-fight, alt-tab, click-to-relock, and
   firing that needs a real pointer lock.
4. **Verify visuals with screenshots**, several compass directions for world-scale changes.
5. **Write down what you could not check** in the Session Log entry's `Spot-checks owed`
   property — not only in the prose body.

## Deploy

Cloudflare Pages, Direct Upload, driven entirely by `.github/workflows/deploy.yml` on
pushes to `main` — never from Cloudflare's dashboard (the project is deliberately not
git-connected, and that choice is a one-way door). `_headers` carries the security/cache
headers; `wrangler.toml` carries the D1 binding. Live: https://neon-strike-7b6.pages.dev/

## Roadmap workflow (the progressive loop)

**The roadmap/plan is managed in NOTION, not in this repo.** The Notion HQ page is the
single source of truth for *what* to build; `PLAN.md` is only a stub pointing there. Read
AND update the plan via the Notion MCP tools (`mcp__notion__*`). If the Notion MCP server is
not connected, stop and ask the user to connect it (`/mcp`) — do not fall back to editing
PLAN.md.

- HQ page (item specs' home, phase order, Session Log format):
  https://app.notion.com/p/39b2711a768d819cbb8de2a85019926b
- Roadmap database (one row per item, spec in the row's page):
  https://app.notion.com/p/368c46f62b7d45918ce31e9042a9e4c0
  — data source `collection://2bab5b91-2cad-44b1-8aa3-2f820594f0c4`
- Session Log database (one entry per session):
  https://app.notion.com/p/112e601ffa444653a30a0b178a3e7315
  — data source `collection://8d944ded-d820-4bde-9cdd-e9b83c5349b6`

Each session does exactly ONE item:

1. **Pick**: first check nothing is already `wip` — if something is, resume that instead of
   starting a new one. Otherwise query the Roadmap data source and take the first `todo`
   item in `#` order, unless the user names one:

   ```sql
   SELECT * FROM "collection://2bab5b91-2cad-44b1-8aa3-2f820594f0c4"
   WHERE Status = 'todo' ORDER BY "#" ASC LIMIT 5
   ```

   Respect the dependencies in the HQ page's "Suggested order".
2. **Claim**: set the item's Status to `wip` in the Roadmap database.
3. **Read first**: the item's row page (spec), the "Code conventions" section below, and the
   functions named in the item's "Hook points" — before writing any code.
4. **Implement**: stay within the item's scope. If you discover a bug or an improvement
   outside scope, don't fix it now — write it down, and file it as its own Roadmap row at
   close-out (step 6). Noting it only in Session Log prose is not enough: that queue is
   write-only and nothing ever reads it back (the minimap heading bug was re-noted in items
   49, 50 and 51 without ever becoming a task).
5. **Verify**: exercise every "Done when" criterion of the item, plus the automated and
   human halves under "Run / verify" above.
6. **Close out**, in this order:
   - Commit the code: `PLAN item N: <short description>`.
   - Tag the commit `vMAJOR.MINOR.PATCH` (annotated: `git tag -a v0.x.0 -m "..."`) and
     `git push --tags` — a shipped feature bumps MINOR, a bugfix bumps PATCH, staying in
     `v0.x` pre-1.0. This is the version the live site's badge self-reports (see item 35).
     Commit first, because this step and the next need the hash.
   - Set the item's Status to `done` and fill its `Commit hash` property with the short
     hash. (The `Commit` column is a read-only formula that renders the hash as a clickable
     GitHub commit link — don't write to it.)
   - Create a Session Log entry in Notion (format on the HQ page): what landed, tuning
     values chosen, anything the next session should know.
   - **Drain both queues — the session is not closed until they are empty:**
     - Every out-of-scope finding from step 4 becomes a new `todo` row in the Roadmap
       database, in this same session. Title, `Goal` and a one-line spec is enough — the
       point is that it exists, not that it is fully specced. Small related fixes may
       share one "bug sweep" row rather than one row each. If you decide not to file
       something, the Session Log entry must say "declined, because …". Silence is not an
       option.
     - Every check automation could not make goes in the Session Log entry's
       `Spot-checks owed` property, not only in the prose body. A later session that makes
       the check writes the verdict into that property or clears it; if the list is big
       enough to need setup, file it as its own Roadmap row instead (see item 62).
   - If the item changed the *process* rather than the game, check the diff touched exactly
     one of the owners in "Where each instruction lives". Two owners for one process change
     means the split is wrong — fix the split, don't write the sentence twice.

One item = one commit. Don't batch items; the point is each change is playable and
revertable on its own.

The six steps above are the whole loop, and running them by hand in one session is always a
valid way to work. `/roadmap-item` is the same loop packaged as a skill — solo by default,
with an optional `fanout` mode that brackets the edit with read-only recon and review agent
fan-outs. `.claude/skills/roadmap-item/SKILL.md` owns the modes and what each one runs.

## Code conventions (read before any item)

- **Anchors are function names, not line numbers** — lines shift as items land. Key
  anchors: `fireWeapon`, `damageEnemy`, `killEnemy`, `damagePlayer`, `spawnEnemy`,
  `spawnBoss`, `update(dt)` (main per-frame logic), `startWave`, `showUpgrades` /
  `pickUpgrade`, `resetGame` (must reset ALL new state), `collectPickup`, `explodeRocket`.
- **Point lights are a hard budget** (2026-07-09 perf fix): every `PointLight` multiplies
  the fragment cost of ALL lit materials scene-wide — per-entity lights tanked wave 13+ to
  ~6 FPS. Never attach lights to anything that scales with wave or entity count (enemies,
  shots, barrels…); bounded singletons (boss, nova, laser sweep) are fine. Emissive
  material plus a basic-material core mesh gives the neon glow without lights.
- **Pooling**: particles and tracers are pooled (`particlePool`, `tracerPool`). Anything
  spawned per-hit/per-kill/per-frame MUST pool the same way — no allocation inside
  `update(dt)`.
- **Disposal**: anything removed from the scene disposes its geometry/material unless
  shared (see `disposeEnemy`, `SHARED_ENEMY_GEO`). New entity types need the same
  treatment.
- **`resetGame` is the leak gate**: everything added to the scene per-run is cleared there,
  and new per-run state lives on `state` or `mods` and resets there too.
- **Run modifiers**: per-run upgrade state lives in the `mods` object (`baseMods()`), reset
  each run. New upgrade effects add a field to `baseMods()` and read it where relevant.
- **State flags**: `state.running / paused / choosing` gate `update`. `state.stats` feeds
  the death screen.
- **Audio** is synthesized via the `sfx` object (`beep`/`noiseBurst`) — never audio files.
- **HUD**: DOM elements are referenced via the `ui` object; transient text uses
  `flashCombo` (center, big) and `flashTip` (below crosshair, small).
- **New enemy types**: add to the minimap colors, verify `disposeEnemy` covers their
  children, and confirm they respect `collideArena` (or deliberately don't, like WASP).
- **New upgrades**: add to `UPGRADES` with a rarity, and verify they reset via `baseMods()`.
- **New abilities/keys** need a touch-control counterpart (see the `#touch` block) or an
  explicit keyboard-only note in the Session Log.
- Keep the neon aesthetic: cyan `#00f0ff`, hot pink `#ff2e88`, emissive glow everywhere.
