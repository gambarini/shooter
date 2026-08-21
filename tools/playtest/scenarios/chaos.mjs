// Restarting, dying and pausing at HOSTILE moments (roadmap item 64).
//
// `soak` plays tidily: it clears waves and dies in the open, which is the one thing the
// scars in `resetGame` say never causes a bug. Read that function's comments — item 45's
// mid-barrage decals, item 47's OVERDRIVE banner, item 49's boss card and FOV punch, item
// 50's gibs, item 56's damage flash, item 57's stale wave readout. Every one of them is a
// restart taken *during* an animation, and none of them is reachable by playing politely.
//
// So this scenario walks a list of hostile moments and, at each one, runs the three verbs
// a player has: PAUSE (freeze mid-animation and come back), DIE (gameOver has its own
// teardown, separate from resetGame's), and RESTART (the leak gate itself). The
// assertions are item 58's, unchanged — the same t = 0 reset diff and the same pool
// conservation law. The value here is *when* the restart happens, not a new probe.
//
// Two rules the moments obey:
//
// - **Each moment is reached deterministically**, never waited for. `startWave(5)` for the
//   boss, `startWave(7)` for a mutator, `showUpgrades()` for the cards — not "play until
//   the seed produces one". A seed-dependent hostile moment is a flaky check, and a flaky
//   check in the CI gate (item 66) is a disabled gate.
// - **A moment that was never observed fails the run.** A scenario that silently never
//   triggers is worse than no scenario: it reports green for work it did not do. Every
//   moment records whether its condition was actually true when it claimed to be there.
//
// The restart snapshot keeps item 58's convention exactly: the button click and the
// SNAPSHOT happen in the SAME JavaScript turn, so both sides of every diff are exactly
// "t = 0 of a run" and a difference is a leak rather than timing noise. `.click()` is
// deliberate and must stay — a restart taken mid-`choosing` leaves the upgrade overlay
// above the death card, and this is the one place in the rig where bypassing hit-testing
// is the correct thing to do (`layout` needs the opposite; don't unify them).

import { SNAPSHOT, conservationViolations, resetDiff, gpuAccounted } from '../probes.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Reproducible from the run's --seed, like everything else here: the monkey pass below
// must be replayable or a failure it finds is an anecdote. Same generator the harness
// installs over the page's Math.random.
const rng = seed => { let s = seed >>> 0; return () => {
  s = s + 0x6D2B79F5 | 0;
  let t = Math.imul(s ^ s >>> 15, 1 | s);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };

// Keys the monkey may press. Escape and KeyP are deliberately absent: `probe.driven`
// stands down the game's AUTOMATIC pauses (blur, visibility, lost pointer lock) but not
// the explicit ones, so a single stray press parks an unattended run on the pause card
// and every later wait times out. Pausing IS tested — as its own verb, at each moment,
// where the resume is guaranteed. Note that Escape and KeyP would now LAND: since item 78
// `probe.setKey` dispatches the real event, so this list is the only thing keeping them out.
const MONKEY_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft',
                     'KeyR', 'KeyQ', 'KeyE', 'Digit1', 'Digit2', 'Digit3'];

// One press, one `setKey` — it is a real KeyboardEvent since item 78, so the monkey is a
// test of the keydown handlers and not a bypass of them. This file used to carry its own
// press()/release() dispatch pair, because setKey wrote the `keys` map directly and could
// never reach Q (dash) or E (nova), whose intent flags are set in the handler.
const press = code => `window.__probe.setKey('${code}', true);`;
const release = code => `window.__probe.setKey('${code}', false);`;

// Give the parked player a target-dummy hp pool. Same reason boss.mjs does it and does not
// use `invuln`: several moments here are boss waves, the barrage must be allowed to
// connect, and a 100 hp bar loses the race with a volley between two polls. Every moment
// ends in a deliberate death anyway, and `resetGame` puts maxHp back to 100 — which the
// very next diff would report by name if it ever stopped doing so.
const ARM = `const p = window.__probe;
  p.driven = true; p.player.maxHp = 1e7; p.player.hp = 1e7; return true;`;

