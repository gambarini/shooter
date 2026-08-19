// The minimum verification CLAUDE.md asks of every roadmap item, unattended: start a
// run, clear several waves, die, restart, clear another — while watching the
// invariants a human staring at the screen cannot see.
//
// It restarts TWICE, and the two restarts do different jobs:
//   run 1 -> run 2   catches per-run state a resetGame() forgot to clear.
//   run 2 -> run 3   catches leaked GPU resources. It has to be this leg: by then the
//                    object pools are warm, so "geometries grew" can no longer be
//                    explained away by a pool minting new objects.
//
// Both comparisons snapshot in the SAME JavaScript turn as the button click that
// starts the run (both handlers are synchronous), so both are exactly "t = 0 of a
// run" and any difference is a real leak rather than timing noise.

import { SNAPSHOT, conservationViolations, resetDiff, gpuAccounted } from '../probes.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async function soak(ctx) {
  const { cfg } = ctx;
  let last = null;
  const violations = [];
  let maxLights = 0, maxEnemies = 0, maxParticles = 0;

  const sample = async () => {
    const s = await ctx.snapshot();
    if (last) violations.push(...conservationViolations(last, s));
    maxLights = Math.max(maxLights, s.census.pointLights);
    maxEnemies = Math.max(maxEnemies, s.live.enemies);
    maxParticles = Math.max(maxParticles, s.live.particles);
    last = s;
    return s;
  };

  const play = async (toWave, label) => {
    await ctx.waitFor(`window.__probe.state.wave >= ${toWave}`,
                      { label, timeout: 300_000, poll: 400, onPoll: sample });
    return sample();
  };

  const die = async () => {
    await ctx.eval(`const p = window.__probe;
      p.player.invuln = 0; p.fn.damagePlayer(1e9, null, 'THE HARNESS'); return true;`);
    await ctx.waitFor('window.__probe.state.running === false', { label: 'death screen', timeout: 20_000 });
    await sleep(400);   // let the death card's own transitions settle
  };

  // --- run 1 ------------------------------------------------------------
  const snapA = last = await ctx.eval(`document.getElementById('startBtn').click(); ${SNAPSHOT}`);
  ctx.check('run 1 starts from the ENTER ARENA button',
            snapA.state.running === true && snapA.state.wave === 1, `wave=${snapA.state.wave}`);
  await ctx.eval(`window.__probe.turbo = ${cfg.turbo}; window.__bot.start(); return true;`);

  const end1 = await play(cfg.waves, `run 1 reaching wave ${cfg.waves}`);
  ctx.check(`run 1 played ${cfg.waves}+ waves`, end1.state.wave >= cfg.waves,
            `wave ${end1.state.wave}, peak ${maxEnemies} enemies / ${maxParticles} particles, ` +
            `${end1.state.stats.kills} kills, ${end1.state.upgrades.length} upgrades taken`);
  await die();
  ctx.check('death screen reached', true, `flatlined on wave ${end1.state.wave}`);

  // --- run 2: the state-leak comparison ---------------------------------
  const snapB = last = await ctx.eval(`document.getElementById('againBtn').click(); ${SNAPSHOT}`);
  ctx.check('run 2 starts from the RUN IT BACK button',
            snapB.state.running === true && snapB.state.wave === 1, `wave=${snapB.state.wave}`);

  const diffs = resetDiff(snapA, snapB);
  ctx.check('restart leaks no state: run 2 begins identical to run 1', diffs.length === 0,
            diffs.length ? `${diffs.length} field(s) differ` : 'state, mods, scene, entity counts and idle DOM all match');
  for (const d of diffs.slice(0, 15)) ctx.log(`${d.key}: run1=${JSON.stringify(d.first)}  run2=${JSON.stringify(d.second)}`);

  const end2 = await play(2, 'run 2 reaching wave 2');
  ctx.check('run 2 played a wave', end2.state.wave >= 2, `wave ${end2.state.wave}`);
  await die();

  // --- run 3: the GPU-leak comparison -----------------------------------
  const snapC = last = await ctx.eval(`document.getElementById('againBtn').click(); ${SNAPSHOT}`);
  const gpu = gpuAccounted(snapB, snapC);
  ctx.check('restart leaks no GPU resources: geometries and textures stayed accounted for',
            gpu.over.length === 0,
            gpu.over.length ? gpu.over.join('; ')
                            : `geometries ${snapC.gpu.geometries}, textures ${snapC.gpu.textures}, ` +
                              `${gpu.allowance} new pooled object(s) between restarts`);
  const diffs3 = resetDiff(snapB, snapC);
  ctx.check('second restart leaks no state either', diffs3.length === 0,
            diffs3.length ? `${diffs3.length} field(s) differ` : '');
  for (const d of diffs3.slice(0, 15)) ctx.log(`${d.key}: run2=${JSON.stringify(d.first)}  run3=${JSON.stringify(d.second)}`);

  await ctx.eval('window.__bot.stop(); return true;');

  // --- invariants watched the whole time --------------------------------
  ctx.check('pool conservation held all run', violations.length === 0,
            violations.length ? violations.slice(0, 4).join('; ') : 'no pooled object was dropped');
  // Every PointLight multiplies the fragment cost of every lit material scene-wide;
  // per-entity lights once took wave 13 down to ~6 FPS. Bounded singletons only.
  ctx.check(`point lights stayed within budget (<= ${cfg.pointLightCap})`, maxLights <= cfg.pointLightCap,
            `peak ${maxLights}`);

  ctx.soak = { maxLights, maxEnemies, maxParticles, resetDiffs: diffs, resetDiffs2: diffs3,
               gpu, violations, waveReached: end1.state.wave };
}
