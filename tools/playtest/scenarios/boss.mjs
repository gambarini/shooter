// The alternating boss waves (roadmap item 45). Everything in the item's "Done when"
// that a machine can settle: wave 10 is the ARTILLERY fight, wave 5 is still the melee
// one, the barrage telegraphs and then returns every decal to its pool, phase 2 really
// escalates, minis join the wave, and killing the boss takes its live shells with it.
//
// The soak run never gets near a boss wave — it clears four waves and dies — so none of
// this is covered by the leak diffs. It is driven from `startWave(N)` instead, with the
// regular spawn queue zeroed so the boss fights alone and every count below is about the
// boss and nothing else.
//
// The bot never runs here: it dodges, and a barrage nobody stands in proves nothing. The
// player is parked and topped up between polls instead, so the fight runs long enough to
// reach phase 2 — which is also what makes "the mortars hurt, and the recap names what
// fired them" assertable.
//
// It leaves the bot stopped and a boss wave half-fought, and that is fine: since item 73
// the harness hands every scenario a fresh page, so nothing downstream inherits this one's
// wreckage and its position in the list means nothing.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), '.playtest');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Half of this item is a silhouette, a colour and whether a ground telegraph reads as a
// warning — none of which a check can settle. Leave the frames behind for the human half,
// aimed at the boss so they are actually of the thing (`layout` does the same).
async function shot(ctx, name, atMark = false) {
  try {
    // Drop out of turbo first: at turbo 6 the ~120 ms between aiming and capturing is four
    // simulated seconds, and every telegraph this frame is meant to show has already
    // detonated by the time the shutter opens.
    await ctx.eval(`window.__probe.turbo = 1; return true;`);
    // ...and, for the telegraph frame, wait at that speed for a volley to actually be in
    // the air. Marks live 1.1 s; anything else photographs the crater instead.
    for (let i = 0; atMark && i < 200; i++) {
      if (await ctx.eval('return window.__probe.live.mortarMarks.length > 0;')) break;
      await sleep(100);
    }
    await ctx.eval(`const p = window.__probe;
      // The parked dummy is standing in a barrage no real player would stand in, so its
      // damage flash is up almost permanently and would white out the frame. Drop it: these
      // frames exist to judge the telegraph and the silhouette, not the hit feedback.
      document.getElementById('damageflash').style.opacity = 0;
      const mk = ${atMark} && p.live.mortarMarks[0];
      if (mk) {
        // A frame OF the telegraph: stand a dodge away from a live mark and look down at it.
        p.player.pos.x = mk.x + 17; p.player.pos.z = mk.z + 17;
        p.lookAt(mk.x, 0, mk.z);
        return true;
      }
      const b = p.enemies.find(e => e.type === 'boss');
      if (b) {
        // Stand off at a fixed distance and aim at the hull, so every frame this leaves
        // behind is the same portrait and two sessions' screenshots are comparable.
        const a = Math.atan2(p.player.pos.x - b.mesh.position.x, p.player.pos.z - b.mesh.position.z);
        p.player.pos.x = b.mesh.position.x + Math.sin(a) * 16;
        p.player.pos.z = b.mesh.position.z + Math.cos(a) * 16;
        p.lookAt(b.mesh.position.x, b.mesh.position.y, b.mesh.position.z);
      }
      return true;`);
    await sleep(120);
    mkdirSync(OUT, { recursive: true });
    const s = await ctx.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `boss-${name}.png`), Buffer.from(s.data, 'base64'));
  } catch { /* a screenshot is a courtesy, never a reason to fail a run */ }
  await ctx.eval(`window.__probe.turbo = ${ctx.cfg.turbo}; return true;`);
}

