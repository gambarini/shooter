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
| 9  | Kill clip                     | 2     | done   | 1cb3020 |
| 10 | Dash trail damage             | 2     | done   | b9d1f88 |
| 11 | Volatile deaths               | 2     | done   | 2da8e82 |
| 12 | Flying enemy — WASP           | 3     | done   | 7c5700d |
| 13 | Shielded tank — BULWARK       | 3     | done   | cd297f2 |
| 14 | Splitter enemy                | 3     | done   | 1a61931 |
| 15 | Boss phases                   | 3     | done   | 9a28d5a |
| 16 | Elite enemy modifiers         | 3     | done   | d00efea |
| 17 | Challenge waves (mutators)    | 4     | done   |        |
| 18 | Death recap & run summary     | 4     | todo   |        |
| 19 | Arena hazard — laser sweep    | 4     | todo   |        |
| 20 | Exploding barrels             | 4     | todo   |        |

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

### [x] 10. Dash trail damage (rare upgrade)
**Goal:** Dashing leaves a short-lived energy trail that damages enemies it touches; dashing through an enemy damages it.
**Hook points:** dash activation block in `update` (`wantDash`), `mods`, enemy loop for overlap tests, `resetGame`.
**Sketch:** `mods.dashDamage = false`. On dash: record trail as 3–4 pooled glowing quads (or stretched boxes) along the dash path, life 0.8 s. Each enemy overlapping a trail segment (2D distance < 1.5) takes 40 damage once per dash (tag enemies with the dash id). Direct pass-through (player within enemy radius during i-frames) also counts.
**Done when:** trail renders + fades, damage applies once per enemy per dash, pooled/reset correctly, kills via trail count for combo and PHASE KILL style bonus (item 4) if both present.