// Clear the arena to whatever the moment needs and nothing else, as boss.mjs does: kill
// what is alive and stop the ordinary queue feeding enemies into a fight the moment is not
// about. But leave ONE enemy permanently pending rather than zeroing the queue, because
// `nextWaveCheck` fires on `toSpawn === 0 && enemies.length === 0` and an emptied wave
// clears on the very next frame — which runs `clearMutator()` and `showUpgrades()`.
//
// That is a one-frame race, and it is the difference between a moment and a mirage. It won
// on a laptop and lost on a CI runner, where "during a mutator wave" reported
// `mutator === null` and failed the run. Two of the moments here depend on it: the mutator
// wave clears itself the instant it is jumped to, and the boss-kill slow-mo clears the wave
// the instant the boss dies. `ab` learned the same lesson from the same function — if a
// scenario needs a wave to STAY on screen, this is the idiom.
const jumpTo = wave => `const p = window.__probe;
  p.turbo = 1;
  p.enemies.slice().forEach(e => p.fn.damageEnemy(e, 1e9, null, false, null, 0, 'HARNESS'));
  p.state.toSpawn = 0;
  p.fn.startWave(${wave});
  p.state.toSpawn = 1; p.state.spawnTimer = 1e9;   // pending forever: spawns nothing, clears never
  p.state.betweenWaves = 0;
  return true;`;

const MOMENTS = [
  {
    name: 'mid-explosion',
    what: 'gibs and a shock ring still in the air',
    cond: 'window.__probe.live.gibs.length > 0 && window.__probe.live.shockRings.length > 0',
    async reach(ctx) {
      await ctx.eval(`window.__probe.turbo = ${ctx.cfg.turbo}; return true;`);
      await ctx.waitFor('window.__probe.live.enemies.length > 0',
                        { label: 'an enemy to blow up', timeout: 60_000, poll: 100 });
      // Turbo down FIRST: gib life is simulated time, so at turbo 6 the debris this
      // moment is made of ages six times faster than the harness can round-trip to it.
      await ctx.eval(`const p = window.__probe; p.turbo = 1;
        const e = p.live.enemies[0];
        p.fn.damageEnemy(e, 1e9, e.mesh.position.clone(), false, null, 0, 'HARNESS');
        return true;`);
    },
  },
  {
    name: 'during the boss intro card',
    what: 'bossIntroT > 0 — the card is up and the camera is mid-FOV-punch',
    cond: 'window.__probe.bossIntroT > 0',
    async reach(ctx) {
      await ctx.eval(jumpTo(5));
      await ctx.waitFor('window.__probe.bossIntroT > 0',
                        { label: 'the boss intro', timeout: 20_000, poll: 50 });
    },
  },
  {
    name: 'while the upgrade cards are open',
    what: 'state.choosing — the sim is gated off behind an overlay',
    cond: 'window.__probe.state.choosing === true',
    reach: ctx => ctx.eval('const p = window.__probe; p.turbo = 1; p.fn.showUpgrades(); return true;'),
  },
  {
    name: 'mid-reload',
    what: 'the reload timer and its UI are both in flight',
    cond: 'window.__probe.reloading === true',
    async reach(ctx) {
      // The shotgun, because it has a finite reserve: a reload that draws from `reserve`
      // is the one that can leave the ammo counter and the magazine disagreeing.
      await ctx.eval(`const p = window.__probe; p.turbo = 1;
        p.fn.selectWeapon(1); p.weapons[1].mag = 1; p.fn.reload(); return true;`);
      await ctx.waitFor('window.__probe.reloading === true',
                        { label: 'a reload in progress', timeout: 10_000, poll: 50 });
    },
  },
  {
    name: 'mid-dash',
    what: 'an AFTERBURN trail of pooled segments behind the player',
    cond: 'window.__probe.live.trailSegs.length > 0',
    async reach(ctx) {
      // AFTERBURN on, because a plain dash leaves nothing behind to leak. With it the dash
      // drops pooled trail segments — the objects `resetGame` frees at its `trailSegs`
      // line, and the only reason this moment is worth a restart at all.
      await ctx.eval(`const p = window.__probe; p.turbo = 1;
        p.mods.dashDamage = true;
        p.setKey('KeyW', true);
        ${press('KeyQ')}
        return true;`);
      await ctx.waitFor('window.__probe.live.trailSegs.length > 0',
                        { label: 'a dash trail', timeout: 10_000, poll: 50 });
      await ctx.eval(`window.__probe.setKey('KeyW', false); ${release('KeyQ')} return true;`);
    },
  },
  {
    name: 'during a mutator wave',
    what: 'state.mutator is applied — spawn counts, damage and ammo rules are all rewritten',
    cond: 'window.__probe.state.mutator !== null',
    reach: ctx => ctx.eval(jumpTo(7)),
  },
  {
    name: 'inside the boss-kill slow-mo',
    what: 'state.slowmo > 0 with the boss just detonated',
    cond: 'window.__probe.state.slowmo > 0',
    async reach(ctx) {
      await ctx.eval(jumpTo(5));
      await ctx.waitFor('window.__probe.enemies.some(e => e.type === "boss")',
                        { label: 'the boss to materialise', timeout: 20_000, poll: 50 });
      // Wait the INTRO's slow-mo out first, or this moment would be the intro's again
      // under a different name and the kill path would go untested.
      await ctx.waitFor('window.__probe.bossIntroT <= 0 && window.__probe.state.slowmo <= 0',
                        { label: 'the intro to finish', timeout: 30_000, poll: 100 });
      await ctx.eval(`const p = window.__probe;
        const b = p.enemies.find(e => e.type === 'boss');
        p.fn.damageEnemy(b, 1e9, null, false, null, 0, 'HARNESS'); return true;`);
    },
  },
];