// One compact read of everything this scenario asserts on. Same rule as the rest of the
// rig: through `__probe`, never by fingerprinting the scene graph.
//
// It carries the live mark count but deliberately NOT the pool (item 91). The pool is half
// of a conservation law whose other half is the live count in the same JavaScript turn, and
// a pool field on a separate round-trip snapshot is exactly the shape that let the old
// pooling check compare a stale peak against a fresh read and assert nothing at all. The
// three legs that care read both sides together, in an eval of their own.
const STATUS = `const p = window.__probe;
  const b = p.enemies.find(e => e.type === 'boss');
  let lights = 0; p.scene.traverse(o => { if (o.isPointLight) lights++; });
  return JSON.stringify({
    wave: p.state.wave, running: p.state.running,
    boss: b ? { kind: b.bossKind || null, name: b.bossName || null, phase: b.phase,
                staggerT: +b.staggerT.toFixed(2), hp: Math.round(b.hp), maxHp: Math.round(b.maxHp),
                fireCD: +b.fireCD.toFixed(2),
                dist: +Math.hypot(b.mesh.position.x - p.player.pos.x,
                                  b.mesh.position.z - p.player.pos.z).toFixed(1) } : null,
    marks: p.live.mortarMarks.length,
    minis: p.enemies.filter(e => e.mini).length,
    siegeMinis: p.enemies.filter(e => e.mini && e.siege).length, enemies: p.enemies.length,
    shots: p.live.enemyShots.length, lights,
    dmgTaken: Math.round(p.state.stats.dmgTaken), lastHitBy: p.state.lastHitBy,
    card: document.querySelector('#bosscard .bc-name').textContent,
    enraged: document.getElementById('bossfill').classList.contains('enraged'),
    bossWrap: document.getElementById('bosswrap').style.display });`;