### [x] 11. Volatile deaths (epic upgrade)
**Goal:** ~20% of kills explode like exploder detonations, damaging nearby enemies.
**Hook points:** `killEnemy` — the exploder chain-explosion block already there is the template; `mods`.
**Sketch:** `mods.volatile = false`. In `killEnemy`, for non-boss non-exploder kills: 20% chance → orange burst + `sfx.explode` + 35 damage falloff within 5 units to other enemies (reuse the exploder loop, iterate over a copy `[...enemies]`). Must not damage the player (it's a reward, not a hazard).
**Done when:** chains can cascade (volatile kill → another kill → maybe another explosion) without stack overflow or array-mutation bugs, explosion visually distinct from enemy exploders (orange vs green).

---

## Phase 3 — Enemy & boss variety

### [x] 12. Flying enemy — WASP
**Goal:** A hovering enemy that circles at height ~6–9 then telegraphs and dive-bombs the player.
**Hook points:** `spawnEnemy` (new type branch), enemy loop in `update` (new movement case), minimap (new color), `disposeEnemy` works as-is if built like others.
**Sketch:** Geometry: small cone or squashed icosahedron, color `#3af0ff`-ish (distinct from all current hues). Appears wave 4+. States: `orbit` (circle player at radius ~14, height 7, bob) → every 4–6 s `telegraph` (0.6 s, flash bright + `sfx.warn`) → `dive` (straight line at player's position captured at telegraph end, fast) → on floor/whiff or hit (12 dmg), climb back to orbit. Vertical position means hitscan already works (raycast is 3D); melee-contact check must use full 3D distance for this type.
**Done when:** dives are dodgeable via dash/strafe, wasp visible on minimap, doesn't get stuck in floor or pillars (skip `collideArena` Y-clamp appropriately, X/Z clamp still applies), boss waves can include wasps.

### [x] 13. Shielded tank — BULWARK
**Goal:** Slow enemy with a front shield that blocks shots; vulnerable from behind/sides or briefly after its charge attack.
**Hook points:** `spawnEnemy`, enemy loop, hitscan branch of `fireWeapon` (shield check), rockets (splash ignores shield or halves damage — pick: halves).
**Sketch:** Big box/slab body, dark with orange emissive; a visibly distinct shield plate child mesh on the front face. Appears wave 5+. Always faces the player (rotate mesh yaw toward player — note other enemies spin freely; this one must not). Shield check: on hit, compare hit direction vs enemy facing (`dot(shotDir, enemyForward) < -0.4` → blocked: spark burst, `sfx` clink, no damage). Every ~5 s: 1 s wind-up telegraph then a fast charge in a straight line (heavy contact damage 25); for 1.5 s after the charge ends the shield drops (visual: plate swings open / emissive off).
**Done when:** flanking works reliably, crit core reachable from behind, charge is telegraphed and dodgeable, shield blocks show clear feedback so players learn the rule without text.

### [x] 14. Splitter enemy
**Goal:** Medium enemy that splits into 2–3 fast mini-chasers on death.
**Hook points:** `spawnEnemy`, `killEnemy` (spawn children on death), enemy loop (minis are just small fast chasers).
**Sketch:** Bigger icosahedron (scale ~1.5), teal/green two-tone. Appears wave 4+. On death: spawn 2–3 `chaser`-type enemies at 0.55 scale, hp ~15, speed ~9, radius ~0.7, tiny score (25). Children spawn slightly separated (use the separation pass to settle). Children must NOT be counted in `state.toSpawn` (they come from deaths) — wave-clear logic (`nextWaveCheck`) already keys off `enemies.length` so it just works; verify.
**Done when:** split feels punchy (burst + sound), minis are killable in 1 blaster shot, no wave-stall where minis spawn after the wave-clear check in the same frame kills the parent last.

### [x] 15. Boss phases
**Goal:** Boss gets a second phase at 50% HP: faster, angrier, new attack pattern.
**Hook points:** boss branch of enemy `update` loop, `damageEnemy` (phase-transition trigger), `spawnBoss` (phase field), boss HP bar.
**Sketch:** `e.phase = 1`. When hp < maxHp/2 and phase 1: transition — 1 s stagger (stop moving, flash white, `sfx.explode`, shake, `flashCombo('⚠ ENRAGED')`), then phase 2: +40% speed, volley becomes 7 shots (`k: -3..3`) AND alternates with a full 12-shot radial ring every other volley; fireCD drops to 1.8. Boss bar changes gradient to angrier red. Optional: spawn 2 chasers at the transition.
**Done when:** transition is unmissable, phase 2 is harder but dodgeable with dash, works at wave 10+ (second boss) where HP scaling differs, no double-trigger of the transition.

### [x] 16. Elite enemy modifiers
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

### [x] 17. Challenge waves (mutators)
**Goal:** Every 7th wave is a named mutator wave with a banner and bonus score.
**Hook points:** `startWave` (roll + apply mutator), `update`/spawn logic (mutator effects), `killEnemy` (score multiplier), wave-clear (revert mutator).
**Sketch:** `state.mutator = null | {...}`. On wave % 7 === 0 pick one:
- **SWARM**: spawn count ×2, all chasers, enemy hp ×0.6, score ×1.5
- **BULLET HELL**: shooters only, their fireCD ×0.5, score ×1.5
- **BERSERK**: enemy speed ×1.5, player damage ×1.5, score ×2
- **FRENZY**: infinite ammo + no reloads (mag never drops), enemy count ×1.5
Banner via `flashCombo` with distinct color + `sfx.wave` variant. Revert everything in the wave-clear path AND in `gameOver`/`resetGame` (mutators must never leak across waves/runs).
**Done when:** each mutator is clearly announced, score bonus applies only during the wave, no mutator state leaks (check death mid-mutator → restart), boss waves (multiples of 5) never collide with mutator waves (7, 14, 21, 28... vs 5, 10, 15... — wave 35 collides: mutator skips if boss wave).

### [ ] 18. Death recap & run summary
**Goal:** Death screen tells the story of the run: killer, upgrades taken, richer stats.
**Hook points:** `damagePlayer` (track last damage source type), `gameOver` (render), `pickUpgrade` (log picks), `state.stats`, death-screen CSS (`#overStats`).
**Sketch:** Track `state.lastHitBy` (set in every `damagePlayer` call — requires passing a source *type* string through: chaser/boss contact, enemy shot, exploder blast, rocket self-damage; laser and barrel once items 19–20 land). On death: "FLATLINED BY: EXPLODER — WAVE 8". Below stats, render picked upgrades as a row of small chips (name + rarity color once item 6 lands; plain otherwise). Add stats: damage dealt, damage taken, favorite weapon (most kills — needs per-weapon kill tally in `killEnemy`).
**Done when:** killer attribution is correct for all damage paths (self-rocket says so — comedic value matters), upgrade chips wrap nicely with 8+ upgrades, everything resets between runs.

### [ ] 19. Arena hazard — laser sweep
**Goal:** From wave 6+, a rotating laser beam periodically sweeps the arena; touching it hurts.
**Hook points:** `startWave` (arm the event), `update` (rotate + collision), `resetGame`, new scene objects (pooled/persistent, just hidden when inactive).
**Sketch:** A tall emissive pillar at arena center (or one of the existing pillar tops) fires a horizontal beam (thin long box, red, with point light) that rotates 360° over ~8 s, once mid-wave with a 2 s warning (beam ghost at 20% opacity + `sfx.warn` beeps). Player collision: 2D line-segment vs player circle each frame while active, 15 dmg + knockback, 0.5 s per-hit cooldown. Enemies unaffected (it's a player-pressure tool) — OR damages enemies too for lure play; damaging enemies too is more fun: same falloff-free 15 dmg with per-enemy cooldown.
**Done when:** warning gives fair reaction time, jump does NOT clear it (beam at torso height) but pillars block line-of-sight (skip damage if `segBlocked` between center and player), off during upgrades/pause, fully reset between runs. Once landed: add `laser` to item 18's killer attribution.

### [ ] 20. Exploding barrels
**Goal:** Neon canisters scattered per wave; shooting one causes a rocket-sized explosion that damages everything nearby.
**Hook points:** `startWave` (spawn 3–5 at random clear spots — reuse the placement loop from `spawnRandomPickup`), hitscan target list in `fireWeapon`, rocket proximity check, `explodeRocket`-style blast (extract a shared `explodeAt(pos, dmg, radius, hurtsPlayer)` helper), `resetGame`, minimap dots optional.
**Sketch:** Cylinder mesh, dark body + yellow emissive band + point light. 1 HP (any hit detonates). Blast: 60 dmg falloff over 6 units to enemies AND player (risk/reward). Chain reactions between barrels (delayed 0.15 s per hop for readability). Cap ~6 alive.
**Done when:** barrels join the hitscan target list and rocket/enemy-shot? (enemy shots should NOT detonate them — player-only trigger keeps it strategic; document the choice), chains feel readable, disposed on reset, luring exploder/chaser packs into barrels works. Once landed: add `barrel` to item 18's killer attribution.

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

### 2026-07-11 — Item 17: Challenge waves (mutators) — done
- What landed: `MUTATORS` table + `state.mutator`, rolled in `startWave` when
  `n % 7 === 0 && n % 5 !== 0` (boss waves win the collision — first real hit is wave 35).
  SWARM `#ff8f3a` (spawns ×2, all chasers, hp ×0.6, score ×1.5) · BULLET HELL `#b04bff`
  (shooters only, fireCD ×0.5 at spawn AND on refire, score ×1.5) · BERSERK `#ff2020`
  (enemy speed ×1.5 incl. splitter minis, damage ×1.5 via `damageEnemy`, score ×2) ·
  FRENZY `#00f0ff` (spawns ×1.5, infinite ammo: mags topped on entry, `w.mag--` skipped,
  `reload()` refuses, HUD mag reads `∞ / ∞`). Banner = `flashCombo('☣ NAME', color)` +
  `flashTip` description + new `sfx.mutator` (wave beep layered with a dissonant sawtooth
  + noise). Reverted in `nextWaveCheck` (the wave-clear moment, via new `clearMutator()`
  which also restores the ammo counter), in `gameOver`, and in `resetGame`.
- Tuning chosen: score multiplier applies to kill score only —
  `Math.round(scoreVal × combo × scoreMul)` — style bonuses stay flat. BERSERK's ×1.5 sits
  at the top of `damageEnemy`, so every damage path scales, including enemy-vs-enemy blasts
  (deliberate: only ever helps the player). FRENZY tops all mags at wave start (an empty
  mag would dead-lock `fireWeapon`'s `mag <= 0 → reload` path) and cancels an in-flight
  reload; mags stay full after the wave, reserves untouched; no score multiplier — infinite
  rockets IS the reward. Elites still roll on mutator waves (an ELITE SWIFT swarm chaser is
  a fun spike). Forced types skip the whole type-roll chain, so `forceT` waves consume no
  type randomness (rig-sensitive tests beware).
- Notes for next sessions: verified via headless-Chrome playtest — 33 unit checks (wave
  gate incl. 35-collision, banner text/color/tip, sfx spy both ways, per-mutator exact
  math: toSpawn 15→30/22, hp 80.4, fireCD 1.0 + live refire in [0.9,1.65], speed 14.3775,
  damage 50→75, mini speed 13.875, score ×1.5/×2 with the combo-bump, FRENZY top-up/
  no-decrement/reload-refusal/∞-HUD/restore, wave-clear revert, gameOver + resetGame
  no-leak, flat style bonus during mutator) + 6 integration checks (real run waves 1→8,
  wave-7 real roll + banner, wave 8 clean, die + restart + 1 wave) + SWARM load test
  (29 chasers + shotgun spam, 36.5 FPS swiftshader ≈ baseline, screenshot eyeballed);
  zero console errors. Gotchas for test authors: `killEnemy` bumps combo BEFORE computing
  score, so a kill at combo N scores ×(N+1); and only the FRENZY mag shows ∞ — the blaster
  reserve is ALWAYS ∞, so leak assertions must check the string prefix, not includes().
  Item 18 (death recap): nothing new to attribute — mutators add no damage source types.
  No new controls → no touch work.

### 2026-07-11 — Item 16: Elite enemy modifiers — done
- What landed: elite roll in `spawnEnemy` right after the type roll (wave 3+, 8%, kind drawn
  from `ELITE_KINDS`/`ELITE_TINT` — SWIFT `0x00f0ff`, VOLATILE `0x8aff3a`, SHIELDED `0xff7a1a`).
  Elite = `e.elite` + `baseScale: 1.4` (mesh.scale set at spawn), hp ×2.5 (after wave scaling),
  scoreVal ×3, radius ×1.4, hull emissive/core/`e.color` = base hue lerped 0.6 toward the mod
  color, `flashTip('⚠ ELITE ' + kind, modColor)` on spawn. SWIFT: speed ×1.6. SHIELDED:
  `dmg *= 0.75` for non-crits at the top of `damageEnemy` (covers every damage path; crits
  pierce). VOLATILE: shares the exploder detonation block in `killEnemy`
  (`type === 'exploder' || elite === 'VOLATILE'`) so an exploder that rolls VOLATILE explodes
  exactly once — enemy-only 30-dmg/5-unit falloff, and the `else if` keeps the volatile
  UPGRADE from stacking a second blast. Guaranteed drop: `enemy.elite ||` before the 0.22
  roll. Scale-aware rewrites: damage-flash pops to `baseScale×1.15` and settles to `baseScale`
  (not 1), exploder fuse swell multiplies from baseScale, bulwark + ground-type y ×baseScale,
  minimap dot radius ×1.4.
- Tuning chosen: tint blend 0.6 — full recolor killed type identity; on the hot-pink chaser
  the three kinds read steel-blue / olive-green / orange-red at a glance (screenshot checked).
  All 6 non-boss types can roll elite; minis are structurally excluded (`spawnMini`, per the
  item-14 note) and an elite splitter's brood does NOT inherit elite — plain 15-hp minis, the
  ×3 score + guaranteed drop is the parent's reward. VOLATILE blast is the exploder's flat 30
  (no `mods.damage` — it's enemy-sourced, unlike the volatile upgrade's 35).
- Notes for next sessions: verified via headless-Chrome playtest (41 checks: wave gate at 2/3
  incl. 400 real wave-2 rolls, exact ×2.5/×3/×1.6/×1.4 field math vs a rigged plain twin,
  per-type elite spawns (shooter/exploder/wasp/splitter/bulwark) with exact hp/radius/speed,
  tint-lerp exactness on hull+core+e.color, flashTip, SHIELDED 75/100 with crit pierce,
  VOLATILE falloff 18@d=2 / 0@d=8 / player untouched at d=1, exploder+VOLATILE single blast,
  cascade = exactly 2 kills, guaranteed drop vs rigged-fail plain kill, score 300×combo,
  brood non-elite, damage-flash 1.61→1.4, fuse swell >1.5, bulwark y≈1.96, minimap pixel
  ratio ≈2×, 8% rate + uniform kinds over 2500 wave-6 spawns, live run waves 1→7 through the
  wave-5 boss + die + restart + 1 wave, 35 FPS swiftshader under elite+shotgun load, zero
  console errors with URL-aware 404 filtering). Harness traps found: `__dbg` injection must go
  before the LAST `</script>` — the first one closes the import map and corrupting it kills
  the module silently; Math.random rig sequences are call-order-dependent per type path (type
  rolls short-circuit below their wave gates, so wasp/bulwark/splitter consume no roll at low
  waves). Item 20 (barrels): the `(e.baseScale || 1)` pattern is now how any sized variant
  coexists with the damage-flash scale writes. No new controls → no touch work.

### 2026-07-11 — Item 15: Boss phases — done
- What landed: boss gains `phase: 1, staggerT: 0, volleyAlt: false`. Single trigger in
  `damageEnemy` (`type==='boss' && phase===1 && hp>0 && hp < maxHp/2` → `bossEnrage`, defined
  next to `spawnBoss`): emissive → white, `sfx.explode`, shake +0.5, `flashCombo('⚠ ENRAGED',
  '#ff2020')`, `staggerT = 1.0`. Boss update branch: while staggered it's frozen in place
  strobing white (2.5 ± 2·sin(t·30)); buffs land when the stagger ENDS — speed ×1.4, body
  emissive + `e.color` → `0xff2020`, core → white, `fireCD = min(fireCD, 1.0)` (wakes up
  shooting), `sfx.charge`. Phase-2 firing: fireCD 1.8 (vs 2.6), 7-shot aimed spread (k −3..3)
  alternating with a 12-shot radial ring (30° spacing; first post-wake volley is a ring).
  `#bossfill.enraged` CSS (red→orange gradient) toggled per frame off `boss.phase`, removed
  in `resetGame`. Damage-flash reset gained a boss-stagger exception so shooting the boss
  mid-stagger doesn't flatten the strobe to the flat 2.2 flash.
- Tuning chosen: buffs at stagger end make the full 1 s a free punish window. Skipped the
  spec's optional 2-chaser spawn at the transition — stagger + strobe + banner + shake already
  read unmissable and the ring volley is the difficulty add. Overkill through the threshold
  (hp ≤ 0 in one hit) skips enrage via the `hp > 0` guard; phase flips inside `bossEnrage`
  so double-trigger is structurally impossible. All damage paths (splash/chain/nova) route
  through `damageEnemy`, so any source can trip the transition.
- Notes for next sessions: verified via headless-Chrome playtest (38 checks: spawn fields,
  51%-no-trigger, threshold flip + white + banner + shake + explode spy, frozen + strobe
  overriding damage-flash under sustained fire, exact ×1.4 speed at waves 5 AND 10 (maxHp
  1500/2100), red body + white core + charge spy + `.enraged` class, volley pattern 12,7,12,7
  with 30°±0.02 ring spacing + 1.32 rad spread width + ~1.8 s cadence, no re-trigger, bar
  width tracks hp, phase-2 kill banner, overkill skip, reset mid-stagger + clean next boss,
  real run waves 1→5 through both phases → boss dead → wave 6 → die → restart → 1 wave;
  27.8 FPS during the live phase-2 fight — same-page swiftshader measure, reads low per the
  session-12 lesson; no console errors). Screenshots eyeballed: stagger = white blaze,
  phase 2 = hot red vs the pink pillars. Dodge math: ring gaps ≈ 7.8 u at 15 u (strafe
  clears), 7-spread gaps ≈ 3.3 u at 15 u (dash clears). Item 17 (mutators) note: wave-35
  boss+mutator collision rule already in that spec. No new controls → no touch work.

### 2026-07-10 — Item 14: Splitter enemy — done
- What landed: `splitter` enemy type (wave 4+, chance `min(0.22, 0.06 + wave*0.02)` rolled after
  shooter/exploder/wasp/bulwark), shared `splitterGeo` icosahedron 1.65 (≈ chaser × 1.5) +
  `miniGeo` 0.6, both in `SHARED_ENEMY_GEO` — dedicated geos, NOT scaled chaserGeo, because the
  damage-flash writes `mesh.scale` directly. Two-tone: teal hull `0x1fffc3` + exploder-green
  core `0x8aff3a` (hints "something inside"). hp `70 + wave*12`, speed `4.6*boost`, radius 1.5,
  y 1.9, contact 12. Movement/contact reuse the chaser paths untouched. On death (in `killEnemy`,
  after the pickup block): teal burst + new `sfx.split` (two rising square blips + noise) +
  2–3 `spawnMini` children — type `'chaser'` with `mini: true`, flat hp 15 (one blaster shot at
  ANY wave), speed 8.5–10, radius 0.7, y 1.0, contact 8, score 25, radially scattered 1.4 units
  (separation pass settles them, `collideArena` clamps). New `scoreVal` field on all enemies
  (splitter 150, mini 25, default 100) replaces the hardcoded 100 in `killEnemy`. Minimap: teal
  dots, splitter 3.2 / mini 1.8.
- Tuning chosen: children spawn LAST in `killEnemy` — after the volatile/exploder blast blocks —
  so a volatile roll on the splitter can't wipe the brood the frame it exists, and blast
  snapshots (`[...enemies]`) taken by nova/exploder/volatile before the kill never contain the
  children (verified: exploder-chain and nova kills both leave minis at full 15 hp). Splitter hp
  70 (spec had none): dies to ~2 blaster bursts, tanky enough to reach mid-range. Mini contact
  lowered to 8 (vs chaser 12) — a 3-pack alpha-strike at 36 felt unfair for a "reward" spawn.
- Notes for next sessions: verified via headless-Chrome playtest (37 checks: wave gate 3/4,
  stats/geo-sharing/two-tone, split count {2,3} over 60 kills, mini stats + placement, sfx spy,
  scoreVal math incl. combo (kill at combo N scores val×(N+1)), real one-shot blaster kill,
  wave keeps running while minis live then clears, volatile-ordering with damage witness,
  exploder-chain kill → exactly 2 kills tallied, nova, contact 8/12, pursuit speed + bob band,
  minimap pixels, reset + respawn, live run waves 1→6 with real rolls + die + restart + 1 wave,
  29 FPS swiftshader at 33 enemies incl. brood + shotgun spam, no console errors). NEW HARNESS
  TRAP that burned this session: a stale `python3 -m http.server` from a PREVIOUS session still
  owned port 8123 and served the old scratch copy (which had its own `__dbg`, so nothing
  obviously failed — tests just ran against last session's build). Check `lsof -iTCP:<port>`
  or use a fresh port, and kill the server when done (this session's 8124 was killed).
  Blast falloffs use 3D `distanceTo` — position damage witnesses at the same y. Item 16
  (elites): exclude minis from the elite roll (they come from deaths, not `spawnEnemy`, so
  it's structural — but if elite splitters are allowed, consider whether the brood inherits).
  No new controls → no touch work.

### 2026-07-10 — Item 13: Shielded tank — BULWARK — done
- What landed: `bulwark` enemy type (wave 5+, chance `min(0.18, 0.05 + wave*0.015)` rolled after
  shooter/exploder/wasp), shared `bulwarkGeo` slab (2.0×2.4×1.4) + `bulwarkShieldGeo` front
  plate (2.4×2.6×0.16 at local z 0.88, per-enemy material), both in `SHARED_ENEMY_GEO`. Hue
  `0xff7a1a`, hp `110 + wave*15`, speed `2.0*boost`, radius 1.6, crit core moved to local
  z −0.5 (reachable from behind). State machine: `walk` (slow advance, yaw-only facing capped
  at 1.8 rad/s — never free-spins) → every ~4.5–6 s with dist<32 + clear LOS → `windup` (1 s,
  emissive pulse on body+plate, `sfx.warn`) → `charge` (dir locked at wind-up END at the
  player's position then; 24 u/s for 0.9 s; contact = 25 dmg + velocity shove; wall/pillar
  clamp = slam burst + early end) → `stagger` (1.5 s, `shieldUp=false`, plate swings open
  rot.y 1.35 + glow 0.08, vent hiss) → walk. `bulwarkBlocks(e, shotDir)` in the hitscan branch
  of `fireWeapon`: while `shieldUp`, shots with `dot(shotDir, forward) < -0.4` (≈±66° front
  cone) are blocked — spark burst + new `sfx.clink`, no damage/hit-stat/ricochet. Rocket splash
  ×0.5 vs raised shield (per spec), full when down. New `sfx.charge` (low saw rise + noise).
  Minimap dot `#ff7a1a`, radius 3.4 (bigger than regulars).
- Tuning chosen: turn cap 1.8 rad/s makes flanking real — sprint-strafe out-turns it inside
  ~7 units, dash always does. Charge locks at wind-up end (not start) so the 1 s telegraph is
  the dodge window; a sidestep after the lock whiffs it cleanly. Dash i-frames negate charge
  contact damage but still end the charge (stagger), so phasing through is a safe shield-opener.
  Splash-type damage other than rockets (chain lightning, volatile, exploder blasts, nova, dash
  trail) deliberately ignores the shield — only aimed fire respects facing; spec only names
  rockets and the epics stay consistent with items 7–11.
- Notes for next sessions: verified via headless-Chrome playtest (38 checks: wave gate,
  stats/geo-sharing/plate/core placement, block-cone unit tests incl. −0.4 threshold, live
  blaster fire front/side/back-crit/staggered-front with clink spy, rocket halving exactness,
  walk speed + no free spin, turn-cap flank, full traced cycle with durations
  windup 1.00 s / charge 0.92 s / stagger ~1.5 s, lock accuracy dot≈1, whiff dodge, exact 25
  contact + shove, i-frame negate, wall slam early-stagger, minimap pixel, kill/dispose/respawn,
  reset mid-charge, real-roll waves 5–7 + die + restart + 1 wave, no console errors). Perf A/B
  on fresh pages (session-12 lesson): 23 enemies + boss + shotgun spam, 5 bulwarks vs 5 chasers
  = 26.4 vs 28.0 avg FPS (swiftshader) — within run noise, no per-entity lights added. Harness
  gotchas added this session: auto-play integration must NOT kill bulwarks before their first
  stagger or charge is never observed; probe/tracer races — snapshot transition logs ~100 ms
  after the state flips, and measure charge-lock accuracy inside the probe before dodging.
  Item 16's SHIELDED elite modifier is a flat damage reduction — unrelated to this directional
  shield; don't merge them. No new controls → no touch work.

### 2026-07-10 — Item 12: Flying enemy — WASP — done
- What landed: `wasp` enemy type (wave 4+, chance `min(0.25, 0.08 + wave*0.02)` rolled after
  shooter/exploder), shared `waspGeo` cone (0.85×1.5, 6 sides, in `SHARED_ENEMY_GEO`), hue
  `0x3af0ff`, hp `35 + wave*8`, radius 0.9. State machine in the enemy loop: `orbit` (ring
  radius 14 around the player, per-wasp `hoverH` 6–9, next-dive timer 4–6 s) → `telegraph`
  (0.6 s, emissive flash + `sfx.warn`) → `dive` (26 u/s straight at the player position locked
  at telegraph END, stinger oriented along the dive via quaternion; 12 contact dmg on full-3D
  distance, floor/pillar/1.4 s-timeout = whiff burst) → `climb` (8 u/s back to `hoverH`, re-seed
  orbit angle from actual bearing). New `sfx.dive` (sawtooth 1500→220). Minimap dot `#3af0ff`.
  New `collideWasp`: arena X/Z clamp always, pillar push-out only when below the pillar top,
  and a push while diving converts to climb.
- Tuning chosen: orbit target re-derives `orbitAngle` from the wasp's actual bearing each frame
  (nearest ring point nudged ahead) — a blindly-advancing angle made far-away wasps spiral in
  and settle at radius ~9 instead of ~14. Orbit chase speed = `speed*1.7` so it tracks a moving
  player. Two cross-type guards added: the separation pass skips pairs with |Δy| > 2.5 (a wasp
  overhead no longer shoves ground units), and both AFTERBURN dash-trail checks skip enemies
  above y 3.5 (ground trail can't hit orbiting wasps; diving wasps below that ARE hittable).
- Notes for next sessions: verified via headless-Chrome playtest (48 checks: spawn shape/hue/
  shared-geo/lane, orbit hold + radius + circling, telegraph timing/flash/warn, dive lock dir +
  exact 12 dmg + climb, whiff dodge + never-below-floor, dash-i-frame negate, fly-over vs push-out
  vs dive-whiff on pillars, 3D hitscan hit, minimap pixel color, separation guard both ways,
  trail high-miss/low-hit, kill/reset/respawn, 4 waves + die + restart + 1 wave real rolls,
  no console errors; screenshot of 3 orbiting wasps). Perf: FPS must be measured on a FRESH page
  — same-page measurement right after the integration run read 9–12 FPS while a clean A/B read
  baseline 39.6 vs wasp-build 39.7/39.8 (23 enemies, 10 wasps, swiftshader 1280×800): zero
  regression. Boss-wave wasps come free (same spawn roll). Item 13's BULWARK must NOT reuse the
  free-spin block — it needs yaw-facing (see its spec). No new controls → no touch work.

### 2026-07-10 — Item 11: Volatile deaths — done
- What landed: `mods.volatile` (in `baseMods()`) + VOLATILE epic in `UPGRADES` (item-7 `avail`
  pattern). In `killEnemy`, an `else if` chained off the exploder-detonation block (so exploders
  and bosses are excluded structurally): `mods.volatile && !isBoss && Math.random() < 0.2` →
  orange burst (`0xff8c1a`, same 24/18/0.26 params as the green exploder one) + `sfx.explode` +
  `35 * (1 - d/5) * mods.damage` to enemies within 5 units, iterating `[...enemies]`. Player is
  never touched (no `damagePlayer` call). Splash passes `point=null`, `kw=null` → damage numbers
  at the enemy mesh, combo/score awarded, no style bonuses — same as exploder chains.
- Tuning chosen: damage scales with `mods.damage` (spec said flat 35) for consistency with
  items 7/8/10. Bug found & fixed IN BOTH blast loops (volatile + the pre-existing exploder
  template): the `[...enemies]` snapshot goes stale when a recursive cascade kills a later
  entry — the outer loop then damaged the removed enemy again → second `killEnemy` on it
  (double combo/score/kills/dispose; a 6-enemy volatile chain counted 10 kills). Guard is
  `e.hp > 0` in both loops. The exploder fix is technically outside item scope but the spec's
  "no array-mutation bugs in cascades" is unmeetable without it (volatile cascades route
  through the exploder block when they kill one).
- Notes for next sessions: verified via headless-Chrome playtest (24 checks: def/avail/draw
  pool, off-by-default no-op, exact falloff at d=2/4, d≥5 no-op, mods.damage scaling,
  roll ≥ 0.2 no-op, boss + exploder exclusion, exploder-chain 3-kill exactness, orange-particle
  burst, player untouched at 1 unit, 6-enemy cascade = exactly 6 kills/combo 7/no error, reset +
  redrawable, 3 waves + die + restart + 1 wave with real rolls, 39.7 FPS swiftshader, no
  console errors with the URL-aware 404 filter). Harness note: rigging `Math.random` (to force
  the 20% roll) also forces the 22% pickup drop in `killEnemy` — harmless, but rig/unrig
  tightly around the kill. No new controls → no touch work.

### 2026-07-10 — Item 10: Dash trail damage — done
- What landed: `mods.dashDamage` (in `baseMods()`) + AFTERBURN rare in `UPGRADES` (item-7 `avail`
  pattern). Dash activation arms `dashId++` / `dashTrailT = 0.3` (matches the i-frame window);
  a block in `update` right after the player's `collideArena` drops pooled stretched-box segments
  (`trailSegs`/`trailSegPool`, shared `TRAIL_GEO`, per-segment material for the opacity fade,
  cyan `0x7df9ff`, y=1.1, life 0.8 s) every `TRAIL_SPACING = 0.7` units of *actual post-collision*
  travel, plus a final partial segment. Damage: enemy within `1.5 + e.radius * 0.5` (2D
  point-to-segment) of any live segment, or within contact range of the player while the window
  is open (pass-through — covers zero-travel dashes into walls), takes `40 * mods.damage` once
  per dash (`e._dashId` tag). `resetGame` recycles segments + zeroes the window.
- Tuning chosen: spacing 0.7, not the spec's "3–4 quads" at ~2.2 — a standstill dash only covers
  ~2 units (velocity lerps to 0 at accel 14/s, ≈34/14), ~4.5 moving, so 0.7 gives 3–6 quads.
  Damage scales with `mods.damage` (spec said flat 40) for consistency with ricochet/chain.
  Item-4's PHASE KILL hook resolved: trail kills pass pseudo-kw `TRAIL_KW = {name:'PHASE TRAIL'}`
  only while `player.invuln > 0`, so dash-window kills earn PHASE KILL +200 (and AIRSHOT if
  airborne); lingering-trail kills pass kw=null → combo/score only, no style. A lingering trail
  can never straddle two dashes (min dashCD ≈ 2 s with stacked PHASE COILS > 0.8 s life), so the
  single global `dashId` tag is safe.
- Notes for next sessions: verified via headless-Chrome playtest (26 checks: def/avail, off-by-
  default no-op, 3+ segments covering the path, exact single 40 tick per dash incl. re-dash,
  mods.damage scaling, out-of-range no-op, wall-dash pass-through, trail-kill combo/score/
  PHASE KILL, lingering kill without style, mid-dash reset, 3 waves + die + restart + 1 wave,
  56 FPS swiftshader, no console errors). New harness gotchas: the async pointer-lock re-pause
  needs a `setInterval(() => state.paused = false, 25)` — a one-shot unpause in the same evaluate
  loses the race; and killing the last enemy freezes `update` via the upgrade overlay
  (`state.choosing`) — keep a far-away dummy alive (or treat `choosing` as settled) before
  waiting on trail expiry. Player spawn area has a central obstacle: tests that reposition the
  player must scan `obstacles` for a clear lane or `collideArena` teleports the player. No new
  controls → existing DASH touch button covers it.

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
