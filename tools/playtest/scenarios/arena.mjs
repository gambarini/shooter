// The arena reconfiguring between waves (roadmap item 82). The floor is a pure function
// of the wave number, and "pure function" is exactly the kind of promise a machine can
// settle and a human cannot: nobody watching the screen can tell a deterministic arena
// from a random one, and a random one would break `--seed` reproducibility, the `ab`
// scenario's baseline diff, and item 43's seeded daily challenge.
//
// Every assertion below reads the `arena` field of the shared SNAPSHOT — a compact
// signature of the LIVE `obstacles` list — so nothing here knows what an archetype is.
// Retune a height profile, add a seventh archetype or reorder the symmetries and the
// numbers move without a single check needing an edit. The two places a literal is
// deliberately hardcoded are the wave-1 floor (which must not drift, ever — it is the
// build the game shipped with) and the mutator pairings (which ARE the spec).
//
// Waves are reached with `startWave(N)` and mutators are forced through
// `state.nextMutator`, never by playing until the seed produces one: a seed-dependent
// moment is a flaky check, and a flaky check in the CI gate is a gate somebody disables.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), '.playtest');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A wave that stays on screen: `toSpawn = 1` with the spawn timer parked forever spawns
// nothing and clears never — zeroing it instead would clear the wave on the next frame
// and slide the upgrade screen over everything (the wave-hold idiom `ab` documents).
// The hp pool is the target-dummy trick `boss` and `medals` use: this scenario parks the
// player rather than dodging, so it has to be able to survive standing still.
const PARK = `p.driven = true; p.turbo = 1;
  p.state.toSpawn = 1; p.state.spawnTimer = 1e9; p.state.pickupTimer = 1e9;
  p.state.betweenWaves = 0;
  p.player.maxHp = 1e7; p.player.hp = 1e7;`;

// One wave's floor, from a fresh run every time so nothing carries over — not a boss the
// last leg spawned, not a mutator, not a pickup standing where a box wants to be. The
// park has to happen in the SAME eval as startWave, or update() runs once unparked.
//
// The player is walked to the north wall first, and that matters: a wave entered without
// a between-wave gap still refuses to raise a box on top of whoever is standing there, so
// a player left on the (0, 30) spawn clips a box off RING and OPEN and every signature
// below would be of a floor with a hole in it. (0, 64) is clear of every archetype, so
// what comes back is the layout function's own output.
async function at(ctx, n, mutName) {
  await ctx.eval(`const p = window.__probe;
    p.fn.startGame();
    ${PARK}
    p.player.pos.x = 0; p.player.pos.z = 64; p.player.vel.set(0, 0, 0);
    ${mutName ? `p.state.nextMutator = p.MUTATORS.find(m => m.name === ${JSON.stringify(mutName)});` : ''}
    p.fn.startWave(${n});
    ${PARK}
    return true;`);
  return (await ctx.snapshot()).arena;
}

// Half of an archetype is a silhouette: whether COLONNADE reads as lanes and WARREN as
// corners is not something a check can settle. Photograph each one from above, with the
// sim frozen so the shutter and the physics cannot argue about where the player is.
// `posed` means the caller has already placed the camera and frozen the clock — the
// mid-rise frame has to, because the moment it wants is 300 ms wide.
async function shot(ctx, name, posed) {
  try {
    if (!posed) await ctx.eval(`const p = window.__probe;
      p.turbo = 1;
      p.player.pos.set(0, 46, 74); p.player.vel.set(0, 0, 0);
      p.lookAt(0, -6, 0);
      p.fixedDt = 0;                 // freeze: gravity must not pull the camera out of shot
      return true;`);
    await sleep(160);
    mkdirSync(OUT, { recursive: true });
    const s = await ctx.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `arena-${name}.png`), Buffer.from(s.data, 'base64'));
  } catch { /* a screenshot is a courtesy, never a reason to fail a run */ }
  await ctx.eval(`const p = window.__probe; p.fixedDt = null; p.turbo = ${ctx.cfg.turbo}; return true;`);
}

const slots = a => a.sig.split('|');            // one 'x,z,hw,hd,h' record per live box
const heights = a => a.sig.split('|').map(b => +b.split(',')[4]);
const area = a => a.sig.split('|').reduce((t, b) => {
  const f = b.split(',').map(Number); return t + f[2] * 2 * f[3] * 2; }, 0);

