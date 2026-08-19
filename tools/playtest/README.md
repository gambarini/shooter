# `tools/playtest` — the unattended browser playtest

    make playtest

Starts its own static server and its own dedicated Chrome, plays several waves, dies,
restarts, plays another, dies, restarts again — and asserts the things a human watching
the screen cannot see. ~45 seconds, exits non-zero on failure, writes
`.playtest/report.json`.

It does **not** replace the playtest. Feel, audio, bloom intensity, readability and
anything aesthetic still need a human, and the Session Log should still say what
automation could not judge. It replaces the part that was being skipped.

## Why it exists

Items 49/50/51 each built a rig like this from scratch in a temp dir and threw it away;
item 54 lost its FPS verification entirely for want of one. The hard-won parts are
checked in here so the next session extends them instead of rediscovering them.

## What it checks

| Check | Catches |
| --- | --- |
| `window.__neonReady`, `__probe.version` | a dead CDN import, a boot exception |
| **run 1 → run 2 state diff** | any per-run field a new item forgot to clear in `resetGame` — reported **by name** |
| **run 2 → run 3 GPU diff** | leaked geometries/textures (a dropped `dispose`) |
| pool conservation | a pooled object dropped instead of returned to its free list |
| point-light census | the hard budget that once took wave 13 to ~6 FPS |
| idle-DOM snapshot | CSS-only leaks like item 56's damage flash |
| console / exceptions / failed requests | anything the page logged, including CSP violations |
| frame times under shotgun spam | jank, stalls, and FPS/draw-call regression vs a local baseline |
| **medal award / persistence** | a medal that re-toasts, does not persist, or a recap grid that mislabels earned vs unearned |

The state diff is the one worth understanding: two snapshots are taken **in the same
JavaScript turn as the button click that starts a run**, so both are exactly "t = 0 of a
run" and every difference between them is a leak, not timing noise. It needs no
maintenance — a field added to `state` or `mods` next year is covered the day it lands.

## How it drives the game

Through `window.__probe` — the test API published at the bottom of `index.html` — and
nothing else. **No scene-graph fingerprinting.** An earlier generation of this rig
identified enemies as "scene-level mesh, flat-shaded `MeshStandardMaterial`, at least one
child", which any new gib, pickup or prop was one item away from breaking *silently*: the
bot would simply find no enemies and report a clean run. When `__probe` and the internals
drift apart now, the harness breaks loudly, in one place.

Three things the game itself had to learn, all in `probe` near the input handlers:

- **`probe.driven`** — an automated driver holds the controls. Synthetic mouse events
  can never obtain pointer lock, so firing accepts `driven` in place of a lock, and the
  blur/visibility/unlock auto-pauses stand down (an unattended run must not pause itself
  into a hang).
- **`probe.turbo`** — sub-steps `update(dt)` N times per frame. A wave takes seconds
  instead of a minute. Always 1 for real players, and **forced to 1 for the FPS sample**,
  since extra sim per frame inflates every frame time.
- Seeded `Math.random`, installed by the harness before any page script runs — no game
  change. Same `--seed` means the same waves, upgrade cards and mutators, so a failure is
  reproducible instead of anecdotal.

## Options

    make playtest ARGS="--keep-open"          leave Chrome up to poke at a failure
    make playtest ARGS="--seed 7"             a different, still reproducible run
    make playtest ARGS="--waves 6 --turbo 8"  a longer soak
    make playtest ARGS="--scenario perf"      one scenario (default: soak,perf,medals)
    make playtest ARGS="--save-baseline"      record this machine's perf numbers
    make playtest ARGS="--headless"           SwiftShader: logic and leaks only, FPS meaningless
    make playtest ARGS="--url https://neon-strike-7b6.pages.dev/"   smoke the live site

`node tools/playtest/run.mjs --help` prints the full list.

One caution on `--keep-profile`: the profile is wiped by default, so `playerName` is
never set and the death screen takes the first-timer path, which POSTs nothing. Keep a
profile in which you once typed a name and a returning player auto-submits on death — so
`--keep-profile` together with `--url` pointed at the live site would put bot runs on the
real leaderboard. Don't combine those two.

## Files

    run.mjs            CLI, Chrome/CDP setup, error collection, report
    cdp.mjs            minimal CDP client (Node's global WebSocket — no dependencies)
    chrome.mjs         dedicated-Chrome launcher
    server.mjs         static server for the repo root, ephemeral port
    bot.js             the in-page autoplay bot (injected as a plain script)
    probes.mjs         probe expressions + the assertions over them
    scenarios/soak.mjs the play/die/restart loop and the leak comparisons
    scenarios/perf.mjs the frame-time sample under shotgun spam
    scenarios/medals.mjs medal awards, the toast queue and the recap grid (item 41)

To add a check, add a field to `SNAPSHOT` in `probes.mjs` and assert on it — that is the
cheap path, and it is cheap on purpose. A new scenario is a file in `scenarios/`
exporting a default `async (ctx) => {}` and a line in `SCENARIOS` in `run.mjs`.

`medals` shows the two moves a scenario about *persistence* needs. It **seeds** the
`neonstrike.medals` blob through `__probe.medals` so thresholds a 45-second run can never
reach (1,000 lifetime kills, 10 finished runs) are one event away — without that they
would ship unverified. And it calls **`ctx.reload()`**, which reboots the page and
re-injects the bot, because "survives a reload" cannot be faked in-page. It runs last for
both reasons: it rewrites localStorage and it reloads, so it must not perturb the leak
diffs or the frame-time sample.

## Dev-only

Nothing here ships. The deploy workflow stages `dist/` by hand (`index.html` + `_headers`),
so the live bundle gains only the ~1.5KB test API — which is deliberate: it is what lets
`--url` smoke-test the deployed site. The Chrome profile and `.playtest/` are gitignored,
and the perf baseline is machine-local because an FPS number from one machine is not a
threshold for another.
