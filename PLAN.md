# NEON STRIKE — Feature Roadmap

Each item below is self-contained and sized to be completed in one focused session.
Workflow: see CLAUDE.md ("Roadmap workflow") — one item per session, one commit per item,
close out with a Session Log entry at the bottom of this file.

## Status board

| #  | Item                          | Phase | Status | Commit |
|----|-------------------------------|-------|--------|--------|
| 1  | Floating damage numbers       | 1     | done   | f85aa5f |
| 2  | Combo-pitched kill audio      | 1     | done   | 7d30b3f |
| 3  | Low-HP danger state           | 1     | done   | a3a4b4b |
| 4  | Style-bonus scoring           | 1     | done   | d0e3cd9 |
| 5  | Ultimate ability (NOVA)       | 1     | done   | 707af5a |
| 6  | Upgrade rarity + reroll       | 2     | done   | 0df5187 |
| 7  | Ricochet rounds               | 2     | done   | aa0f610 |
| 8  | Chain lightning on crit       | 2     | done   | b1e5ecd |
| 9  | Kill clip                     | 2     | done   |        |
| 10 | Dash trail damage             | 2     | todo   | needs 6 |
| 11 | Volatile deaths               | 2     | todo   | needs 6 |
| 12 | Flying enemy — WASP           | 3     | todo   |        |
| 13 | Shielded tank — BULWARK       | 3     | todo   |        |
| 14 | Splitter enemy                | 3     | todo   |        |
| 15 | Boss phases                   | 3     | todo   |        |
| 16 | Elite enemy modifiers         | 3     | todo   |        |
| 17 | Arena hazard — laser sweep    | 4     | todo   |        |
| 18 | Exploding barrels             | 4     | todo   |        |
| 19 | Challenge waves (mutators)    | 4     | todo   |        |
| 20 | Death recap & run summary     | 4     | todo   |        |

Status values: `todo` → `wip` → `done` (fill Commit with the short hash on completion).
Keep this table AND the item checkbox in sync.

The whole game lives in `index.html` (single file: CSS → HUD markup → one `<script type="module">` with three.js from CDN). No build step; test by opening the file in a browser (`open index.html`) or `python3 -m http.server`.

## Codebase conventions (read before any item)

- **Anchors are function names, not line numbers** — lines shift as items land. Key anchors:
  `fireWeapon`, `damageEnemy`, `killEnemy`, `damagePlayer`, `spawnEnemy`, `spawnBoss`,
  `update(dt)` (main per-frame logic), `startWave`, `showUpgrades`/`pickUpgrade`,
  `resetGame` (must reset ALL new state), `collectPickup`, `explodeRocket`.
- **Pooling**: particles and tracers are pooled (`particlePool`, `tracerPool`). New visual
  effects that spawn per-hit/per-kill MUST pool their objects the same way — no per-frame
  allocation in `update`.
- **Disposal**: anything removed from the scene disposes geometry/material unless shared
  (see `disposeEnemy`, `SHARED_ENEMY_GEO`). New entity types need the same treatment and
  must be cleaned up in `resetGame`.
- **Audio**: all SFX are synthesized in the `sfx` object via `beep()`/`noiseBurst()`. New
  sounds follow that pattern — no audio files.
- **Run modifiers**: per-run upgrade state lives in the `mods` object (`baseMods()`), reset
  each run. New upgrade effects add a field to `baseMods()` and read it where relevant.
- **State flags**: `state.running / paused / choosing` gate `update`. `state.stats` feeds the
  death screen. New per-run state goes on `state` and is reset in `resetGame`.
- **HUD**: DOM elements referenced via the `ui` object; transient text uses `flashCombo`
  (center, big) and `flashTip` (below crosshair, small).
- Keep the neon aesthetic: cyan `#00f0ff`, hot pink `#ff2e88`, glows via `text-shadow`/emissive.

## Suggested order

Phases are independent, but within a phase earlier items make later ones easier.
Item 6 (rarity framework) should land before items 7–11 (new upgrades).
Item 16 (elite modifiers) benefits from 12–14 (more enemy types to modify) but doesn't require them.

---

## Phase 1 — Game feel / juice

### [x] 1. Floating damage numbers
**Goal:** Every hit shows a small floating number at the impact point that drifts up and fades.
**Hook points:** `damageEnemy` (has `point` + `crit`), `explodeRocket` and exploder chain damage pass `point=null` — for those, use the enemy's mesh position.
**Sketch:** Pooled `THREE.Sprite`s with a shared canvas-texture-per-instance (or one small canvas redrawn per acquire). Pool of ~40. White for normal, yellow + larger for crits. Rise ~1.5 units over 0.6 s, fade out. Update/expire them in `update` alongside particles; recycle in `resetGame`.
**Done when:** numbers appear on every hitscan/rocket/chain hit, crits visibly distinct, no FPS drop with shotgun spam (9 pellets/shot), pool never leaks across restarts.

### [x] 2. Combo-pitched kill audio
**Goal:** Kill sound rises in pitch with the current combo so streaks are audible.
**Hook points:** `sfx.kill` call inside `killEnemy`; `beep()` already takes `freq`/`slideTo`.
**Sketch:** Change `sfx.kill` to accept a multiplier: `sfx.kill(1 + Math.min(state.combo, 12) * 0.06)` scaling both `freq` and `slideTo`. Cap so x99 combos don't become dog whistles.
**Done when:** consecutive fast kills audibly climb; single kills sound unchanged.