export default async function boss(ctx) {
  const status = () => ctx.eval(STATUS).then(JSON.parse);

  // Start a run, jump straight to wave N, and empty the wave's own spawn queue so the
  // only things alive are the boss and whatever the boss itself makes.
  //
  // The player becomes a target dummy: a huge hp pool rather than `invuln`, because every
  // check below needs the barrage to actually connect (dmgTaken, lastHitBy) — it only must
  // not END the run. At turbo 6 a 100 ms poll is ~3 s of simulated time, so topping a
  // 100 hp bar up between polls loses the race with a five-shell volley, and the fight
  // freezes on the death card halfway through the scenario.
  const enterWave = async (n, keepQueue = false) => {
    await ctx.eval(`const p = window.__probe;
      p.driven = true; p.turbo = ${ctx.cfg.turbo};
      p.fn.startGame(); p.fn.startWave(${n});
      if (!${keepQueue}) {
        p.state.toSpawn = 0;
        for (const e of [...p.enemies]) if (e.type !== 'boss') p.fn.damageEnemy(e, 1e9);
      }
      p.player.maxHp = 1e7; p.player.hp = 1e7;
      return true;`);
    return status();
  };
  const tickAlive = async () => {
    await ctx.eval(`const p = window.__probe; p.player.hp = p.player.maxHp; return true;`);
    return status();
  };

  // resetPage leaves the bot injected and stopped, so this is belt-and-braces — but it is
  // the one precondition this whole scenario is built on, so it says so out loud.
  await ctx.eval('if (window.__bot) window.__bot.stop(); return true;');

  // ------------------------------------------------------------------ wave 10: ARTILLERY
  let s = await enterWave(10);
  ctx.check('wave 10 spawns the ARTILLERY boss', s.boss && s.boss.kind === 'artillery',
            s.boss ? `${s.boss.kind} "${s.boss.name}", ${s.boss.hp} hp` : 'no boss');
  ctx.check('the intro card draws from the ARTILLERY name pool', s.boss && s.card === s.boss.name,
            `card "${s.card}" vs record "${s.boss && s.boss.name}"`);
  // The item-49 intro owns the first 2.2 s (slow-mo plus the title card). A shell landing
  // inside it would be unreadable and unfair, and no automated check can see that later —
  // so the opening reload is asserted at the one moment it is knowable.
  await shot(ctx, 'intro-card');   // the card is up for 2.2 real seconds, so grab it now
  ctx.check('the first barrage waits out the boss intro', s.marks === 0 && s.boss && s.boss.fireCD > 2.2,
            `${s.boss ? s.boss.fireCD : '?'}s before the opening volley, ${s.marks} marks`);

  // Telegraphs: the first volley must WAIT (the item-49 intro owns the first ~3 seconds),
  // then paint several ground decals at once.
  let peak1 = 0, cdMax1 = 0, sawMarks = false;
  for (let i = 0; i < 90 && !(sawMarks && s.boss && s.boss.phase === 1 && cdMax1 > 0); i++) {
    s = await tickAlive();
    peak1 = Math.max(peak1, s.marks); cdMax1 = Math.max(cdMax1, s.boss ? s.boss.fireCD : 0);
    if (s.marks > 0) sawMarks = true;
    if (sawMarks && i > 40) break;
    await sleep(100);
  }
  ctx.check('the barrage telegraphs before it lands (3+ ground marks in one volley)', peak1 >= 3,
            `peak ${peak1} marks, standoff ${s.boss ? s.boss.dist : '?'} units`);
  if (s.marks > 0) { await shot(ctx, 'phase1-barrage'); await shot(ctx, 'telegraph', true); }

  // ------------------------------------------------------------------ the pool, stated as a law
  // `mortarMarks` and `mortarMarkPool` only ever exchange members: a spawn pops a group off
  // the pool or mints one when the pool is empty, and every release pushes one back. So
  // `live + pooled` can never FALL, and across a window with no spawns in it the pool must
  // grow by exactly the marks that burned down. It is NOT invariant, whatever is convenient
  // to say — a volley wider than the pool mints the difference and the total steps up. Only
  // the non-decrease holds unconditionally, and the equality below buys its exactness by
  // making the window quiet rather than by assuming it.
  //
  // What this replaces (item 91) asserted `markPool >= peak1 - s.marks`. The poll loop above
  // breaks as soon as it has seen a volley, so `s.marks` is still `peak1` and the whole thing
  // reduces to `0 >= 0`: a pool that had never received a single decal passed it. One did,
  // reading `3 live, 0 in the pool`, on every run of item 90's session.
  //
  // Parking the reload is what makes the window quiet. `spawnMortarMark` has exactly one
  // caller — the `type === 'boss' && bossKind === 'artillery'` branch of `update` — and siege
  // minis are `type: 'chaser'`, so a boss that cannot reload cannot put anything new in the
  // air, and the only traffic left is the volley we measured draining into the pool.
  // Sampling and parking in ONE eval is item 90's rule, for item 90's reason: at turbo 6 the
  // 1.1 s fuse is ~180 ms of wall clock, and a second round trip is long enough for the
  // volley to expire and the next one to launch out of the pool we are about to count.
  let vol = null;
  for (let i = 0; i < 200 && !vol; i++) {
    vol = JSON.parse(await ctx.eval(`const p = window.__probe;
      const b = p.enemies.find(e => e.type === 'boss');
      const live = p.live.mortarMarks.length;
      if (!b || !live) return JSON.stringify({ live, boss: !!b });
      b.fireCD = 1e3;                        // no new shells until this volley is counted
      return JSON.stringify({ live, boss: true, pooled: p.pools.mortarMarkPool.length });`));
    if (vol.boss && vol.live > 0) break;     // caught a volley with the reload parked
    if (!vol.boss) break;                    // nothing firing; the check below says so
    vol = null;
    await tickAlive();                       // keep the dummy alive so the boss keeps firing
    await sleep(30);
  }
  if (vol && vol.boss && vol.live > 0) {
    // Bounded by hand rather than with `waitFor`, which throws on timeout: a barrage that
    // never drains has to land as a red check with its numbers in the detail, not as an
    // exception that takes the remaining twenty checks of this scenario down with it.
    for (let i = 0; i < 200; i++) {
      if (await ctx.eval('return window.__probe.live.mortarMarks.length === 0;')) break;
      await tickAlive();
      await sleep(50);
    }
    // The reload goes back on EVERY exit from the window, drained or not. A `1e3` leaking
    // past here would surface as `phase 2 escalates: volleys come faster` going red, three
    // checks downstream of anything that is actually wrong.
    Object.assign(vol, JSON.parse(await ctx.eval(`const p = window.__probe;
      const b = p.enemies.find(e => e.type === 'boss');
      const after = p.live.mortarMarks.length, poolAfter = p.pools.mortarMarkPool.length;
      if (b) b.fireCD = 0.05;
      return JSON.stringify({ after, poolAfter });`)));
  }
  ctx.check('a spent volley returns every mark to the pool',
            !!vol && vol.boss && vol.after === 0 && vol.poolAfter === vol.pooled + vol.live,
            !vol ? 'no live barrage was ever caught to measure the pool over'
                 : !vol.boss ? 'no artillery boss was alive to fire a volley'
                 : `live ${vol.live} → ${vol.after}, pool ${vol.pooled} → ${vol.poolAfter}`);

  // The shells hit, and the recap says what hit you. `lastHitBy` is exactly the string
  // the death card prints, so this is the killed-by check.
  await ctx.waitFor(`/BARRAGE/.test(window.__probe.state.lastHitBy || '')`,
                    { timeout: 30_000, poll: 150, label: 'a mortar to land on the player',
                      onPoll: () => ctx.eval(`window.__probe.player.hp = window.__probe.player.maxHp; return true;`) });
  s = await status();
  ctx.check('a mortar impact damages the player and names the ARTILLERY that fired it',
            s.dmgTaken > 0 && /BARRAGE/.test(s.lastHitBy || ''), `FLATLINED BY: ${s.lastHitBy}`);

  // Minis: the 12 s timer, which turbo makes reachable inside a scenario.
  await ctx.waitFor(`window.__probe.enemies.some(e => e.mini)`,
                    { timeout: 60_000, poll: 200, label: 'the artillery to spawn minis',
                      onPoll: () => ctx.eval(`window.__probe.player.hp = window.__probe.player.maxHp; return true;`) });
  s = await status();
  ctx.check('the artillery spawns minis, and they count toward the wave',
            s.minis >= 2 && s.enemies === s.minis + 1, `${s.minis} minis, ${s.enemies} enemies alive`);
  // Item 72: every mini the ARTILLERY deploys wears its own identity, not the splitter's.
  // The flag drives the hue, the hull, the minimap dot and the death burst; whether that
  // actually reads at a glance is the screenshot's job, not this check's.
  ctx.check('the artillery deploys ITS minis, not the splitter\'s',
            s.minis > 0 && s.siegeMinis === s.minis, `${s.siegeMinis}/${s.minis} siege-marked`);
  await shot(ctx, 'artillery-minis');

  // ------------------------------------------------------------------ phase 2
  // bossEnrage fires from inside damageEnemy, so drive it through the real damage path.
  await ctx.eval(`const p = window.__probe;
    const b = p.enemies.find(e => e.type === 'boss');
    p.fn.damageEnemy(b, b.hp - b.maxHp * 0.45);   // one hit past the 50% threshold
    return true;`);
  s = await status();
  ctx.check('phase 2 opens with the stagger telegraph', s.boss && s.boss.phase === 2 && s.boss.staggerT > 0,
            `phase ${s.boss && s.boss.phase}, stagger ${s.boss && s.boss.staggerT}s`);
  await ctx.waitFor(`(window.__probe.enemies.find(e => e.type === 'boss') || {}).staggerT <= 0`,
                    { timeout: 20_000, poll: 100, label: 'the stagger to end' });

  let peak2 = 0, cdMax2 = 0;
  for (let i = 0; i < 60; i++) {
    s = await tickAlive();
    peak2 = Math.max(peak2, s.marks); cdMax2 = Math.max(cdMax2, s.boss ? s.boss.fireCD : 0);
    await sleep(100);
  }
  ctx.check('phase 2 escalates: volleys come faster', cdMax2 > 0 && cdMax2 < cdMax1,
            `reload ${cdMax1}s → ${cdMax2}s`);
  ctx.check('phase 2 escalates: volleys get wider', peak2 >= peak1,
            `${peak1} marks per volley → ${peak2}`);
  if (peak2 > 0) await shot(ctx, 'phase2-barrage');
  ctx.check('the boss bar tracks the fight and flips to enraged',
            s.bossWrap === 'block' && s.enraged, `bar=${s.bossWrap}, enraged=${s.enraged}`);
  ctx.check('the artillery fight stays inside the point-light budget',
            s.lights <= ctx.cfg.pointLightCap, `${s.lights} lights (cap ${ctx.cfg.pointLightCap})`);

  // ------------------------------------------------------------------ the boss owns its shells
  // Kill it mid-barrage. Left behind, those fuses freeze under the upgrade screen and
  // detonate on the player in the NEXT wave, fired by a boss that no longer exists.
  //
  // Sample and kill in ONE eval, retried until it catches a volley (item 90). Read the
  // count in a separate round trip and this leg is racing the fuse rather than testing
  // the game: at turbo 6 the 1.1 s telegraph is only ~180 ms of wall clock, so a poll can
  // legitimately see a volley with 4 ms of fuse left — measured, on the run that named
  // this flake — and the next round trip costs more than that. Then `before` reads 0, and
  // the check goes red on a commit that changed nothing.
  //
  // Doing both in one JavaScript turn also asserts something STRONGER than the version it
  // replaces. `killEnemy` calls `clearMortarMarks` synchronously, so the barrage must be
  // gone in the same turn as the kill; the old shape passed just as happily when the
  // fuses had simply burned out on their own in the gap.
  let kill = null;
  for (let i = 0; i < 200 && !kill; i++) {
    kill = JSON.parse(await ctx.eval(`const p = window.__probe;
      const b = p.enemies.find(e => e.type === 'boss');
      const before = p.live.mortarMarks.length, poolBefore = p.pools.mortarMarkPool.length;
      if (!b || !before) return JSON.stringify({ before, boss: !!b });
      p.fn.damageEnemy(b, 1e9);
      return JSON.stringify({ before, poolBefore, boss: true, after: p.live.mortarMarks.length,
                              pooled: p.pools.mortarMarkPool.length });`));
    if (kill.boss && kill.before > 0) break;      // killed under a live barrage — assert on it
    if (!kill.boss) break;                        // nothing left to kill; the check below says so
    kill = null;
    await tickAlive();                            // keep the dummy alive so the boss keeps firing
    await sleep(30);
  }
  // Never catching a volley is a failure, not a pass — the same rule `chaos` follows for
  // a hostile moment it never reached.
  //
  // It also asserts the pool, not just the emptying (item 91). `after === 0` alone passes a
  // bare `mortarMarks.length = 0`, which clears the array and drops every group on the
  // floor; only the restart twin downstream would have caught that. `clearMortarMarks` runs
  // synchronously inside `killEnemy`, so within this one JavaScript turn every mark that was
  // in the air must have moved into the pool and nothing else can have touched either side —
  // the same conservation law the phase-1 leg states, and exact for the same reason. The
  // pooled count was already being printed here; it was simply never checked.
  //
  // Three detail strings, not two: `boss: false` means the retry loop found marks in the air
  // but no boss to kill, which is a different failure from never catching a volley, and the
  // string they used to share sent the next reader looking for the wrong one.
  ctx.check('killing the boss takes its live barrage with it',
            !!kill && kill.boss && kill.before > 0 && kill.after === 0
              && kill.pooled === kill.poolBefore + kill.before,
            !kill ? 'no live barrage was ever caught to kill the boss under'
                  : !kill.boss ? `no boss left to kill, with ${kill.before} marks in the air`
                  : `${kill.before} marks in the air → ${kill.after}, pool ${kill.poolBefore} → ${kill.pooled}`);
  s = await status();
  ctx.check('the boss bar clears when the boss dies', !s.boss, s.bossWrap);

  // ------------------------------------------------------------------ restart is clean
  //
  // Same atomic shape, and the same race: read the pool in its own round trip and a volley
  // that expires in the gap is freed into the pool BEFORE the baseline is taken, so a
  // perfectly intact reset grows nothing and the check reads it as a leak. Restarting in
  // the same turn as the read also lets the assertion be exact — every live mark returned,
  // none dropped and none pushed twice — where `>` only said the pool moved.
  let rst = null;
  for (let i = 0; i < 300 && !rst; i++) {
    rst = JSON.parse(await ctx.eval(`const p = window.__probe;
      const live = p.live.mortarMarks.length, pool = p.pools.mortarMarkPool.length;
      if (!live) return JSON.stringify({ live });
      p.fn.resetGame();
      return JSON.stringify({ live, pool, after: p.live.mortarMarks.length,
                              poolAfter: p.pools.mortarMarkPool.length });`));
    if (rst.live > 0) break;
    rst = null;
    const t = await tickAlive();               // the boss this leg needs was just killed
    if (!t.boss || !t.running) await enterWave(10);
    await sleep(30);
  }
  ctx.check('a restart mid-barrage returns every mark to the pool',
            !!rst && rst.after === 0 && rst.poolAfter === rst.pool + rst.live,
            rst ? `live ${rst.live} → ${rst.after}, pool ${rst.pool} → ${rst.poolAfter}`
                : 'no live barrage was ever caught to restart under');

  // ------------------------------------------------------------------ wave 5 unchanged
  s = await enterWave(5);
  ctx.check('wave 5 still spawns the melee boss', s.boss && s.boss.kind === 'melee',
            s.boss ? `${s.boss.kind} "${s.boss.name}"` : 'no boss');
  await shot(ctx, 'melee-wave5');
  ctx.check('the melee boss keeps its own name pool', s.boss && s.card === s.boss.name,
            `card "${s.card}"`);
  let meleeMarks = 0, meleeShots = 0;
  for (let i = 0; i < 60; i++) {
    s = await tickAlive();
    meleeMarks = Math.max(meleeMarks, s.marks); meleeShots = Math.max(meleeShots, s.shots);
    await sleep(100);
  }
  // The negative is the point: the melee fight must not have grown a barrage, and it must
  // still be firing the volleys it always fired.
  ctx.check('the melee boss fires no mortars at all', meleeMarks === 0, `${meleeMarks} marks seen`);
  ctx.check('the melee boss still fires its volleys', meleeShots > 0, `${meleeShots} shots in the air`);

  // Item 72: the melee boss names itself too. Nothing else in this leg can hurt the dummy
  // (the wave's own queue was zeroed), so whatever `lastHitBy` holds came from the boss —
  // and it has to start with the name the title card just drew, whichever of its two
  // attacks landed first: the contact hit is the bare name, the volley is `NAME VOLLEY`.
  // Asserted against the record, never a literal — the pool is drawn at random.
  const meleeName = s.boss && s.boss.name;
  await ctx.waitFor(`(window.__probe.state.lastHitBy || '').length > 0`,
                    { timeout: 30_000, poll: 150, label: 'the melee boss to land a hit',
                      onPoll: () => ctx.eval(`window.__probe.player.hp = window.__probe.player.maxHp; return true;`) });
  s = await status();
  ctx.check('the melee boss names itself in the recap, matching its card',
            !!meleeName && (s.lastHitBy || '').startsWith(meleeName),
            `FLATLINED BY: ${s.lastHitBy} (card "${meleeName}")`);

  // ------------------------------------------------------------------ a crowded wave 10
  // The isolation every check above depends on is also the thing that could hide a broken
  // mini cap: a real wave 10 queues 21 regular spawns beside the boss, so a cap counting
  // the whole arena would skip nearly every deployment and this leg would be the only
  // place it showed. Run one wave 10 with its queue intact and make the minis prove they
  // still arrive in a crowd.
  await enterWave(10, true);
  let crowd = 0;
  await ctx.waitFor(`window.__probe.enemies.some(e => e.mini)`,
                    { timeout: 90_000, poll: 200, label: 'minis to deploy into a full wave 10',
                      onPoll: async () => { const t = await tickAlive(); crowd = Math.max(crowd, t.enemies); } });
  s = await status();
  ctx.check('minis still deploy on a real wave 10, with its own spawns in the arena',
            s.minis >= 2 && crowd > 6, `${s.minis} minis with ${s.enemies} enemies alive (peak ${crowd})`);
}
