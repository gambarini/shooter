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