### [x] 3. Low-HP danger state
**Goal:** Below 25% HP the game *feels* dangerous: pulsing red vignette + heartbeat sound.
**Hook points:** `updateHealthUI` (state entry/exit), `update` (pulse animation), `damagePlayer`, `collectPickup`/lifesteal (may exit the state).
**Sketch:** Add a fixed-position CSS vignette div (radial-gradient, red edges, `pointer-events:none`) with opacity driven from `update` (`0.35 + 0.2 * sin(t*5)` while low). Heartbeat = two short low `beep`s (~55 Hz sine pair) on a ~1 s timer in `update`, only while low. Both stop instantly on heal above threshold, on death, and on restart.
**Done when:** entering/leaving low HP toggles cleanly (including via NANO LEECH heals and PLATED ARMOR raising maxHp), no vignette on the death/start screens, resets on new run.

### [x] 4. Style-bonus scoring
**Goal:** Flashy play pays: bonus score + callout for skilled kills.
**Hook points:** `killEnemy` (score is computed there), `player.onGround`, `player.invuln` (>0 during dash window), weapon + distance at kill time.
**Sketch:** In `killEnemy`, detect: **AIRSHOT** (player not onGround, +150), **PHASE KILL** (killed while dash i-frames active, +200), **POINT BLANK** (shotgun kill < 4 units, +100). Requires passing the killing weapon/distance from `damageEnemy` → `killEnemy` (add optional params, default null for splash/chain kills). Show via `flashTip` (keep `flashCombo` for combo/streaks so they don't fight). Add bonuses to score *before* combo multiplication or as flat additions — flat is simpler and easier to tune.
**Done when:** each bonus triggers correctly and only for player-attributed kills (not exploder chains), callouts readable, death-screen stats optionally count style bonuses.

### [x] 5. Ultimate ability (NOVA)
**Goal:** A kill-charged ultimate on `E` / touch button: screen-clearing shockwave + brief slow-mo.
**Hook points:** keydown handler, `killEnemy` (charge), `update` (expanding wave), `state.slowmo` (already implemented in `animate`), HUD next to dash bar, touch controls block, `resetGame`.
**Sketch:** `state.ult` 0→100, +8 per kill (+25 per boss). At 100 the HUD bar glows. On activate: expanding emissive ring/sphere from player over ~0.5 s; enemies inside the radius take heavy damage (300, bosses take 150); `state.slowmo = 0.6`; big shake + new `sfx.nova` (low sweep + noise burst). New `.tbtn` for touch, placed near dash.
**Done when:** charge persists across waves, resets per run, cannot activate while `choosing`/paused, kill via ultimate still awards combo/score, HUD bar mirrors dash-bar styling.

---

## Phase 2 — Upgrade system depth

### [x] 6. Upgrade rarity tiers + reroll  *(do this before 7–11)*
**Goal:** Upgrades get common/rare/epic tiers with color-coded cards, plus one reroll per run.
**Hook points:** `UPGRADES` array, `showUpgrades` (card HTML), `pickUpgrade`, upgrade CSS (`.upcard`), `resetGame`.
**Sketch:** Add `rarity: 'common'|'rare'|'epic'` to each upgrade def. Weighted draw (~70/25/5, epic weight can grow with wave). Card CSS variants: common = current cyan, rare = purple border+glow, epic = gold. Existing 10 upgrades become commons/rares; items 7–11 add the epics. Add a REROLL button in the overlay (usable once per run, `state.rerolled`); reroll redraws all 3 choices. Keyboard: `R` while choosing.
**Done when:** rarity distribution feels right over ~10 waves, reroll works once and greys out, epic cards visually pop, all reset per run.

### [x] 7. Ricochet rounds (epic upgrade)
**Goal:** Blaster hits bounce to the nearest other enemy for 50% damage.
**Hook points:** hitscan branch of `fireWeapon` (after `damageEnemy`), `spawnTracer` (draw the bounce), `mods`.
**Sketch:** `mods.ricochet = false` → set true by the upgrade. On blaster enemy hit: find nearest other enemy within ~14 units of the impact (skip the one just hit), apply `damage * 0.5`, draw a tracer impact→target. One bounce only (no chains) to keep it sane. Bounce can crit? No — keep it simple, never crits.
**Done when:** bounce visibly connects, no self-chaining infinite loops, works with EXTENDED MAGS/other mods, no bounce when only one enemy alive.

### [x] 8. Chain lightning on crit (epic upgrade)
**Goal:** Crits arc lightning to up to 2 nearby enemies.
**Hook points:** `damageEnemy` crit branch, `mods`, tracer system for the arc visual.
**Sketch:** `mods.chainCrit = false`. On crit: pick up to 2 nearest enemies within 12 units, deal 25 flat (scaled by `mods.damage`), draw jagged tracer (2–3 segment polyline — extend tracer pool to support 4-point buffers or spawn 2–3 pooled 2-point tracers with a midpoint jitter). Add `sfx.zap` (high sine slide). Guard against recursion: chained damage must not itself trigger chains (pass a flag through `damageEnemy`).
**Done when:** arcs render jagged and cyan-white, no infinite recursion with DEADEYE + shotgun multi-crits, chain kills award combo normally.

### [x] 9. Kill clip (rare upgrade)
**Goal:** Kills refund 15% of magazine size to the current weapon (rounded up).
**Hook points:** `killEnemy`, `mods`, `updateAmmoUI`.
**Sketch:** `mods.killClip = false`. In `killEnemy`: `w.mag = Math.min(w.magSize, w.mag + Math.ceil(w.magSize * 0.15))`, flash the ammo counter (brief CSS class with cyan glow). Applies to the *held* weapon regardless of what dealt the kill — simpler and feels generous.
**Done when:** refund visible in HUD, respects mag cap, works mid-reload without corrupting reload state (either cancel refund during reload or let it apply after — pick one and note it).

### [ ] 10. Dash trail damage (rare upgrade)
**Goal:** Dashing leaves a short-lived energy trail that damages enemies it touches; dashing through an enemy damages it.
**Hook points:** dash activation block in `update` (`wantDash`), `mods`, enemy loop for overlap tests, `resetGame`.
**Sketch:** `mods.dashDamage = false`. On dash: record trail as 3–4 pooled glowing quads (or stretched boxes) along the dash path, life 0.8 s. Each enemy overlapping a trail segment (2D distance < 1.5) takes 40 damage once per dash (tag enemies with the dash id). Direct pass-through (player within enemy radius during i-frames) also counts.
**Done when:** trail renders + fades, damage applies once per enemy per dash, pooled/reset correctly, kills via trail count for combo and PHASE KILL style bonus (item 4) if both present.

### [ ] 11. Volatile deaths (epic upgrade)
**Goal:** ~20% of kills explode like exploder detonations, damaging nearby enemies.
**Hook points:** `killEnemy` — the exploder chain-explosion block already there is the template; `mods`.
**Sketch:** `mods.volatile = false`. In `killEnemy`, for non-boss non-exploder kills: 20% chance → orange burst + `sfx.explode` + 35 damage falloff within 5 units to other enemies (reuse the exploder loop, iterate over a copy `[...enemies]`). Must not damage the player (it's a reward, not a hazard).
**Done when:** chains can cascade (volatile kill → another kill → maybe another explosion) without stack overflow or array-mutation bugs, explosion visually distinct from enemy exploders (orange vs green).

---

## Phase 3 — Enemy & boss variety

### [ ] 12. Flying enemy — WASP
**Goal:** A hovering enemy that circles at height ~6–9 then telegraphs and dive-bombs the player.
**Hook points:** `spawnEnemy` (new type branch), enemy loop in `update` (new movement case), minimap (new color), `disposeEnemy` works as-is if built like others.
**Sketch:** Geometry: small cone or squashed icosahedron, color `#3af0ff`-ish (distinct from all current hues). Appears wave 4+. States: `orbit` (circle player at radius ~14, height 7, bob) → every 4–6 s `telegraph` (0.6 s, flash bright + `sfx.warn`) → `dive` (straight line at player's position captured at telegraph end, fast) → on floor/whiff or hit (12 dmg), climb back to orbit. Vertical position means hitscan already works (raycast is 3D); melee-contact check must use full 3D distance for this type.
**Done when:** dives are dodgeable via dash/strafe, wasp visible on minimap, doesn't get stuck in floor or pillars (skip `collideArena` Y-clamp appropriately, X/Z clamp still applies), boss waves can include wasps.

### [ ] 13. Shielded tank — BULWARK
**Goal:** Slow enemy with a front shield that blocks shots; vulnerable from behind/sides or briefly after its charge attack.
**Hook points:** `spawnEnemy`, enemy loop, hitscan branch of `fireWeapon` (shield check), rockets (splash ignores shield or halves damage — pick: halves).
**Sketch:** Big box/slab body, dark with orange emissive; a visibly distinct shield plate child mesh on the front face. Appears wave 5+. Always faces the player (rotate mesh yaw toward player — note other enemies spin freely; this one must not). Shield check: on hit, compare hit direction vs enemy facing (`dot(shotDir, enemyForward) < -0.4` → blocked: spark burst, `sfx` clink, no damage). Every ~5 s: 1 s wind-up telegraph then a fast charge in a straight line (heavy contact damage 25); for 1.5 s after the charge ends the shield drops (visual: plate swings open / emissive off).
**Done when:** flanking works reliably, crit core reachable from behind, charge is telegraphed and dodgeable, shield blocks show clear feedback so players learn the rule without text.

### [ ] 14. Splitter enemy
**Goal:** Medium enemy that splits into 2–3 fast mini-chasers on death.
**Hook points:** `spawnEnemy`, `killEnemy` (spawn children on death), enemy loop (minis are just small fast chasers).
**Sketch:** Bigger icosahedron (scale ~1.5), teal/green two-tone. Appears wave 4+. On death: spawn 2–3 `chaser`-type enemies at 0.55 scale, hp ~15, speed ~9, radius ~0.7, tiny score (25). Children spawn slightly separated (use the separation pass to settle). Children must NOT be counted in `state.toSpawn` (they come from deaths) — wave-clear logic (`nextWaveCheck`) already keys off `enemies.length` so it just works; verify.
**Done when:** split feels punchy (burst + sound), minis are killable in 1 blaster shot, no wave-stall where minis spawn after the wave-clear check in the same frame kills the parent last.

### [ ] 15. Boss phases
**Goal:** Boss gets a second phase at 50% HP: faster, angrier, new attack pattern.
**Hook points:** boss branch of enemy `update` loop, `damageEnemy` (phase-transition trigger), `spawnBoss` (phase field), boss HP bar.
**Sketch:** `e.phase = 1`. When hp < maxHp/2 and phase 1: transition — 1 s stagger (stop moving, flash white, `sfx.explode`, shake, `flashCombo('⚠ ENRAGED')`), then phase 2: +40% speed, volley becomes 7 shots (`k: -3..3`) AND alternates with a full 12-shot radial ring every other volley; fireCD drops to 1.8. Boss bar changes gradient to angrier red. Optional: spawn 2 chasers at the transition.
**Done when:** transition is unmissable, phase 2 is harder but dodgeable with dash, works at wave 10+ (second boss) where HP scaling differs, no double-trigger of the transition.

### [ ] 16. Elite enemy modifiers
**Goal:** Occasional elite variants of normal enemies: bigger, named modifier, guaranteed drop.
**Hook points:** `spawnEnemy` (after type roll), `killEnemy` (guaranteed pickup + bonus score), minimap (elites slightly larger dot), `flashTip` on spawn optional.
**Sketch:** From wave 3, each non-boss spawn has ~8% elite chance. Elite: scale 1.4, hp ×2.5, score ×3, guaranteed pickup drop, plus ONE modifier:
- **SWIFT** (cyan tint): speed ×1.6
- **VOLATILE** (green tint): explodes on death like an exploder (reuse that block)
- **SHIELDED** (orange tint): flat 25% damage reduction (crits ignore it)
Store as `e.elite = 'SWIFT' | ...`. Show a small floating label? No DOM-per-enemy — instead tint + scale is the tell; flash `flashTip('⚠ ELITE ' + mod)` on spawn.
**Done when:** elites read visually at a glance, drop rewards reliably, modifiers stack correctly with wave HP scaling, exploder-type elites don't double-explode.

---

## Phase 4 — Run variety & retention

### [ ] 17. Arena hazard — laser sweep
**Goal:** From wave 6+, a rotating laser beam periodically sweeps the arena; touching it hurts.
**Hook points:** `startWave` (arm the event), `update` (rotate + collision), `resetGame`, new scene objects (pooled/persistent, just hidden when inactive).
**Sketch:** A tall emissive pillar at arena center (or one of the existing pillar tops) fires a horizontal beam (thin long box, red, with point light) that rotates 360° over ~8 s, once mid-wave with a 2 s warning (beam ghost at 20% opacity + `sfx.warn` beeps). Player collision: 2D line-segment vs player circle each frame while active, 15 dmg + knockback, 0.5 s per-hit cooldown. Enemies unaffected (it's a player-pressure tool) — OR damages enemies too for lure play; damaging enemies too is more fun: same falloff-free 15 dmg with per-enemy cooldown.
**Done when:** warning gives fair reaction time, jump does NOT clear it (beam at torso height) but pillars block line-of-sight (skip damage if `segBlocked` between center and player), off during upgrades/pause, fully reset between runs.

### [ ] 18. Exploding barrels
**Goal:** Neon canisters scattered per wave; shooting one causes a rocket-sized explosion that damages everything nearby.
**Hook points:** `startWave` (spawn 3–5 at random clear spots — reuse the placement loop from `spawnRandomPickup`), hitscan target list in `fireWeapon`, rocket proximity check, `explodeRocket`-style blast (extract a shared `explodeAt(pos, dmg, radius, hurtsPlayer)` helper), `resetGame`, minimap dots optional.
**Sketch:** Cylinder mesh, dark body + yellow emissive band + point light. 1 HP (any hit detonates). Blast: 60 dmg falloff over 6 units to enemies AND player (risk/reward). Chain reactions between barrels (delayed 0.15 s per hop for readability). Cap ~6 alive.
**Done when:** barrels join the hitscan target list and rocket/enemy-shot? (enemy shots should NOT detonate them — player-only trigger keeps it strategic; document the choice), chains feel readable, disposed on reset, luring exploder/chaser packs into barrels works.

### [ ] 19. Challenge waves (mutators)
**Goal:** Every 7th wave is a named mutator wave with a banner and bonus score.
**Hook points:** `startWave` (roll + apply mutator), `update`/spawn logic (mutator effects), `killEnemy` (score multiplier), wave-clear (revert mutator).
**Sketch:** `state.mutator = null | {...}`. On wave % 7 === 0 pick one:
- **SWARM**: spawn count ×2, all chasers, enemy hp ×0.6, score ×1.5
- **BULLET HELL**: shooters only, their fireCD ×0.5, score ×1.5
- **BERSERK**: enemy speed ×1.5, player damage ×1.5, score ×2
- **FRENZY**: infinite ammo + no reloads (mag never drops), enemy count ×1.5
Banner via `flashCombo` with distinct color + `sfx.wave` variant. Revert everything in the wave-clear path AND in `gameOver`/`resetGame` (mutators must never leak across waves/runs).
**Done when:** each mutator is clearly announced, score bonus applies only during the wave, no mutator state leaks (check death mid-mutator → restart), boss waves (multiples of 5) never collide with mutator waves (7, 14, 21, 28... vs 5, 10, 15... — wave 35 collides: mutator skips if boss wave).

### [ ] 20. Death recap & run summary
**Goal:** Death screen tells the story of the run: killer, upgrades taken, richer stats.
**Hook points:** `damagePlayer` (track last damage source type), `gameOver` (render), `pickUpgrade` (log picks), `state.stats`, death-screen CSS (`#overStats`).
**Sketch:** Track `state.lastHitBy` (set in every `damagePlayer` call — requires passing a source *type* string through: chaser/boss contact, enemy shot, exploder blast, rocket self-damage, laser, barrel). On death: "FLATLINED BY: EXPLODER — WAVE 8". Below stats, render picked upgrades as a row of small chips (name + rarity color once item 6 lands; plain otherwise). Add stats: damage dealt, damage taken, favorite weapon (most kills — needs per-weapon kill tally in `killEnemy`).
**Done when:** killer attribution is correct for all damage paths (self-rocket says so — comedic value matters), upgrade chips wrap nicely with 8+ upgrades, everything resets between runs.

---

## Cross-cutting reminders

- After any item: play 3+ waves, restart once, and check the FPS counter (settings → SHOW FPS) with shotgun + heavy particle load.
- **Point lights are a hard budget** (2026-07-09 perf fix): every `PointLight` multiplies the
  fragment cost of ALL lit materials scene-wide — per-entity lights tanked wave 13+ to ~6 FPS.
  Never attach lights to things that scale with wave/entity count (enemies, shots, barrels…);
  bounded singletons (boss, nova, laser sweep) are fine. Emissive material + a basic-material
  core mesh gives the neon glow without lights.
- Anything added to the scene per-run must be handled in `resetGame`.
- New enemy types: add to minimap colors, verify `disposeEnemy` covers their children, and confirm they respect `collideArena` (or deliberately don't, like WASP).
- New upgrades: add to `UPGRADES` with rarity (post-item-6), verify they reset via `baseMods()`.
- Touch: any new ability/key needs a touch button (see `#touch` block) or an explicit note that it's keyboard-only.

---

## Session Log

Append one entry per completed (or abandoned) session, newest first. Format:

```
### YYYY-MM-DD — Item N: <name> — <done|partial|abandoned>
- What landed: <1–3 lines>
- Tuning chosen: <values that differ from or refine the spec>
- Notes for next sessions: <gotchas found, out-of-scope bugs spotted, spec corrections>
```

If an item is left `wip`, the entry MUST say exactly what remains and where the work stopped.

### 2026-07-10 — Item 9: Kill clip — done
- What landed: `mods.killClip` (in `baseMods()`, resets per run) + KILL CLIP rare in `UPGRADES`
  (reuses the `avail: () => !mods.killClip` one-shot pattern from items 7/8). `killEnemy` calls
  new `killClipRefund()` (defined next to `finishReload`): held weapon `W()` gets
  `mag = min(magSize, mag + ceil(magSize * 0.15))` — blaster +5, shotgun +2, rocket +1;
  scales with EXTENDED MAGS (magSize 39 → +6) since it reads live `magSize`. HUD flash =
  `.clip` class on `#ammo` (bright cyan + white glow, applied instantly, removed after 180 ms,
  fades back over the new 0.3 s color/text-shadow transition on `#ammo`).
- Tuning chosen: mid-reload decision (spec said pick one): the refund APPLIES during a reload —
  `finishReload` computes `need = magSize - mag` at finish time, so it just tops up less from
  reserve (e.g. shotgun 2/10 reloading + kill → 4, finish → 10/18 reserve instead of 10/16) —
  no corruption possible. No flash during reload (counter reads RELOAD…; `updateAmmoUI`
  early-returns anyway). Full mag = silent no-op, no flash. `resetGame` clears the flash timer
  + class alongside `reloading = false`.
- Notes for next sessions: verified via headless-Chrome playtest (23 checks: pool presence +
  ownership filtering, exact ceil math for all 3 weapons, mag cap, full-mag no-op, refund goes
  to HELD weapon only regardless of what dealt the kill, EXTENDED MAGS scaling, mid-reload
  apply + clean finishReload reserve math, full `damageEnemy` kill path, upgrade-off no-op,
  reset clears mod/class/re-enables the card, 3 waves + die + restart + 1 wave, 41.3 FPS
  swiftshader, favicon-only 404s). Test-harness gotcha: the 180 ms `.clip` flash from one check
  leaks into the next check's "no flash" assertion — sleep 250 ms + remove the class between
  flash-sensitive checks. No new controls → no touch work.

### 2026-07-09 — Item 8: Chain lightning on crit — done
- What landed: `mods.chainCrit` (in `baseMods()`, resets per run) + CHAIN LIGHTNING epic in
  `UPGRADES` (uses the item-7 `avail: () => !mods.chainCrit` pattern). New `chainLightning(source,
  from)` called from the crit branch of `damageEnemy` when `mods.chainCrit`: finds the 2 nearest
  OTHER enemies within `CHAIN_RANGE = 12`, deals `CHAIN_DMG (25) * mods.damage` each via
  `damageEnemy(t, …, false)` — crit=false is the recursion guard, so an arc can never re-trigger
  a chain even on a DEADEYE shotgun multi-crit. Visual = `spawnJaggedTracer(from, to)`: 3 pooled
  2-point tracers with jittered midpoints (±1.4 units), cyan-white `0xdffcff`. New `sfx.zap`
  (two high sine slides, one delayed 0.02 s).
- Tuning chosen: 25 flat before `mods.damage`, up to 2 targets, 12-unit range — all per spec.
  Arcs are drawn from the crit's impact `point` (falls back to the enemy mesh position when
  `point` is null, e.g. a splash crit — though splash never crits today). Chain damage passes
  `point = target.mesh.position` so it spawns its own damage number + hit burst, matching ricochet.
  Chain kills award combo/score but no style bonuses (kw=null path), like ricochet bounces.
- Notes for next sessions: verified via headless-Chrome playtest (32 checks): 2-nearest pick,
  exact 25 (+mods.damage scaling), 12-unit cutoff, no self-chain, one zap per crit, jagged
  3-segment continuous cyan-white arcs, non-crit/upgrade-off/single-enemy no-ops, no recursion
  (chain KILL doesn't re-arc), arc-killed exploder still detonates without stack overflow, real
  blaster crit + full 9-pellet shotgun multi-crit through `fireWeapon` (9 chains, no error),
  reset clears the mod + recycles tracers, 3 waves + die + restart + 1 wave, 42.5 FPS
  swiftshader, favicon-only 404s. Harness gotcha (new, worth reusing): with the render loop
  PAUSED the camera stays at y=0, so a `fireWeapon` test ray runs along the floor plane and the
  floor intersects before any enemy — set `camera.position.y = 1.6` + `updateMatrixWorld(true)`
  before firing in paused tests. Also `page.on('console', m.text())` does NOT include the failing
  URL for 404s; filter console noise via `requestfailed`/`response` status instead. Items 10/11
  (rare/epic booleans) can reuse the `avail` predicate; item 11 (volatile deaths) will pass
  kw=null through `killEnemy` the same way chains do. No new controls → no touch work.

### 2026-07-09 — Item 7: Ricochet rounds — done
- What landed: `mods.ricochet` (in `baseMods()`, so it resets per run) + RICOCHET ROUNDS epic
  in `UPGRADES`. Hitscan branch of `fireWeapon` calls `ricochetFrom(enemy, hit.point, w)` on
  blaster enemy hits only (`w.name === 'BLASTER'` — shotgun/rocket never bounce). The helper
  finds the nearest OTHER enemy within `RICOCHET_RANGE = 14` of the impact, deals
  `w.damage * mods.damage * 0.5` (17 base), draws a pooled tracer impact→target in blaster
  cyan. No chains (called from `fireWeapon`, not `damageEnemy`), never crits (`crit=false`),
  `kw=null` so bounce kills earn combo/score but no style bonuses.
- Tuning chosen: added a generic optional `avail: () => bool` predicate on upgrade defs,
  filtered in `drawUpgradeChoices` — one-shot boolean upgrades stop appearing once owned
  (RICOCHET ROUNDS uses `() => !mods.ricochet`). Bounce damage number/burst render at the
  target's mesh position (there's no real ray to intersect).
- Notes for next sessions: items 8/10/11 (also boolean epics/rares) should reuse the `avail`
  predicate. Verified via headless-Chrome playtest (25 checks: pool draw/ownership filtering,
  exact 50% damage + mods.damage scaling, nearest-target pick, 14-unit cutoff, single-enemy
  no-op, kill-without-chain, combo/score-but-no-style on bounce kills, full fireWeapon path
  for blaster/shotgun/upgrade-off, reset, 3 waves + die + restart + 1 wave, 43 FPS
  swiftshader, no console errors). Test-harness gotcha: with the game paused, repositioned
  meshes need `mesh.updateMatrixWorld(true)` before raycast-based tests (render loop normally
  refreshes matrices; damage was silently missing without it).

### 2026-07-09 — Perf fix (not a roadmap item): point-light cull + projectile pooling — done
- What landed: removed the per-entity `PointLight`s from regular enemies, enemy shots and
  pickups (kept: boss, rockets — ammo-bounded — nova, muzzle, the 2 arena lights, so the scene
  now holds ≤ ~7 lights instead of 30+ at high waves). Regular enemies no longer `castShadow`
  (boss still does). Rockets and enemy shots are now pooled (`rocketPool`/`enemyShotPool`,
  shared geometry + material, `freeRocket`/`freeEnemyShot`) per the pooling convention;
  `disposeProjectile` is gone.
- Tuning chosen: nothing visual was compensated — emissive materials + core meshes already
  carry the neon look; the loss of per-enemy floor glow is barely noticeable.
- Notes for next sessions: user reported wave 13 sluggishness; cause was three.js forward
  lighting — every point light is evaluated by every lit pixel (full-screen floor), and each
  new light count recompiles all lit shaders. Headless-Chrome A/B at a wave-13 load (23 enemies
  + boss + pickups, swiftshader): 6.5 → 35.3 FPS, lights 31 → 5. Also verified: both pools
  recycle and survive `resetGame` without leaking, 3 waves + die + restart + 1 wave clean, no
  console errors (favicon 404 only). See the new "point lights are a hard budget" cross-cutting
  reminder — item 17's beam light is fine (singleton) but item 18's per-barrel light should
  become an emissive band only.

### 2026-07-09 — Item 6: Upgrade rarity tiers + reroll — done
- What landed: `rarity` field on all 10 upgrades (6 common / 4 rare — NANO LEECH, PHASE COILS,
  DEADEYE, PAYLOAD are the rares; epics arrive with items 7–11). Weighted draw in
  `drawUpgradeChoices()`: common 70 / rare 25 / epic `5 + min(10, wave)`, with tier-downgrade
  fallback (epic→rare→common→anything) when a tier is exhausted in the 3-card hand; hands stay
  duplicate-free. Card CSS variants: `.upcard.rare` purple `#be6eff`, `.upcard.epic` gold
  `#ffc83c`, plus a small `.uprarity` tag on every card. `#rerollBtn` in the upgrade overlay
  redraws all 3 cards once per run (`state.rerolled`, reset in `resetGame`); `R` while choosing
  triggers it (handled in the `state.choosing` keydown branch, so the reload bind is untouched);
  used state = `.used` class (30% opacity, pointer-events off). `sfx.reroll` = two quick
  triangle blips using the `delay` param from item 3.
- Tuning chosen: with no epics in the pool yet, epic rolls downgrade to rare — measured splits:
  wave 1 ≈ 69.6% common / 30.4% rare, wave 10 ≈ 63.1/36.9 (3000 hands each). With one epic
  injected at wave 10, ~11.4% of slots come up epic — feels right for "epic weight grows".
- Notes for next sessions: items 7–11 only need `rarity: 'epic'` on their defs — draw, CSS and
  fallback already handle epics (verified with an injected dummy epic, screenshot taken).
  Reroll is a DOM button inside the overlay, so touch gets it for free — no `.tbtn` needed.
  Verified via headless-Chrome playtest (23 checks: distributions, no-duplicate hands, epic/rare
  computed border colors, R-key reroll + grey-out + second-R ignored + stays consumed across
  waves, resets on restart, card-click pick path, 3 waves + die + restart + 1 wave, 38 FPS under
  swiftshader, no console errors beyond the pre-existing favicon 404).

### 2026-07-09 — Item 5: Ultimate ability (NOVA) — done
- What landed: `state.ult` 0–100 (+8/kill, +25/boss, tallied in `killEnemy`); `E` key (or new
  NOVA touch button above DASH) sets `wantUlt`, consumed in `update` — so pause/choosing gates
  come free. `activateNova()`: 300 dmg (150 to bosses) to all enemies within 18 units (2D dist),
  `state.slowmo = 0.6`, shake +0.6, `flashCombo('◎ NOVA')`. Visual = persistent hidden torus
  ring (pink) + transparent sphere shell (cyan, DoubleSide) + point light, scaled 0→18 over
  0.5 s in `update`, then re-hidden — nothing to pool. HUD `#ultwrap` bar mirrors dash-bar
  styling in pink; at 100 it gets `.ready` (pulsing glow + gold gradient) plus `sfx.novaReady`
  chime and a flashTip. `sfx.nova` = saw sweep 900→45 Hz + 70 Hz sine sub + noise burst.
- Tuning chosen: nova kills do NOT recharge the meter (`novaBlasting` flag checked in
  `killEnemy`) — spec didn't say, but +8 per nova kill refunded ~half the meter on a good blast.
  Damage applied instantly at activation; the 0.5 s wave is cosmetic. `E` pressed uncharged
  plays `sfx.empty`. Keydown gate `state.running && !state.paused` prevents a buffered E while
  paused from firing on resume.
- Notes for next sessions: verified via headless-Chrome playtest (24 checks: charge rates, HUD,
  gating, radius/boss damage, no self-recharge, persistence across waves, reset, 3 waves + die +
  restart + 1 wave, screenshots of ready bar + mid-blast). Harness gotchas: new Chrome needs
  `--use-angle=swiftshader --enable-unsafe-swiftshader` (old `--use-gl=swiftshader` now fails to
  create a WebGL context), and headless pointer-lock exit events async-re-pause the game — tests
  must clear `state.paused` after any pause/resume or overlay interaction. Boss-kill slowmo (0.9)
  can overwrite nova's 0.6 if the blast kills a boss — harmless, reads as more drama.
- What landed: `damageEnemy`/`killEnemy` gained optional `kw`/`kdist` params (killing weapon +
  hit distance), passed only from the hitscan branch of `fireWeapon`; in `killEnemy`, when `kw`
  is set: AIRSHOT +150 (`!player.onGround`), PHASE KILL +200 (`player.invuln > 0` — only dash
  sets invuln, so it's a clean signal), POINT BLANK +100 (`kw.name === 'SHOTGUN' && kdist < 4`).
  Flat additions after the combo-multiplied score; callout via `flashTip` in crit-yellow
  `#ffe23a` (flashCombo stays reserved for combo/streak text). `state.stats.style` tallies
  bonuses and shows as a fifth STYLE PTS stat on the death screen.
- Tuning chosen: bonuses stack on one kill (all three = +450, tips joined with spaces); rocket
  splash and exploder-chain kills pass `kw = null` so they never earn bonuses (rockets have no
  direct-hit path — documented limitation, all rocket kills are splash).
- Notes for next sessions: verified via headless-Chrome playtest (same scratch-copy +
  `window.__dbg` technique): all 3 bonuses + stacking + negative cases (splash kill, far
  shotgun, close blaster) exact to the point, real `fireWeapon` shot carries kw/dist, stats
  reset on restart, death screen renders 5 stats fine, 3 waves + die + restart + 1 wave clean
  (46 FPS under swiftshader software GL — normal for headless). Gotcha for test writers: combo
  increments *before* score is computed in `killEnemy`, so a kill at combo N scores
  `100 × (N+1)`. Item 10 (dash trail) should award PHASE KILL only via the kw path if trail
  kills are meant to qualify — trail kills won't pass kw, so spec item 10's "counts for PHASE
  KILL" will need a deliberate hook. No new controls, so no touch work needed.

### 2026-07-08 — Item 3: Low-HP danger state — done
- What landed: `#lowhp` fixed vignette div (red radial-gradient, z-index 6 like `#damageflash`);
  entry/exit detected centrally in `updateHealthUI` (`hp > 0 && hp <= maxHp * 0.25`, so every
  heal/damage/maxHp path is covered); pulse `0.35 + 0.2*sin(t*5)` driven from `update`;
  `sfx.heartbeat` = 55 Hz + 50 Hz sine pair 0.16 s apart on a 1 s timer. `beep()` gained an
  optional `delay` param (schedules on `audioCtx.currentTime + delay`) for the second beat.
- Tuning chosen: exit path zeroes opacity immediately (heal, death — hp hits 0 before
  `gameOver`, so the death screen is clean — and reset); `heartbeatT = 0` on entry so the first
  beat lands instantly. Vignette freezes (doesn't hide) under the pause/upgrade overlays —
  update() is gated there; overlays sit at z-index 10 above it, looks fine.
- Notes for next sessions: verified via headless-Chrome playtest (puppeteer-core + scratch copy
  with `window.__dbg`, as items 1–2): pulse samples 0.15–0.55, 2 beats/2.1 s, instant stop on
  heal, enters via PLATED-ARMOR-style maxHp change (30/125), clean death screen, clean across
  restart; 3 waves + die + restart + 1 wave, no console errors (favicon 404 only). No new
  controls, so no touch work needed. `beep({delay})` is now available for any multi-note SFX
  (e.g. item 5's nova).

### 2026-07-08 — Item 2: Combo-pitched kill audio — done
- What landed: `sfx.kill` now takes a pitch multiplier (default 1) applied to both `freq` and
  `slideTo`; `killEnemy` passes `1 + Math.min(state.combo - 1, 12) * 0.06`.
- Tuning chosen: `state.combo - 1` (not `state.combo` as the spec sketched) because `sfx.kill`
  fires *before* the combo increment and combo idles at 1 — this keeps single kills at exactly
  1.0×. Cap at 12 steps → max 1.72× (200→344 Hz base, slide to 1032 Hz).
- Notes for next sessions: verified via headless-Chrome playtest (puppeteer-core driving the
  installed Chrome — scratch copy + `window.__dbg` injection as in item 1): multipliers climb
  1.00→1.72 in 0.06 steps over a 16-kill streak, snap back to 1.00 after the 3 s combo window,
  reset to 1.00 on restart; 3 waves + restart + 1 wave clean, no console errors (only the
  pre-existing favicon 404). No new controls, so no touch work needed.

### 2026-07-08 — Item 1: Floating damage numbers — done
- What landed: pooled `THREE.Sprite` damage numbers (one 128×64 canvas per sprite, redrawn on
  acquire) spawned from `damageEnemy`; white for normal hits, yellow + larger for crits; rise
  2.5 u/s and fade over 0.6 s; expired in `update` next to particles, recycled in `resetGame`.
- Tuning chosen: scale 1.8×0.9 world units (crit 2.6×1.3), +0.3 y offset and ±0.4 xz jitter so
  shotgun pellets don't stack; splash/chain hits (`point=null`) fall back to the enemy mesh
  position via `point || enemy.mesh.position`.
- Notes for next sessions: verified via headless-Chrome playtest in touch mode (user's screen
  was occupied) — 60 FPS sustained at 270 spawns/s (162 concurrent sprites); pool recycles
  cleanly across restarts (52 active → 0 active / 52 pooled after reset). Useful technique: copy
  index.html to a scratch dir, append `window.__dbg = {…}` inside the module script, serve on
  another port — gives test access to module internals without touching the repo file. No new
  controls, so no touch-button work needed.

_(roadmap created 2026-07-08, baseline commits 9564c25 + 4c4df3f)_
