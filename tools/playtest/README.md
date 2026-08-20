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

**Extend this rig; never hand-roll a script beside it.** That is the single most-repeated
mistake in this repo's history, and it survived the rig landing: item 41 started down the
same path a fourth time and was only caught by the user asking "is the game play test
using the playtest?". If the harness cannot check what your item needs, the answer is a
field in `SNAPSHOT` or a file in `scenarios/` — see "To add a check" below.

A hand-rolled script is also how you get a *false* perf regression. `launch()` in
`chrome.mjs` returns `close()`, not `kill()`, so a wrong cleanup call silently leaves
~8 Chrome processes alive per run, and the GPU contention halves the next FPS sample.
Before believing any FPS number:

    pgrep -f 'playtest/.chrome-profile' | wc -l   # 0 between runs

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
| **alternating boss waves** | wave 10's ARTILLERY telegraphing, escalating, spawning minis and taking its live barrage with it when it dies — and wave 5's melee fight still being the melee fight |
| **card reachability at 1280x700, 844x390 and 1280x950** | a CTA — or the death card's first-timer NAME row — that grew below the fold of its own scroll box, or under the sticky footer; items 47/56/57 all hit this and none of them could fail a run on it |
| **sticky footer paint, in both states** | a footer band that lets the content behind it stay legible while the card scrolls — or that paints at all on a window where nothing overflows (item 67's property) |

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
    make playtest ARGS="--scenario perf"      one scenario (default: soak,perf,boss,medals,layout)
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
    scenarios/boss.mjs the wave 5 / wave 10 boss fights (item 45)
    scenarios/medals.mjs medal awards, the toast queue and the recap grid (item 41)
    scenarios/layout.mjs card reachability on short/touch viewports (item 67)

To add a check, add a field to `SNAPSHOT` in `probes.mjs` and assert on it — that is the
cheap path, and it is cheap on purpose. A new scenario is a file in `scenarios/`
exporting a default `async (ctx) => {}` and a line in `SCENARIOS` in `run.mjs`.

`layout` (items 67, 70, 71) is the other kind of extension: a scenario that changes the
*environment* rather than the game state. It drives `Emulation` through `ctx.send` — raw
CDP, because a page cannot resize itself — and asserts that each card's primary button
both hit-tests as itself and lies inside the viewport, then **clicks it with a dispatched
input event**. `el.click()` would not do: on the pre-fix build the synthetic call happily
started a run with `ENTER ARENA` 100px below the fold, which is how the bug survived three
sessions. Two things it must keep doing: `ctx.reload()` after enabling touch emulation
(`isTouch` in `index.html` is a boot-time const, so metrics alone measure the desktop
layout at phone size and never exercise the touch half), and `ctx.reload()` again in
teardown — a leftover `isTouch === true` routes firing through `touchFire`, and every
later scenario would silently stop shooting. It runs last for the same reason `medals`
does, and it leaves `.playtest/layout-*.png` behind for the aesthetic half no check can
make.

Item 70 added the death card's first-timer NAME row to the same treatment, and it is the
better example of *what* to assert. The row is not sticky — it is visible only because
`revealNameRow()` scrolls the card to it — so "inside the viewport" is not enough on its
own: the pre-fix build had the row geometrically inside the scrollport and painted
underneath `#overBtns`, which is why the assertion hit-tests `#handleInput` and
`#submitName` rather than measuring a rectangle. Two supports it needed:

- **`__probe.fn.renderGlobalBoard`** — the harness serves the site statically, so
  `/api/scores` 404s and the death card's global board never renders. The half of the fix
  that re-reveals the row *after* the board lands under it would therefore never execute
  in a green run. The scenario draws a synthetic 10-row board through the probe and
  re-asserts. When a check needs a code path the static server cannot produce, this is the
  shape of the answer: one function on `__probe.fn`, not a live network.
- **the 1280x950 leg** — a control, not a bug site. It is the height at which the card
  fits, so it is what fails if a short-viewport fix ever starts scrolling a tall window.

Item 71 added `bandPaint`, which is about what the footer PAINTS rather than what it can
reach: while the card scrolls the band must be fully opaque (`rgb(...)`, no
background-image — a gradient is how the pre-fix build let leaderboard rows show through
beside RUN IT BACK) and its fade ramp must be showing; while it does not scroll, neither
may paint at all. Both are driven by one `scroll(nearest block)` timeline and the ramp's
lives on a `::before`, so the check reads `getComputedStyle(row, '::before')` in **both**
states and a tail check fails the scenario if a run only ever saw one of them — "opacity
0, no band" is also what a rule that never applied looks like, and a single-state check
could not tell the two apart.

`boss` (item 45) is the third shape: a scenario about a fight the ordinary run never
reaches. The soak clears four waves and dies, so wave 5 and wave 10 were unverified
territory — it jumps there with `startWave(N)`, zeroes `state.toSpawn`, and kills whatever
the wave already queued, so every count it reports is about the boss and nothing else.
Four things it must keep doing:

- **`__probe.fn.damageEnemy`** — `bossEnrage` fires from *inside* `damageEnemy`, so writing
  `boss.hp` from the outside reaches 40% hp without ever entering phase 2, and "phase 2
  escalates" would be asserted against a boss still in phase 1. Same shape as item 70's
  `renderGlobalBoard`: one function on `__probe.fn`.
- **the target-dummy hp pool** (`player.maxHp = 1e7`), not `invuln`. Every check here needs
  the barrage to connect — `dmgTaken`, and `lastHitBy`, which is the exact string the death
  card prints. At turbo 6 a 100 ms poll is ~3 s of simulated time, so topping up a 100 hp
  bar between polls loses the race with a five-shell volley and the scenario ends up
  asserting against a frozen death screen.
- **restart the bot in teardown.** `perf` leaves it running and `medals` silently depends on
  that: with nobody dodging, its parked player dies inside the toast-queue wait and
  `gameOver()` empties the queue the check is watching. Stopping the bot here without
  handing it back fails a scenario two files away.
- **turbo 1 around each screenshot.** At turbo 6 the ~120 ms between aiming the camera and
  the shutter is four simulated seconds — every telegraph the frame exists to show has
  already detonated, and you photograph the crater.

Its `.playtest/boss-*.png` frames are the aesthetic half, same bargain as `layout`'s: the
silhouette, the amber, and whether a ground telegraph reads as a warning are for a human.

`--url` against the live site fails the NAME-row checks until the fix deploys; that is the
lag between `main` and Pages, not a regression.

Chrome's own window stays at `--window-size=1280,860` (`chrome.mjs`), and that is no
longer a workaround for the title card: the frame-time sample is only comparable to a
machine-local baseline recorded at the same canvas size, so the viewport perf measures
must not move. Short-viewport reachability is `layout`'s job, at its own sizes.

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
