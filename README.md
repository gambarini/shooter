# NEON STRIKE

A single-file 3D arena wave shooter — clear the arena, switch weapons, survive the swarm.
Built with [three.js](https://threejs.org/) and a whole lot of neon. No build step, no
dependencies, no bundler: the entire game is one `index.html`.

**▶ Play:** <https://lustrous-chimera-efa4db.netlify.app/>

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

Hosted on Netlify as a no-build static site — `netlify.toml` publishes the repo root with
no build command. Every push to `main` auto-deploys.
