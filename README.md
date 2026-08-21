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

There's no build step — serve the folder over HTTP:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Or just `make serve`.

## How it works

- Everything lives in **`index.html`**: CSS → HUD markup → one `<script type="module">`.
- three.js is loaded from the unpkg CDN over HTTPS — nothing to install.
- All audio is synthesized with the Web Audio API — no audio files.
- Fight escalating waves, pick an upgrade between each, and chase a high score.

## Development

This README is the outward-facing half of the docs — what the game is, how to play it, and
how to get it running. Everything about *working on* it is written down once, elsewhere:

- **`CLAUDE.md`** — the `make` targets and when each one is required, how a change is
  verified (`make playtest` plus the human half that still needs a person), the code
  conventions, the deploy rules, and the roadmap loop. Its "Where each instruction lives"
  table is the index to everything below.
- **the Notion roadmap** — *what* to build: one row per item, the phase order, and one
  Session Log entry per session. `PLAN.md` is only a stub pointing there; the addresses
  are in `CLAUDE.md`.
- **`.claude/skills/roadmap-item/SKILL.md`** — `/roadmap-item`, the Claude Code skill that
  runs one roadmap item end to end, solo or bracketed by read-only agent fan-outs.
- **`tools/playtest/README.md`** — the unattended browser playtest behind `make playtest`.

## Deploy

Every push to `main` deploys the game to Cloudflare Pages, live at
<https://neon-strike-7b6.pages.dev/>. What ships is `index.html` plus `_headers`, and the
`functions/api/` leaderboard behind `/api/scores` (backed by a Cloudflare D1 database) —
none of the repo's dev docs. The version badge on the start card self-reports the git tag
the live build came from.

The pipeline is `.github/workflows/deploy.yml`, and its comments explain every step and
every pinned version. `CLAUDE.md` → "Deploy" has the constraints that must not be broken.
