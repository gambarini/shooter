# NEON STRIKE

A single-file 3D arena wave shooter — clear the arena, switch weapons, survive the swarm.
Built with [three.js](https://threejs.org/) and a whole lot of neon. No build step, no
dependencies, no bundler: the entire game is one `index.html`.

**▶ Play:** <https://neon-strike-7b6.pages.dev/>

## Controls

| Input | Action |
| --- | --- |
| `WASD` | Move |
| `Mouse` | Aim |
| `Click` | Fire |
| `1` · `2` · `3` | Switch weapon — Blaster · Shotgun · Rocket |
| `Shift` | Sprint |
| `Q` | Dash |
| `E` | Nova (screen-clearing burst) |
| `Space` | Jump |
| `R` | Reload |
| `Esc` / `P` | Pause |

Touch controls are built in for mobile.

## Run locally

There's no build step. Serve the folder over HTTP (pointer lock is more reliable than
opening the file directly):

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Or just `make serve`. You *can* `open index.html` directly, but HTTP is recommended for
pointer lock and module imports.

## How it works

- Everything lives in **`index.html`**: CSS → HUD markup → one `<script type="module">`.
- three.js is loaded from the unpkg CDN over HTTPS — nothing to install.
- All audio is synthesized with the Web Audio API — no audio files.
- Fight escalating waves, pick an upgrade between each, and chase a high score.

## Development

| Command | What it gives you |
| --- | --- |
| `make serve` | The game at <http://localhost:8000>. Static only — `/api/scores` 404s and the leaderboard shows OFFLINE. |
| `make dev` | The full stack at <http://localhost:8788>: game, leaderboard Function, a real local D1, and the `_headers` CSP. Use this whenever you touch `functions/` or `lib/`. |
| `make test` | The leaderboard core's unit tests — the same command CI gates deploys on. |

The game itself has **no tests**; verification is playtesting. After any change: start a run,
play 3+ waves, die or restart once, then play one more wave, watching the FPS counter
(Settings → SHOW FPS) during shotgun spam. Always test a fresh run *and* a restart — most
state-leak bugs only show up on the second run.

### The roadmap lives in Notion

Feature work is tracked in Notion, not in this repo — `PLAN.md` is only a stub pointing there.

- **Roadmap HQ** — the workflow, codebase conventions, and the browser-verification recipe:
  <https://app.notion.com/p/39b2711a768d819cbb8de2a85019926b>
- **Roadmap** — one row per item, with the spec in the row's page:
  <https://app.notion.com/p/368c46f62b7d45918ce31e9042a9e4c0>
- **Session Log** — one entry per session (what landed, tuning values chosen, what the next
  session should know): <https://app.notion.com/p/112e601ffa444653a30a0b178a3e7315>

The loop is deliberately small: **one item = one commit = one tag.** Pick the first `todo` in
`#` order, set it to `wip`, read the item's spec and the conventions, implement it, playtest
it, then commit (`PLAN item N: …`), tag it, and close the item out with a Session Log entry.
Items are never batched — each one stays independently playable and revertable.

### Working an item with Claude Code

The six steps above are the whole loop and running them by hand is always fine.
`/roadmap-item` is that same loop packaged as a skill, in two modes:

| Invocation | What runs |
| --- | --- |
| `/roadmap-item` | **Solo** — the next `todo` item in a single session. Spawns nothing. |
| `/roadmap-item 19` | Solo, on a specific item. |
| `/roadmap-item fanout` | Brackets the edit with two read-only agent fan-outs. |
| `/roadmap-item recon` · `review` | Just one fan-out — handy mid-item from a solo run. |

In `fanout` mode, **recon** runs before the edit (hook-point anchors, the closest existing
pattern to copy, a `resetGame` teardown inventory, touch/HUD surfaces, convention landmines)
and **review** runs after it (state leaks across a restart, the point-light and
per-frame-allocation budget, touch parity, conventions, plus one agent per "Done when"
bullet). Both are strictly read-only: they produce a brief and a findings list, and the edit,
the playtest, the Notion updates and the commit stay in the one main session either way.
`index.html` is a single file, so there is only ever one writer.

Reach for `fanout` on unfamiliar code, new entity types, or items with several "Done when"
criteria; stay solo for tuning, copy and config. The skill lives in
`.claude/skills/roadmap-item/`, the two workflows in `.claude/workflows/`.

## Deploy

Hosted on **Cloudflare Pages** as a no-build static site, deployed by
`.github/workflows/deploy.yml` on every push to `main` (Direct Upload via
`wrangler-action` — the repo is deliberately *not* connected to Cloudflare's dashboard
git integration, so the whole pipeline stays version-controlled). The workflow stages
just `index.html` plus `_headers` into a `dist/` directory, so the live site ships only
the game and none of the repo's dev docs. Pushes that touch only docs are skipped via
`paths-ignore`, and the deploy is gated on `node --test lib/leaderboard-core.test.mjs`.
Tags are not a separate deploy trigger.

The leaderboard endpoint at `/api/scores` ships with the same deploy: `functions/api/`
is compiled into a Pages Function, bound to a D1 database by `wrangler.toml`.

The workflow also stamps a version onto the page: `index.html` has a literal
`__VERSION__` placeholder (small badge on the start/pause cards), and the deploy runs
`git describe --tags` and `sed`s the result in, so the live badge always self-reports
exactly what's deployed. Serving the raw file locally (no build step) shows `dev` instead.

Versioning is `vMAJOR.MINOR.PATCH` git tags, staying in `v0.x` pre-1.0. Every roadmap
item's close-out (see `CLAUDE.md`) tags its own commit — a shipped feature bumps MINOR, a
bugfix bumps PATCH — and pushes the tag with `git push --tags`.
