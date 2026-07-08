# NEON STRIKE — Feature Roadmap

Each item below is self-contained and sized to be completed in one focused session.
Workflow: see CLAUDE.md ("Roadmap workflow") — one item per session, one commit per item,
close out with a Session Log entry at the bottom of this file.

## Status board

| #  | Item                          | Phase | Status | Commit |
|----|-------------------------------|-------|--------|--------|
| 1  | Floating damage numbers       | 1     | done   | 3110c0f |
| 2  | Combo-pitched kill audio      | 1     | todo   |        |
| 3  | Low-HP danger state           | 1     | todo   |        |
| 4  | Style-bonus scoring           | 1     | todo   |        |
| 5  | Ultimate ability (NOVA)       | 1     | todo   |        |
| 6  | Upgrade rarity + reroll       | 2     | todo   |        |
| 7  | Ricochet rounds               | 2     | todo   | needs 6 |
| 8  | Chain lightning on crit       | 2     | todo   | needs 6 |
| 9  | Kill clip                     | 2     | todo   | needs 6 |
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

### [ ] 2. Combo-pitched kill audio
**Goal:** Kill sound rises in pitch with the current combo so streaks are audible.
**Hook points:** `sfx.kill` call inside `killEnemy`; `beep()` already takes `freq`/`slideTo`.
**Sketch:** Change `sfx.kill` to accept a multiplier: `sfx.kill(1 + Math.min(state.combo, 12) * 0.06)` scaling both `freq` and `slideTo`. Cap so x99 combos don't become dog whistles.
**Done when:** consecutive fast kills audibly climb; single kills sound unchanged.

### [ ] 3. Low-HP danger state
**Goal:** Below 25% HP the game *feels* dangerous: pulsing red vignette + heartbeat sound.
**Hook points:** `updateHealthUI` (state entry/exit), `update` (pulse animation), `damagePlayer`, `collectPickup`/lifesteal (may exit the state).
**Sketch:** Add a fixed-position CSS vignette div (radial-gradient, red edges, `pointer-events:none`) with opacity driven from `update` (`0.35 + 0.2 * sin(t*5)` while low). Heartbeat = two short low `beep`s (~55 Hz sine pair) on a ~1 s timer in `update`, only while low. Both stop instantly on heal above threshold, on death, and on restart.
**Done when:** entering/leaving low HP toggles cleanly (including via NANO LEECH heals and PLATED ARMOR raising maxHp), no vignette on the death/start screens, resets on new run.

### [ ] 4. Style-bonus scoring
**Goal:** Flashy play pays: bonus score + callout for skilled kills.
**Hook points:** `killEnemy` (score is computed there), `player.onGround`, `player.invuln` (>0 during dash window), weapon + distance at kill time.
**Sketch:** In `killEnemy`, detect: **AIRSHOT** (player not onGround, +150), **PHASE KILL** (killed while dash i-frames active, +200), **POINT BLANK** (shotgun kill < 4 units, +100). Requires passing the killing weapon/distance from `damageEnemy` → `killEnemy` (add optional params, default null for splash/chain kills). Show via `flashTip` (keep `flashCombo` for combo/streaks so they don't fight). Add bonuses to score *before* combo multiplication or as flat additions — flat is simpler and easier to tune.
**Done when:** each bonus triggers correctly and only for player-attributed kills (not exploder chains), callouts readable, death-screen stats optionally count style bonuses.

### [ ] 5. Ultimate ability (NOVA)
**Goal:** A kill-charged ultimate on `E` / touch button: screen-clearing shockwave + brief slow-mo.
**Hook points:** keydown handler, `killEnemy` (charge), `update` (expanding wave), `state.slowmo` (already implemented in `animate`), HUD next to dash bar, touch controls block, `resetGame`.
**Sketch:** `state.ult` 0→100, +8 per kill (+25 per boss). At 100 the HUD bar glows. On activate: expanding emissive ring/sphere from player over ~0.5 s; enemies inside the radius take heavy damage (300, bosses take 150); `state.slowmo = 0.6`; big shake + new `sfx.nova` (low sweep + noise burst). New `.tbtn` for touch, placed near dash.
**Done when:** charge persists across waves, resets per run, cannot activate while `choosing`/paused, kill via ultimate still awards combo/score, HUD bar mirrors dash-bar styling.

---

## Phase 2 — Upgrade system depth

### [ ] 6. Upgrade rarity tiers + reroll  *(do this before 7–11)*
**Goal:** Upgrades get common/rare/epic tiers with color-coded cards, plus one reroll per run.
**Hook points:** `UPGRADES` array, `showUpgrades` (card HTML), `pickUpgrade`, upgrade CSS (`.upcard`), `resetGame`.
**Sketch:** Add `rarity: 'common'|'rare'|'epic'` to each upgrade def. Weighted draw (~70/25/5, epic weight can grow with wave). Card CSS variants: common = current cyan, rare = purple border+glow, epic = gold. Existing 10 upgrades become commons/rares; items 7–11 add the epics. Add a REROLL button in the overlay (usable once per run, `state.rerolled`); reroll redraws all 3 choices. Keyboard: `R` while choosing.
**Done when:** rarity distribution feels right over ~10 waves, reroll works once and greys out, epic cards visually pop, all reset per run.

### [ ] 7. Ricochet rounds (epic upgrade)
**Goal:** Blaster hits bounce to the nearest other enemy for 50% damage.
**Hook points:** hitscan branch of `fireWeapon` (after `damageEnemy`), `spawnTracer` (draw the bounce), `mods`.
**Sketch:** `mods.ricochet = false` → set true by the upgrade. On blaster enemy hit: find nearest other enemy within ~14 units of the impact (skip the one just hit), apply `damage * 0.5`, draw a tracer impact→target. One bounce only (no chains) to keep it sane. Bounce can crit? No — keep it simple, never crits.
**Done when:** bounce visibly connects, no self-chaining infinite loops, works with EXTENDED MAGS/other mods, no bounce when only one enemy alive.

### [ ] 8. Chain lightning on crit (epic upgrade)
**Goal:** Crits arc lightning to up to 2 nearby enemies.
**Hook points:** `damageEnemy` crit branch, `mods`, tracer system for the arc visual.
**Sketch:** `mods.chainCrit = false`. On crit: pick up to 2 nearest enemies within 12 units, deal 25 flat (scaled by `mods.damage`), draw jagged tracer (2–3 segment polyline — extend tracer pool to support 4-point buffers or spawn 2–3 pooled 2-point tracers with a midpoint jitter). Add `sfx.zap` (high sine slide). Guard against recursion: chained damage must not itself trigger chains (pass a flag through `damageEnemy`).
**Done when:** arcs render jagged and cyan-white, no infinite recursion with DEADEYE + shotgun multi-crits, chain kills award combo normally.

### [ ] 9. Kill clip (rare upgrade)
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