// Die and restart in ONE turn each, with the hostile condition read immediately before the
// call that matters. `damagePlayer` runs `gameOver()` synchronously, so "did dying here
// work" is answered without a round trip that the moment could expire across.
const DIE = cond => `const p = window.__probe;
  const hostile = !!(${cond});
  p.player.invuln = 0; p.fn.damagePlayer(1e9, null, 'THE HARNESS');
  return { hostile, running: p.state.running, choosing: p.state.choosing,
           over: !document.getElementById('overCard').classList.contains('hidden') };`;

const RESTART = (cond, btn) => `
  const hostile = !!(${cond});
  document.getElementById('${btn}').click();
  return { hostile, snap: (() => { ${SNAPSHOT} })() };`;

export default async function chaos(ctx) {
  const { cfg } = ctx;
  const violations = [];
  const observed = [];
  const missed = [];
  let prev = null;

  const sample = async () => {
    const s = await ctx.snapshot();
    if (prev) violations.push(...conservationViolations(prev, s));
    return s;
  };

  // The pristine t = 0 every later restart is compared against. Same shape as soak's
  // snapA, and taken the same way.
  const first = await ctx.eval(`document.getElementById('startBtn').click(); ${SNAPSHOT}`);
  ctx.check('chaos: run 1 starts from the ENTER ARENA button',
            first.state.running === true && first.state.wave === 1, `wave=${first.state.wave}`);
  prev = first;
  let beforeLast = first;

  for (const m of MOMENTS) {
    await ctx.eval(ARM);
    await m.reach(ctx);

    // Reach-time observation. Read here rather than at the restart because `gameOver()`
    // clears some of these itself (state.choosing, state.mutator, the boss card) — asking
    // at the restart would report "never observed" for the moments whose teardown is
    // precisely what is under test.
    const here = await ctx.eval(`return !!(${m.cond});`);
    (here ? observed : missed).push(m.name);
    ctx.check(`${m.name}: reached — ${m.what}`, here);
    if (!here) continue;

    // --- verb 1: PAUSE, mid-animation, and come back --------------------
    await ctx.eval('window.__probe.fn.togglePause(); return true;');
    const paused = await ctx.eval(`const p = window.__probe;
      return { paused: p.state.paused, running: p.state.running,
               card: !document.getElementById('pauseCard').classList.contains('hidden') };`);
    ctx.check(`${m.name}: pause freezes the run instead of ending it`,
              paused.paused && paused.running && paused.card,
              `paused=${paused.paused} running=${paused.running} card=${paused.card}`);
    await sleep(150);   // sit on the pause card long enough for a frozen animation to rot
    await ctx.eval('window.__probe.fn.togglePause(); return true;');
    const resumed = await ctx.eval(`const p = window.__probe;
      return { paused: p.state.paused, running: p.state.running,
               card: !document.getElementById('pauseCard').classList.contains('hidden') };`);
    ctx.check(`${m.name}: resume gives the run back`,
              !resumed.paused && resumed.running && !resumed.card,
              `paused=${resumed.paused} running=${resumed.running} card=${resumed.card}`);

    // --- verb 2: DIE, here, now -----------------------------------------
    const died = await ctx.eval(DIE(m.cond));
    ctx.check(`${m.name}: dying here reaches the death card`,
              died.running === false && died.over && died.choosing === false,
              `running=${died.running} overCard=${died.over} choosing=${died.choosing}`);

    // --- verb 3: RESTART, same turn as the snapshot ----------------------
    const r = await ctx.eval(RESTART(m.cond, 'againBtn'));
    const diffs = resetDiff(prev, r.snap);
    ctx.check(`${m.name}: the restart after it leaks no state`, diffs.length === 0,
              diffs.length ? `${diffs.length} field(s) differ`
                           : `still hostile at the restart: ${r.hostile}`);
    for (const d of diffs.slice(0, 10)) ctx.log(`${d.key}: before=${JSON.stringify(d.first)}  after=${JSON.stringify(d.second)}`);
    violations.push(...conservationViolations(prev, r.snap));
    beforeLast = prev;
    prev = r.snap;
  }

  ctx.check('every hostile moment was actually observed', missed.length === 0,
            missed.length ? `never reached: ${missed.join(', ')}` : `${observed.length}/${MOMENTS.length} hit`);

  // --- the monkey pass, twice -------------------------------------------
  // Nothing here asserts a behaviour; it asserts that nothing THREW and no invariant
  // broke while the handlers were being hammered in combinations no scripted scenario
  // would produce. Page errors are collected by the harness itself, so an exception
  // during this fails the run without a check of its own.
  //
  // TWICE, for the same reason soak's GPU comparison is its second restart and not its
  // first: the first pass is the first thing in this scenario to play long enough to
  // reach pickups, novas and a full spawn cycle, so it MINTS the geometry those paths
  // own. Measuring across it reads that warm-up as a leak. Pass 2 does the identical work
  // on warm pools, so anything that grows across it grew per-kill — which is what a leak
  // looks like and what this leg is for.
  const rand = rng(cfg.seed * 7919 + 13);
  const MONKEY_TICKS = 40;
  let novaFired = 0;
  const monkeyPass = async () => {
  await ctx.eval(ARM);
  await ctx.eval(`window.__probe.turbo = ${cfg.turbo}; return true;`);
  for (let i = 0; i < MONKEY_TICKS; i++) {
    const held = [];
    for (let k = 0; k < 1 + Math.floor(rand() * 3); k++) held.push(MONKEY_KEYS[Math.floor(rand() * MONKEY_KEYS.length)]);
    // Charge the ultimate now and then so KeyE actually does something — an E that
    // no-ops on an empty meter tests the handler and not the ability.
    const charge = rand() < 0.2;
    if (charge) novaFired++;
    // Aim, too. A monkey that only presses keys stares at a wall: it fires, hits nothing,
    // and the damage/kill/pickup half of the code it is supposed to be hammering never
    // runs. Mostly at whatever is nearest (so shots connect), sometimes at nothing.
    const aim = rand() < 0.75;
    const yaw = rand() * 6.28, pitch = rand() * 0.6 - 0.3;
    await ctx.eval(`const p = window.__probe;
      ${charge ? 'p.state.ult = 100;' : ''}
      const e = ${aim} && p.live.enemies[0];
      if (e && e.mesh) p.lookAt(e.mesh.position.x, e.mesh.position.y, e.mesh.position.z);
      else { p.player.yaw = ${yaw.toFixed(4)}; p.player.pitch = ${pitch.toFixed(4)}; }
      p.setFire(${rand() < 0.75});
      ${held.map(press).join('\n      ')}
      return true;`);
    await sleep(40);
    await ctx.eval(`${held.map(release).join('\n      ')} return true;`);
  }
  await ctx.eval('const p = window.__probe; p.setFire(false); p.turbo = 1; return true;');
  return sample();
  };

  const after1 = await monkeyPass();
  ctx.check('the monkey pass left the run alive and unpaused',
            after1.state.running === true && after1.state.paused === false && after1.state.choosing === false,
            `wave ${after1.state.wave}, ${after1.state.stats.kills} kills, ` +
            `${MONKEY_TICKS} bursts of random input, ${novaFired} with a charged ultimate`);
  const mid = await ctx.eval(RESTART('true', 'againBtn'));
  violations.push(...conservationViolations(prev, mid.snap));

  const after2 = await monkeyPass();
  ctx.check('a second monkey pass on the same page is still alive and unpaused',
            after2.state.running === true && after2.state.paused === false && after2.state.choosing === false,
            `wave ${after2.state.wave}, ${after2.state.stats.kills} kills`);

  // The GPU-leak leg, across pass 2 only — pass 1's restart is the warm-pool baseline.
  const last = await ctx.eval(RESTART('true', 'againBtn'));
  const gpu = gpuAccounted(mid.snap, last.snap);
  ctx.check('the restart after the monkey pass leaks no GPU resources', gpu.over.length === 0,
            gpu.over.length ? gpu.over.join('; ')
                            : `geometries ${last.snap.gpu.geometries}, textures ${last.snap.gpu.textures}, ` +
                              `${gpu.allowance} new pooled object(s) across the second pass`);
  ctx.log(`monkey pass 1 minted ${mid.snap.gpu.geometries - prev.gpu.geometries} geometr(ies) / ` +
          `${mid.snap.gpu.textures - prev.gpu.textures} texture(s) warming up; ` +
          `pass 2 added ${last.snap.gpu.geometries - mid.snap.gpu.geometries} / ` +
          `${last.snap.gpu.textures - mid.snap.gpu.textures}`);
  const lastDiffs = resetDiff(mid.snap, last.snap);
  ctx.check('the restart after the monkey pass leaks no state', lastDiffs.length === 0,
            lastDiffs.length ? `${lastDiffs.length} field(s) differ` : '');
  for (const d of lastDiffs.slice(0, 10)) ctx.log(`${d.key}: before=${JSON.stringify(d.first)}  after=${JSON.stringify(d.second)}`);
  violations.push(...conservationViolations(mid.snap, last.snap));

  ctx.check('pool conservation held across every hostile restart', violations.length === 0,
            violations.length ? violations.slice(0, 4).join('; ')
                              : `no pooled object was dropped across ${MOMENTS.length + 3} restarts`);

  await ctx.eval('window.__probe.setFire(false); return true;');
  ctx.chaos = { observed, missed, violations, gpu,
                diffsAgainstPristine: resetDiff(first, last.snap).length,
                beforeLastWave: beforeLast.state.wave };
}
