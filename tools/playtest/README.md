# `tools/playtest` — the unattended browser playtest

    make playtest

Starts its own static server and its own dedicated Chrome, plays several waves, dies,
restarts, plays another, dies, restarts again — and asserts the things a human watching
the screen cannot see. Then five more scenarios do the same for hostile restarts, the boss
waves, medals, the between-wave arena rebuild and short viewports. ~100 seconds on an
M-series laptop, exits non-zero on failure, writes `.playtest/report.json`.

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
| **hostile restarts** | a restart, death or pause taken mid-explosion, mid-boss-intro, mid-upgrade-screen, mid-reload, mid-dash, mid-mutator or inside the boss-kill slow-mo — plus a monkey pass of random input |
| **medal award / persistence** | a medal that re-toasts, does not persist, or a recap grid that mislabels earned vs unearned |
| **alternating boss waves** | wave 10's ARTILLERY telegraphing, escalating, spawning its own amber minis and taking its live barrage with it when it dies — wave 5's melee fight still being the melee fight — and either boss naming itself in the recap with the name its title card drew |
| **the arena layout is a pure function of the wave** | a `Math.random()` in the layout — which no screenshot can see, and which would break `--seed`, the `ab` baseline and item 43's seeded daily — plus a rotation that hands a plain wave the boss floor, or drifts off the cover budget, anywhere in its 25-wave period |
| **the between-wave reconfigure** | a pillar raised through the player or a live pickup, a mutator floor that outlives its wave, a restart that does not snap back to the wave-1 floor |
| **card reachability at 1280x700, 844x390 and 1280x950** | a CTA — or the death card's first-timer NAME row — that grew below the fold of its own scroll box, or under the sticky footer; items 47/56/57 all hit this and none of them could fail a run on it |
| **sticky footer paint, in both states** | a footer band that lets the content behind it stay legible while the card scrolls — or that paints at all on a window where nothing overflows (item 67's property) |
| **fresh-page precondition, per scenario** | a scenario that starts from the last one's leftovers instead of its own setup (item 73) |
| **visual A/B vs a git ref** (opt-in) | a "purely cosmetic" refactor that moved the frame — a MAD score per camera pose against an older build, with the worst tile named |

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

## Scenarios are order-independent (item 73)

`run.mjs` calls **`ctx.resetPage()` before every scenario**, and follows it with a
`starts from a fresh page` check. So each scenario begins from a freshly booted document
at the title card, with the bot injected and stopped, no run in progress, turbo 1, and no
`neonstrike.*` keys in `localStorage`. **Any scenario may be run alone, and the list may
be reordered, without changing a result.** The order in `SCENARIOS` is for readability.

The whole contract fits in one sentence: **a reload resets everything in-page, so the only
things `resetPage()` has to clear explicitly are the two that survive one — `localStorage`
and the CDP `Emulation` overrides.** That is why the fix was small.

It is in the *loop*, not in each scenario, on purpose: a convention every new file has to
remember is precisely the thing that broke. Before it, `perf` left the in-page bot running
and `medals` silently depended on that — with nobody dodging, its parked player died to
wave 1 inside the toast-queue wait and `gameOver()` emptied the very queue the check was
watching, so `--scenario medals` failed on its own while the default run passed. `boss` had
to hand the bot back in teardown or fail a check two files away, `layout` had to run last
so its viewport override and `isTouch` did not follow it, and `medals` had to run last
because it rewrote `localStorage`. All four couplings are gone.

Two things to know when writing one:

- **A scenario sets up what it needs, and asserts nothing about what came before.** If it
  needs the player to survive a wait, give it the target-dummy hp pool (`boss` and `medals`
  both do) rather than assuming someone else left a bot dodging.
- **Inside `layout`, the per-leg call must stay `ctx.reload()`.** `resetPage()` clears the
  device metrics the leg just set, and every measurement would silently be the desktop
  layout at the wrong size.

Because every scenario reboots, each also restarts the seeded `Math.random` stream from the
same point — so a scenario's waves, upgrade cards and boss-name draws are identical whether
it runs alone or fifth. One consequence to know about: `perf` now samples a document booted
moments earlier rather than one `soak` has already played three runs in. On a vsync-capped
machine that changed nothing (item 73 measured 59.9 against a pre-item-73 baseline of 59.9,
with draw calls *down*), but if a pre-item-73 `.playtest/baseline.json` starts wobbling,
re-record it with `--save-baseline` rather than loosening the 0.8 tolerance.

## Options

    make playtest ARGS="--keep-open"          leave Chrome up to poke at a failure
    make playtest ARGS="--seed 7"             a different, still reproducible run
    make playtest ARGS="--waves 6 --turbo 8"  a longer soak
    make playtest ARGS="--scenario perf"      one scenario (default: soak,chaos,perf,boss,medals,arena,layout)
    make playtest ARGS="--scenario ab --baseline v0.21.5"   diff the frame against a git ref
    make playtest ARGS="--scenario ab --save-poses"        write the six poses even on a pass
    make playtest ARGS="--save-baseline"      record this machine's perf numbers
    make playtest ARGS="--headless"           SwiftShader: logic and leaks only, FPS meaningless
    make playtest ARGS="--no-sandbox"        drop Chrome's sandbox — CI containers only
    make playtest ARGS="--window 800,600"    smaller canvas; headless logic runs only
    make playtest ARGS="--url https://neon-strike-7b6.pages.dev/"   smoke the live site

`node tools/playtest/run.mjs --help` prints the full list.

One caution on `--keep-profile`: the profile is wiped by default, so `playerName` is
never set and the death screen takes the first-timer path, which POSTs nothing. Keep a
profile in which you once typed a name and a returning player auto-submits on death — so
`--keep-profile` together with `--url` pointed at the live site would put bot runs on the
real leaderboard. Don't combine those two — and since item 73 there is a second reason:
`resetPage()` deletes every `neonstrike.*` key before each scenario, so that combination
would also wipe the medals, best score and name saved in the profile you kept.

## Files

    run.mjs            CLI, Chrome/CDP setup, error collection, report
    cdp.mjs            minimal CDP client (Node's global WebSocket — no dependencies)
    chrome.mjs         dedicated-Chrome launcher
    server.mjs         static server for the repo root, ephemeral port
    bot.js             the in-page autoplay bot (injected as a plain script)
    probes.mjs         probe expressions + the assertions over them
    scenarios/soak.mjs the play/die/restart loop and the leak comparisons
    scenarios/chaos.mjs restarting, dying and pausing at hostile moments (item 64)
    scenarios/ab.mjs   the visual A/B signature against a git ref (item 65)
    scenarios/perf.mjs the frame-time sample under shotgun spam
    scenarios/boss.mjs the wave 5 / wave 10 boss fights (item 45)
    scenarios/medals.mjs medal awards, the toast queue and the recap grid (item 41)
    scenarios/arena.mjs  the arena reconfiguring between waves (item 82)
    scenarios/layout.mjs card reachability on short/touch viewports (item 67)

To add a check, add a field to `SNAPSHOT` in `probes.mjs` and assert on it — that is the
cheap path, and it is cheap on purpose. A new scenario is a file in `scenarios/`
exporting a default `async (ctx) => {}` and a line in `SCENARIOS` in `run.mjs`. It will be
handed a fresh page — see "Scenarios are order-independent" for what it may assume and what
it owes.

`layout` (items 67, 70, 71) is the other kind of extension: a scenario that changes the
*environment* rather than the game state. It drives `Emulation` through `ctx.send` — raw
CDP, because a page cannot resize itself — and asserts that each card's primary button
both hit-tests as itself and lies inside the viewport, then **clicks it with a dispatched
input event**. `el.click()` would not do: on the pre-fix build the synthetic call happily
started a run with `ENTER ARENA` 100px below the fold, which is how the bug survived three
sessions. Two things it must keep doing: `ctx.reload()` after enabling touch emulation
(`isTouch` in `index.html` is a boot-time const, so metrics alone measure the desktop
layout at phone size and never exercise the touch half), and `ctx.reload()` — not
`ctx.resetPage()`, which would clear the device metrics the leg just set. Its teardown
reload used to be the thing that stopped a leftover `isTouch === true` from routing every
later scenario's firing through `touchFire`; item 73 moved that guarantee into the loop, so
the teardown now only has to prove it worked. It leaves `.playtest/layout-*.png` behind for
the aesthetic half no check can make.

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

`chaos` (item 64) is the shape for a scenario that reuses every existing assertion and
changes only *when* they are taken. `soak` restarts at tidy moments; read the comments in
`resetGame` and almost every one records a bug that only appeared when the player restarted
*during* an animation. So `chaos` walks a list of hostile moments and, at each, runs the
three verbs a player has — pause and come back, die, restart — with item 58's t = 0 reset
diff and pool-conservation law unchanged. Four things it must keep doing:

- **Reach each moment deterministically.** `startWave(5)` for the boss, `startWave(7)` for
  a mutator, `showUpgrades()` for the cards. Never "play until the seed produces one": a
  seed-dependent moment is a flaky check, and a flaky check in the CI gate (item 66) is a
  gate somebody disables.
- **Fail if a moment was never observed**, and read that observation when the moment is
  *reached*, not at the restart. `gameOver()` clears `state.choosing` and `state.mutator`
  itself, so asking at the restart would report "never observed" for exactly the moments
  whose teardown is under test.
- **`.click()` on `againBtn`, not a dispatched hit-tested event.** A restart taken
  mid-`choosing` leaves the upgrade overlay above the death card; this is the one place in
  the rig where bypassing hit-testing is correct, and it is the opposite of what
  `layout` needs. Don't unify them.
- **No Escape or KeyP in the monkey pass.** Every other key is fair game — `probe.setKey`
  dispatches a real `KeyboardEvent` (see its comment in `index.html`), so the monkey
  exercises the keydown handlers rather than bypassing them. Escape and KeyP are excluded
  because `driven` stands down only the game's *automatic* pauses: one stray press parks an
  unattended run on the pause card and every later wait times out. Pause is tested as its
  own verb instead, where the resume is guaranteed.

Its monkey pass runs **twice**, for the same reason soak's GPU comparison is its second
restart: pass 1 is the first thing in the scenario to play long enough to reach pickups,
novas and a full spawn cycle, so it mints the geometry those paths own (15 geometries and
3 textures, measured) and a comparison across it reads warm-up as a leak. Pass 2 does the
identical work on warm pools and adds nothing, which is what makes the GPU check across it
tight enough to mean something.

`arena` (item 82) is the shape for a scenario whose subject is a **pure function**, and it
is the cheapest kind of check in the rig — ~6 seconds, because it never plays a wave. The
floor is rebuilt between waves from `layout(n)`, and "it is a function of n and nothing
else" is precisely the promise a human cannot verify: a random arena and a deterministic
one look identical on screen, and only the random one breaks `--seed`, the `ab` baseline
diff and item 43's seeded daily challenge. Four things it must keep doing:

- **Assert on the signature, not on archetype names.** `SNAPSHOT.arena` is a compact
  string built from the LIVE `obstacles` records, so a retuned height profile, a seventh
  archetype or a reordered symmetry table changes the numbers and no check needs an edit.
  The two deliberate literals are the wave-1 floor — which must never drift, it is the
  arena the game shipped with — and the mutator pairings, which *are* the spec.
- **Reach waves with `startWave(N)` and force mutators through `state.nextMutator`.**
  Never play until the seed produces the wave you want. `__probe.MUTATORS` exists so the
  four pairings can each be tested rather than whichever one wave 7 happened to roll.
- **Walk the player to `(0, 64)` before reading a floor.** A wave entered without a
  between-wave gap still refuses to raise a box on top of whoever is standing there, so a
  player left on the `(0, 30)` spawn clips a box off RING and OPEN and every signature is
  of a floor with a hole in it.
- **Prove the gap delivered the wave, not just that it spared the player.** A
  reconfigure that raised nothing at all would pass "no pillar rose through the player"
  perfectly. The count and archetype are checked alongside it, and so is the fact that
  the player never moved — a sinking floor that shoves them off the footprint first would
  make the whole leg vacuous.

`ab` (item 65) is the shape for a scenario that compares the game against **itself at
another commit**. It serves `git show <ref>:index.html` from a second port, walks six fixed
camera poses on each build, and scores a mean absolute difference per pose — replacing "run
the old one on :8001 and squint at two windows", which is a judgement nobody repeats on the
fifth pose. It is deliberately **not in the default scenario list**: its default baseline is
`HEAD`, so a default run would go red on every legitimate visual item.

    make playtest ARGS="--scenario ab --baseline v0.21.5"

Five things it must keep doing:

- **Compute the signature in the page** — `drawImage` the canvas down to 16x16 and read it
  back as 768 numbers. No image library, so `make playtest` still needs nothing installed.
- **Sample inside a one-shot rAF.** The renderer has no `preserveDrawingBuffer`, so the
  buffer is only readable between the render and the composite; rAF callbacks fire in
  registration order and the game registered `animate()` at boot, so a callback registered
  now runs after it. Read the canvas anywhere else and you get black — identically on both
  builds, which scores a perfect 0 and looks like a pass.
- **Hold the wave open with `toSpawn = 1` and the spawn timer at infinity.** The wave-clear
  test is `toSpawn === 0 && enemies.length === 0`, so an arena emptied the obvious way
  clears wave 1 on the first frame and slides the upgrade screen over every pose — at a
  wall-clock moment that differs between the two builds. That was worth ~18 MAD of pure
  noise before it was found.
- **Stop every clock the frame is a function of**: `state.time` (the grid shader's pulse)
  and `envTime`, which `__probe.fn.resetEnv` zeroes along with the trim, cap and dust state
  it drives. `updateEnv` breathes every wall trim by +/-38% on a ~7 s cycle, accumulating
  from page load and never reset mid-run, so two builds photographed from the same camera
  differ by whatever phase each page was at. Note what does NOT work: `state.paused` freezes
  almost none of this, because `updateEnv` and `updateAttract` are called outside the
  running/paused gate on purpose. Pinning took the noise floor from 0.25 MAD to 0.005 —
  and **`__probe.fixedDt = 0` (item 79) took the remaining 0.005 to exactly 0.000**, because
  a pin is not a stop: it lands in one CDP round-trip and the capture in the next, so an
  unknown number of frames each added its own `dt` and the frame photographed was a function
  of how many. Set the pin and the freeze in the SAME eval; split across two, the residual
  is a ~5 ms clock skew and a floor back at 0.005. The signature carries `state.time` for
  exactly this reason, and the run asserts the two captures agree on it.
- **Both builds run in the same mode, pinned or unpinned — never one of each.** A ref older
  than `probe.fixedDt` cannot hold its clocks, and pinning only the build under test is
  *worse than pinning neither*: it puts A at phase 0 and B at whatever phase it reached, and
  `--baseline v0.20.0` scored up to **1.125 MAD** on that asymmetry alone — a red check on a
  frame nothing had changed. Unpinned on both sides, the same comparison scores 0.07-0.40
  with a floor of 0.12, because two pages photographed on the same capture schedule reach
  the same phase by construction. That is also why **every** capture starts from a fresh
  page load: unpinned, the arena clock counts from load, so two captures agree only if their
  pages are the same age at the same pose. The mode is chosen from the baseline's SOURCE,
  before the floor is measured — the floor has to be measured in the mode the comparison
  will use — and the loaded page then has to confirm what its source advertised.
- **Assert the mean AND the worst tile**, because the two kinds of visual change do not
  look alike in one number. A global change moves the whole frame a little — bloom off
  scores 5-12 MAD — and the mean catches it. A LOCAL change moves a few tiles a lot and
  barely moves the mean: repainting a sector's grid line colour scores 0.10-0.89 MAD,
  under any threshold the noise permits, while shifting its worst tile by 12-32. Assert
  only the mean and every recolour walks through; assert only the tile and one drifting
  dust mote fails the run. The tile half is skipped against a baseline too old to pin its
  arena clock: measured against `v0.20.0`, the unpinned floor's own worst tiles run 13-17
  and its poses reach 26. The floor check skips its tile half there too — demanding headroom
  on a number nothing goes on to assert is how a run goes red over nothing.
- **Measure the floor, never assume it.** A vs A runs first, every time, and the run fails
  if either floor climbs within `FLOOR_MARGIN` of its threshold. Both thresholds came from
  measurement, not taste: fully pinned, A-vs-A is 0.004 MAD with a worst tile of 0.3, so
  1.0 and 4.0 sit ~250x and ~13x above the floor and ~3x under the smallest change worth
  catching. **Look at the poses** (`--save-poses` writes all six on a pass) rather than
  trusting them: item 65's original six were never eyeballed, and item 79 found four of them
  photographing the inside of the pillar at the arena origin — `centre-east` was a flat pink
  interior face, no grid, no trim, no sky. A frame that cannot change is a check that can
  never fail. Pick a new pose the same way — the steep look-down this scenario shipped with
  scored 0.00 against a recoloured grid, because from eye height you see three antialiased
  lines and a lot of dark floor and a 16x16 average erases them. A pose earns its place by
  seeing MORE of the thing it is there for, not by being prettier.

PNGs land in `.playtest/ab-*.png` on failure only — `-baseline` is the ref, `-current` is
the working tree. The number says something changed; the picture says what. `--save-poses`
additionally writes `ab-pose-<name>.png` for all six on a pass, from the build under test;
that is for reviewing what the poses frame, not for diffing.

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
- **never assume the bot.** It stops the bot at entry and leaves it stopped — the whole
  scenario is built on nobody dodging. It used to have to hand the bot back in teardown
  because `medals` depended on `perf` leaving one running; item 73 removed that channel, so
  a teardown is no longer this scenario's job.
- **turbo 1 around each screenshot.** At turbo 6 the ~120 ms between aiming the camera and
  the shutter is four simulated seconds — every telegraph the frame exists to show has
  already detonated, and you photograph the crater.

It also runs one wave 10 with the regular spawn queue **left alone**. The isolation the
other legs depend on is exactly what could hide a broken mini cap: a real boss wave queues
20+ ordinary enemies beside the boss, so a ceiling counting the whole arena skips nearly
every deployment in play while passing every isolated check. If you add a check that
depends on an empty arena, ask what it would look like in a full one.

Its `.playtest/boss-*.png` frames are the aesthetic half, same bargain as `layout`'s: the
silhouette, the amber, and whether a ground telegraph reads as a warning are for a human.

`--url` against the live site fails the NAME-row checks until the fix deploys; that is the
lag between `main` and Pages, not a regression.

Chrome's own window stays at `--window-size=1280,860` (`chrome.mjs`), and that is no
longer a workaround for the title card: the frame-time sample is only comparable to a
machine-local baseline recorded at the same canvas size, so the viewport perf measures
must not move. Short-viewport reachability is `layout`'s job, at its own sizes.

`--window WxH` (item 66) moves it anyway, for headless LOGIC runs only. Every check in
`soak` and `chaos` is identical at any canvas size — same scene, same entities, same draw
calls — and what changes is fill rate, which under SwiftShader's CPU renderer dominates
everything. It is the difference between a CI job that times out and one that takes two
minutes. Never pass it to a run whose FPS number you intend to compare to anything.

`medals` shows the two moves a scenario about *persistence* needs. It **seeds** the
`neonstrike.medals` blob through `__probe.medals` so thresholds a 45-second run can never
reach (1,000 lifetime kills, 10 finished runs) are one event away — without that they
would ship unverified. And it calls **`ctx.reload()`**, which reboots the page and
re-injects the bot, because "survives a reload" cannot be faked in-page. Both used to make
it a must-run-last scenario; since item 73 it rewrites and reloads a page nothing else will
see. It also gives its parked player the target-dummy hp pool: the toast waits are seconds
of turbo-8 simulation, and a death in one of them calls `gameOver()`, which empties the
queue the next check reads — the coupling that made `--scenario medals` fail alone.

## It also runs in CI (item 66)

`.github/workflows/ci.yml` runs `--headless --no-sandbox --scenario soak,chaos` on every
pull request and every push to `main`, and **that file owns the whole story** — which
scenarios it runs and why those, how Chrome is located, why it is a separate workflow from
the deploy, and what its one known flake risk is. Read it there rather than here.

The half worth knowing at this end: `--headless` must never assert an FPS number, because
SwiftShader renders on the CPU. `perf` gates its two absolute frame-time checks on it, and
item 66 found the baseline comparison was NOT gated and fixed that — on a vsync-capped
laptop both renderers pin at 59.9, so the wrong check had been passing rather than failing,
which is how it survived. Draw calls and triangle counts do transfer between renderers
(295 headless against a 331 GPU baseline) and stay asserted in both modes. If you add a
check, ask which of those two kinds it is before letting it run headless.

## Dev-only

Nothing here ships. The deploy workflow stages `dist/` by hand (`index.html` + `_headers`),
so the live bundle gains only the ~1.5KB test API — which is deliberate: it is what lets
`--url` smoke-test the deployed site. The Chrome profile and `.playtest/` are gitignored,
and the perf baseline is machine-local because an FPS number from one machine is not a
threshold for another.