export default async function arena(ctx) {
  // ---- 1. the floor is a pure function of the wave --------------------------
  const w = {};
  // 22, not 21: every 7th wave rolls a mutator, and a mutator owns the floor, so wave 21
  // is not a sample of what the layout function does on its own.
  // 26, 27 and 29 are the plain waves of the block item 84 took back from OPEN: 25 and 30
  // are bosses and 28 always rolls a mutator, so those three are the whole of what the
  // rotation itself decides there.
  for (const n of [1, 2, 3, 5, 6, 8, 10, 11, 16, 22, 26, 27, 29]) w[n] = await at(ctx, n);
  ctx.log(`floors: ${Object.entries(w).map(([n, a]) => `w${n}=${a.name}/${a.count}`).join(' ')}`);

  // Wave 1 is the floor the game shipped with — unrotated, unprofiled, nine boxes. Same
  // rule sector 1 follows. Written out rather than read back, so a future edit to SCATTER
  // or to the symmetry order cannot quietly redefine what "wave 1" means.
  const WAVE1 = '-22,-18,2.5,2.5,10|24,-22,3,3,14|18,20,2.5,2.5,9|-26,24,3,3,12|' +
                '0,0,4,4,6|-40,-2,2,2,16|40,8,2,2,18|6,-38,2.5,6,8|-10,40,6,2.5,7';
  ctx.check('arena: wave 1 is the original nine-box floor', w[1].sig === WAVE1, w[1].sig);
  ctx.check('arena: the floor knows which wave it is for', w[1].wave === 1 && w[1].count === 9,
            `wave=${w[1].wave} count=${w[1].count}`);

  // Re-oriented every wave; a new archetype across every 5-wave boundary.
  ctx.check('arena: the floor changes every wave',
            w[2].sig !== w[1].sig && w[3].sig !== w[2].sig,
            `1!=2 ${w[2].sig !== w[1].sig}, 2!=3 ${w[3].sig !== w[2].sig}`);
  ctx.check('arena: a 5-wave boundary changes the archetype',
            new Set([w[1].name, w[6].name, w[11].name, w[16].name, w[22].name]).size === 5,
            `1=${w[1].name} 6=${w[6].name} 11=${w[11].name} 16=${w[16].name} 22=${w[22].name}`);

  // The height profile is a difficulty lever, not decoration — a low floor makes WASPs
  // unblockable and opens every shooter's line of sight, a tall one closes both. So it
  // has to actually travel, not wobble.
  const lo = Math.min(...heights(w[2])), hi = Math.max(...heights(w[3]));
  ctx.check('arena: the height profile cycles low -> tall', lo < 6 && hi > 12,
            `wave 2 min h=${lo}, wave 3 max h=${hi}`);

  // Cover holds within ~15% of the original 338 u² everywhere except the boss floor,
  // which is the one sanctioned exception. Measured off the live records, so a mistyped
  // archetype fails here instead of shipping an unplayably sparse or dense arena.
  const budget = [2, 3, 6, 8, 11, 16, 22, 26, 27, 29].map(n => [n, Math.round(area(w[n]))]);
  ctx.check('arena: cover budget holds within 15% of 338 u²',
            budget.every(([, v]) => Math.abs(v / 338 - 1) <= 0.15),
            budget.map(([n, v]) => `w${n}=${v}`).join(' '));

  // Item 84 — the boss floor is reached by being a boss wave (or by FRENZY), never by the
  // rotation arriving at it. This is the rule that decides how long the cycle is, so it is
  // asserted twice over: by name against whatever floor wave 5 turns out to be, and by the
  // budget sample above, which now covers a full period and measures the cover a wave
  // actually has — a future edit that reintroduced a different sparse archetype into the
  // rotation would slip past the name check and not past that one.
  ctx.check('arena: the rotation never hands a plain wave the boss floor',
            [26, 27, 29].every(n => w[n].name !== w[5].name),
            `w26=${w[26].name} w27=${w[27].name} w29=${w[29].name}, boss floor=${w[5].name}`);
  // ...so the cycle is five archetypes long and wave 26 is back at the first one — in a
  // different orientation, because SYM has its own period of 8.
  ctx.check('arena: the rotation is five archetypes long and wraps re-oriented',
            w[26].name === w[1].name && w[26].sig !== w[1].sig,
            `w26=${w[26].name} vs w1=${w[1].name}, same sig ${w[26].sig === w[1].sig}`);

  // ---- 2. boss waves own an open floor --------------------------------------
  ctx.check('arena: boss waves fight on an open floor',
            w[5].name === w[10].name && area(w[5]) < 338 * 0.7 && Math.max(...heights(w[5])) < 6,
            `w5=${w[5].name}/${Math.round(area(w[5]))}u² h<=${Math.max(...heights(w[5]))} w10=${w[10].name}`);

  // ---- 3. mutators own their floor, and give it back ------------------------
  const PAIRED = { SWARM: 'WARREN', 'BULLET HELL': 'COLONNADE', BERSERK: 'RING', FRENZY: 'OPEN' };
  const floors = [];
  for (const [name, want] of Object.entries(PAIRED)) {
    const a = await at(ctx, 7, name);
    floors.push(`${name}->${a.name}`);
    ctx.check(`arena: ${name} is fought on ${want}`, a.name === want, `got ${a.name}`);
  }
  ctx.log(`mutator floors: ${floors.join(' ')}`);
  // BULLET HELL is the one that also forces the profile: rapid-fire shooters with no hard
  // cover is not a fight, it is a firing squad.
  const bh = await at(ctx, 7, 'BULLET HELL');
  ctx.check('arena: BULLET HELL raises hard cover', Math.min(...heights(bh)) > 12,
            `min h=${Math.min(...heights(bh))}`);
  // ...and the wave after a mutator wave is the plain function of n again. Nothing to
  // undo — the next layout is recomputed from the wave number regardless.
  await ctx.eval(`const p = window.__probe;
    p.player.pos.x = 0; p.player.pos.z = 64; p.player.vel.set(0, 0, 0);
    p.state.nextMutator = p.MUTATORS.find(m => m.name === 'SWARM');
    p.fn.startWave(7); ${PARK}
    // clearMutator() is what ends a mutator, and it fires from nextWaveCheck at the gap —
    // startWave never touches a live one. Driving startWave directly has to stand in for
    // it, or this would only prove that a mutator left set still owns the floor.
    p.state.mutator = null;
    p.fn.startWave(8); ${PARK}
    return true;`);
  const after7 = (await ctx.snapshot()).arena;
  ctx.check('arena: the next wave leaves the mutator floor behind', after7.sig === w[8].sig,
            `${after7.name}/${after7.count} vs plain wave 8 ${w[8].name}/${w[8].count}`);

  // ---- 4. determinism -------------------------------------------------------
  // The same wave, re-entered from a different one, is the same floor. This is the check
  // that fails the day somebody reaches for Math.random() in the layout.
  const again = {};
  for (const n of [2, 6, 11, 16, 22]) { await at(ctx, 13); again[n] = await at(ctx, n); }
  const drifted = Object.keys(again).filter(n => again[n].sig !== w[n].sig);
  ctx.check('arena: the same wave is always the same floor', drifted.length === 0,
            drifted.length ? `drifted: ${drifted.join(',')}` : 'waves 2,6,11,16,22 re-entered');

  // ---- 5. nothing rises through the player or a pickup ----------------------
  // Pickups persist across waves and spawnRandomPickup only avoids obstacles at spawn
  // time, so a box CAN want the ground a player or a pickup is already standing on. Park
  // the player on one of wave 9's footprints and a pickup on another, then let the whole
  // between-wave gap play out for real: sink, hold, staggered rise.
  //
  // 8 -> 9 is the transition to use, and the reason is worth writing down. The archetype
  // only changes on a 5-wave boundary and every one of those is a boss wave, whose live
  // boss would stop the wave clearing at all. Waves 8 and 9 share an archetype but sit on
  // perpendicular symmetries, so most of wave 9's boxes land on ground wave 8 leaves
  // empty — which is what makes it possible to stand on a wave-9 footprint at all.
  // Neither is a boss or a mutator wave, so nothing else moves underneath the check.
  const nine = await at(ctx, 9), eight = await at(ctx, 8);
  const parse = a => a.sig.split('|').map(b => b.split(',').map(Number));   // [x, z, hw, hd, h]
  const old = parse(eight);
  const free = parse(nine).filter(b => !old.some(o =>
    Math.abs(b[0] - o[0]) < b[2] + o[2] + 2 && Math.abs(b[1] - o[1]) < b[3] + o[3] + 2));
  ctx.check('arena: wave 9 raises boxes on ground wave 8 leaves empty', free.length >= 2,
            `${free.length} of ${nine.count} clear of wave 8`);
  const [b0, b1] = free;
  await ctx.eval(`const p = window.__probe;
    p.fn.startGame(); ${PARK}
    p.fn.startWave(8);
    ${PARK}
    p.state.toSpawn = 0;                       // same turn: the wave never spawns anything
    p.player.pos.x = ${b0[0]}; p.player.pos.z = ${b0[1]}; p.player.vel.set(0, 0, 0);
    // Item 89 — startWave drops a free health pickup on every even wave, at a random spot
    // it only clears against THIS wave's boxes. That one used to still be lying there, so
    // the blockers were the player, the planted pickup and a third one wherever the seed
    // put it — and whether the floor came up two boxes short or three was a coin flip the
    // check below lost on commits that had touched nothing. Walking the strays onto the
    // player's own square settles it either way: the pickup loop grabs them next frame,
    // and if the wave clears first they are standing on a footprint already blocked.
    p.live.pickups.forEach(q => q.group.position.set(p.player.pos.x, q.group.position.y, p.player.pos.z));
    p.fn.spawnPickup('health', ${b1[0]}, ${b1[1]});
    return true;`);
  // The gap opens with the upgrade screen, which halts update() — take a card, then let
  // the 2.5 s countdown and the reconfigure inside it run to wave 9.
  await ctx.waitFor('window.__probe.state.choosing === true', { timeout: 20_000, label: 'upgrade screen' });
  await ctx.eval('window.__probe.fn.pickUpgrade(0); return true;');
  await ctx.waitFor('window.__probe.state.wave === 9', { timeout: 30_000, label: 'wave 9' });
  // The planted pickup is found by position, not by index: startWave's own even-wave drop
  // is still in the list until the pickup loop grabs it, and `pickups[0]` would then be
  // that one rather than the one this leg is about.
  const gap = JSON.parse(await ctx.eval(`const p = window.__probe;
    const over = (x, z, pad) => p.obstacles.filter(o =>
      Math.abs(x - o.mesh.position.x) < o.hw + pad && Math.abs(z - o.mesh.position.z) < o.hd + pad).length;
    const planted = p.live.pickups.slice().sort((a, b) =>
      Math.hypot(a.group.position.x - ${b1[0]}, a.group.position.z - ${b1[1]}) -
      Math.hypot(b.group.position.x - ${b1[0]}, b.group.position.z - ${b1[1]}))[0];
    return JSON.stringify({
      onPlayer: over(p.player.pos.x, p.player.pos.z, 0),
      onPickup: planted ? over(planted.group.position.x, planted.group.position.z, 0) : -1,
      pickups: p.live.pickups.length,
      px: planted ? +planted.group.position.x.toFixed(1) : 0,
      pz: planted ? +planted.group.position.z.toFixed(1) : 0,
      name: p.arena.name, wave: p.arena.wave, count: p.obstacles.length,
      x: +p.player.pos.x.toFixed(1), z: +p.player.pos.z.toFixed(1) });`));
  ctx.check('arena: no pillar rises through the player', gap.onPlayer === 0,
            `player at ${gap.x},${gap.z} inside ${gap.onPlayer} of ${gap.count} boxes`);
  // Item 93 — that the pickup found IS the pickup planted, which this check used to claim
  // by printing both positions and comparing neither. `planted` is the pickup NEAREST the
  // footprint, so a plant that had been collected in the gap silently retargeted the whole
  // assertion at some stray metres away, standing on ground no box was ever going to want.
  // Same guard, and the same reason, as the player leg below it.
  const heldPickup = Math.hypot(gap.px - b1[0], gap.pz - b1[1]) < 1;
  ctx.check('arena: no pillar rises through a live pickup', heldPickup && gap.onPickup === 0,
            `planted at ${b1[0]},${b1[1]}, found at ${gap.px},${gap.pz} — ` +
            `${gap.pickups} pickup(s) live, ${gap.onPickup} buried`);
  // ...and the player stayed where they were parked. If the sinking wave-8 floor had
  // shoved them off the footprint first, the two checks above would be proving nothing.
  ctx.check('arena: the player held the ground the box wanted',
            Math.abs(gap.x - b0[0]) < 1 && Math.abs(gap.z - b0[1]) < 1,
            `parked at ${b0[0]},${b0[1]}, ended at ${gap.x},${gap.z}`);
  // ...and the gap still delivered the wave it was supposed to. A reconfigure that
  // protected the player by raising nothing at all would pass every check above.
  //
  // Item 89 — named box by named box, with no tolerance. This used to allow `count >= 10 - 2`,
  // which is a number that has to be re-guessed every time an archetype is retuned, says
  // nothing about WHICH boxes went missing, and passes just as happily when the guard drops
  // the wrong two. Wave 9's floor minus the live floor must be exactly the two footprints
  // this leg is standing on — so the same assertion now also proves the guard fired at all.
  const held = slots(nine).filter(b => {
    const f = b.split(',').map(Number);
    return (f[0] === b0[0] && f[1] === b0[1]) || (f[0] === b1[0] && f[1] === b1[1]);
  });
  const live = slots((await ctx.snapshot()).arena);
  const missing = slots(nine).filter(b => !live.includes(b));
  ctx.check('arena: the gap delivered wave 9 whole but for the two footprints held',
            gap.wave === 9 && gap.name === nine.name &&
            missing.length === held.length && missing.every(b => held.includes(b)),
            `${gap.name}/${gap.count} for wave ${gap.wave}, wanted ${nine.name}/${nine.count} ` +
            `less the boxes at ${b0[0]},${b0[1]} and ${b1[0]},${b1[1]}; missing [${missing.join(' ')}]`);

  // ---- 6. the budget the fixed pool exists to protect -----------------------
  const snap = await ctx.snapshot();
  ctx.check('arena: pillars carry no lights of their own', snap.census.pointLights <= 4,
            `${snap.census.pointLights} point lights on wave 9`);

  // ---- 7. a restart snaps back to the wave-1 floor --------------------------
  await at(ctx, 22);
  // Standing on SCATTER's centre block first, and that is the point of the leg rather
  // than decoration. resetGame's snap runs UNGUARDED — it must put the whole wave-1
  // floor back, not a floor with a hole where the dead run's player happened to stop —
  // and it gets away with that only because it parks the player at (0, EYE, 30) several
  // lines earlier. Reset from (0, 64), as the previous version of this check did, and
  // that ordering is not exercised at all: (0, 64) is clear of every SCATTER box, so
  // the check passes whether or not resetGame ever moved anybody. From (0, 0) it does
  // not: turn the guard on, or move the player park below the snap, and the centre
  // block goes missing from the signature.
  const spawn = JSON.parse(await ctx.eval(`const p = window.__probe;
    p.player.pos.x = 0; p.player.pos.z = 0;
    p.fn.resetGame();
    return JSON.stringify({ x: +p.player.pos.x.toFixed(1), z: +p.player.pos.z.toFixed(1) });`));
  const reset = (await ctx.snapshot()).arena;
  ctx.check('arena: resetGame snaps back to the whole wave-1 floor',
            reset.sig === WAVE1 && reset.wave === 1,
            `${reset.name}/${reset.count} for wave ${reset.wave}`);
  ctx.check('arena: resetGame parks the player before it lays the floor',
            spawn.x === 0 && spawn.z === 30, `player ended at ${spawn.x},${spawn.z}`);

  // Frames for the half no check can make: does each archetype read as its description?
  // 26 is in the list for item 84: it is the wave the rotation used to strip bare, and a
  // frame of it is the only proof that what it fights on now is a floor with cover on it.
  for (const n of [1, 5, 6, 11, 16, 22, 26]) { await at(ctx, n); await shot(ctx, `wave${n}`); }

  // ...and one of the reconfiguration itself, caught half-risen. Whether the floor
  // coming up reads as the arena rebuilding or as a rendering glitch is the single most
  // aesthetic thing this item ships, and no assertion can settle it — but a frame of it
  // can be looked at. Frozen from inside a rAF loop rather than by polling from Node: at
  // turbo 1 the whole rise is 1.2 s and a CDP round-trip per sample overshoots it.
  await ctx.eval(`const p = window.__probe;
    p.fn.startGame(); ${PARK}
    p.fn.startWave(8); ${PARK}
    p.player.pos.x = 0; p.player.pos.z = 62; p.player.vel.set(0, 0, 0);
    p.lookAt(0, 6, 0);
    p.state.toSpawn = 0;
    return true;`);
  await ctx.waitFor('window.__probe.state.choosing === true', { timeout: 20_000, label: 'gap for the frame' });
  await ctx.eval('window.__probe.fn.pickUpgrade(0); return true;');
  const caught = await ctx.eval(`const p = window.__probe;
    return new Promise(res => {
      let frames = 0;
      const tick = () => {
        const o = p.obstacles[0];
        if (o && o.mesh.visible && o.mesh.scale.y / o.h > 0.4) { p.fixedDt = 0; return res(true); }
        if (++frames > 900) return res(false);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });`, { awaitPromise: true, timeout: 40_000 });
  if (caught) { await shot(ctx, 'mid-rise', true); ctx.log('caught the floor half-risen'); }
  else ctx.log('did not catch a mid-rise frame — the aesthetic half stays with the human');
  ctx.log('frames: .playtest/arena-wave*.png, arena-mid-rise.png');
}
