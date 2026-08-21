// Visual A/B against an older build, as a number (roadmap item 65).
//
//   make playtest ARGS="--scenario ab --baseline v0.21.5"
//
// Proving a visual refactor changed nothing used to mean serving the old index.html on a
// second port and eyeballing two windows — which is a judgement, not a result, and one
// nobody repeats on the fifth pose. This turns it into a mean absolute difference per
// camera pose, with the worst 16x16 tile named so a failure says *where* the frame moved.
//
// Four decisions worth keeping:
//
// - **The signature is computed IN THE PAGE**, so the rig stays dependency-free: the
//   canvas is drawn down to a 16x16 grid through a 2D context and read back as 768
//   numbers. No image library, and nothing to install before `make playtest` runs.
// - **It is sampled inside a one-shot rAF**, registered per capture. The renderer has no
//   `preserveDrawingBuffer`, so the drawing buffer is only readable between the render and
//   the composite — and rAF callbacks fire in registration order, so a callback registered
//   now always runs after the game's `animate()`, which registered its loop at boot.
//   Reading the canvas from anywhere else returns black, silently and identically for both
//   builds, which would make every pose score a perfect 0.
// - **The arena is held empty and the camera is placed**, never played. One enemy is left
//   permanently *pending* — `toSpawn = 1` with the spawn timer parked at infinity — because
//   the wave-clear test is `toSpawn === 0 && enemies.length === 0`: an arena emptied the
//   obvious way clears wave 1 on the first frame and the upgrade screen slides in over
//   every pose, at a wall-clock moment that differs between the two builds. Each pose is
//   then a fixed position and look target; the bot's motion would photograph two builds
//   from two different places.
// - **A vs A runs first.** The noise floor is MEASURED and printed every run, and the
//   scenario fails if it ever climbs near the threshold. A threshold guessed against
//   nondeterminism you never measured is a threshold that starts crying wolf on somebody
//   else's machine. Note that `state.paused` would freeze almost none of that noise:
//   `updateEnv` and `updateAttract` are called OUTSIDE the running/paused gate on purpose
//   ("the arena idles alive"). Pinning the two clocks in `pose()` is what actually works.
//
// PNGs are written on failure only: the number says something changed, the picture says
// what. On a pass they would be six identical frames of an empty arena.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '../server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const OUT = join(ROOT, '.playtest');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const N = 16;                 // tiles per side; 768 numbers per signature
// TWO thresholds, because the two kinds of visual change do not look alike in one number.
//
// A global change moves the whole frame a little: bloom off scores 5-12 MAD, and the mean
// catches it easily. A LOCAL change moves a few tiles a lot and barely moves the mean —
// repainting a sector's grid line colour scores 0.10-0.89 MAD, comfortably under any
// threshold the noise permits, while shifting its worst tile by 12-32. Assert the mean and
// you miss every recolour; assert the worst tile and a single drifting dust mote fails the
// run. So: both, each tuned against the measured floor.
//
// Fully pinned (both builds carrying __probe.fn.resetEnv), A-vs-A measures 0.004 MAD with
// a worst tile of 0.3 — so 1.0 and 4.0 sit roughly 250x and 13x above the floor, and 3x
// under the smallest change worth catching. Against an UNPINNED baseline the floor rises
// to ~0.5 MAD with worst tiles of 45-75, which is why the tile assertion is made only when
// the baseline can pin its own arena clock: it would otherwise fail on pure phase.
const THRESHOLD = 1.0;        // mean absolute difference, 0..255 per channel
const TILE_THRESHOLD = 4.0;   // ...and no single tile may move more than this
const FLOOR_MARGIN = 4;       // A-vs-A must stay this many times under both

// Fixed poses. The player stands still in an empty arena and looks at a named point, so
// the same pose is the same picture on any build: the four walls from the centre (trims,
// mood lighting, dust), a shallow sweep down the receding grid, and the spawn corner
// looking back across the whole arena (everything at once, at depth).
//
// `floor-sweep` is shallow on purpose. A steep look straight down scores ~0.00 against a
// recoloured grid, because from eye height you see two or three antialiased lines and a
// lot of dark floor, and a 16x16 average erases them. Looking down the length of the grid
// puts hundreds of lines in the frame, which is what makes the grid shader assertable at
// all. If a pose ever has to be replaced, replace it with one that sees MORE of the thing
// it is there for, not a prettier angle.
const ARENA = 70;
const POSES = [
  { name: 'centre-north', at: [0, 0],    look: [0, 2, -ARENA] },
  { name: 'centre-east',  at: [0, 0],    look: [ARENA, 2, 0] },
  { name: 'centre-south', at: [0, 0],    look: [0, 2, ARENA] },
  { name: 'centre-west',  at: [0, 0],    look: [-ARENA, 2, 0] },
  { name: 'floor-sweep',  at: [0, 0],    look: [0, -3, -26] },
  { name: 'spawn-corner', at: [40, 40],  look: [-ARENA, 4, -ARENA] },
];

// Set up a run that will never move: no spawn queue, no pickup timer, the player parked.
// `state.time` is pinned per capture so the grid shader's own pulse (0.85 + 0.15*sin(t))
// is at the same phase in both builds — otherwise the brightest thing in five of these six
// poses is being sampled at a random point of its cycle.
const PIN_TIME = 30;
const HOLD = `p.state.toSpawn = 1; p.state.spawnTimer = 1e9;   // pending forever: spawns nothing, clears never
  p.state.pickupTimer = 1e9; p.state.betweenWaves = 0;`;
const ARM = `const p = window.__probe;
  document.getElementById('startBtn').click();
  ${HOLD}                       // same turn as the click, so update() never runs without it
  p.driven = true; p.turbo = 1;
  p.player.maxHp = 1e7; p.player.hp = 1e7;
  return true;`;

const pose = pz => `const p = window.__probe;
  ${HOLD}
  // Pin BOTH clocks the frame is a function of. state.time drives the grid shader's pulse;
  // envTime (which resetEnv zeroes, along with the trim, cap and dust state it feeds)
  // drives a +/-38% breath on every wall trim, accumulating from page load and never reset
  // mid-run. Leave envTime alone and the spawn-corner pose scores 0.1-0.25 MAD against an
  // identical build purely on which phase each page happened to be at.
  // Guarded: a baseline ref older than this item has no resetEnv on its probe, and a
  // scenario whose whole job is comparing against old builds must not throw on one. The
  // comparison just runs at the higher, unpinned floor then — reported below, so a
  // marginal score against an old ref is never mistaken for a clean one.
  if (p.fn.resetEnv) p.fn.resetEnv();
  p.state.time = ${PIN_TIME};
  p.player.pos.x = ${pz.at[0]}; p.player.pos.z = ${pz.at[1]};
  p.player.vel.set(0, 0, 0);
  p.lookAt(${pz.look[0]}, ${pz.look[1]}, ${pz.look[2]});
  return true;`;

const SIGNATURE = `
  const src = window.__probe.renderer.domElement;
  return new Promise(res => requestAnimationFrame(() => {
    const c = document.createElement('canvas'); c.width = ${N}; c.height = ${N};
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, ${N}, ${N});
    const d = g.getImageData(0, 0, ${N}, ${N}).data;
    const out = new Array(${N} * ${N} * 3);
    for (let i = 0; i < ${N} * ${N}; i++) {
      out[i * 3] = d[i * 4]; out[i * 3 + 1] = d[i * 4 + 1]; out[i * 3 + 2] = d[i * 4 + 2];
    }
    res(out);
  }));`;

// Mean absolute difference across all 768 channels, plus the tile that moved most — a
// single number says a build changed, the tile says which corner of the frame to look at.
function compare(a, b) {
  let sum = 0, worst = { tile: -1, delta: 0 };
  for (let i = 0; i < N * N; i++) {
    let tile = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(a[i * 3 + c] - b[i * 3 + c]); sum += d; tile += d; }
    tile /= 3;
    if (tile > worst.delta) worst = { tile: i, delta: tile };
  }
  return { mad: sum / (N * N * 3), worstTile: worst.tile, worstDelta: worst.delta,
           worstAt: worst.tile < 0 ? 'no tile moved at all'
                                   : `col ${worst.tile % N}, row ${Math.floor(worst.tile / N)} of ${N}` };
}

async function goto(ctx, url, label) {
  await ctx.send('Page.navigate', { url });
  await ctx.waitFor('window.__neonReady === true', { timeout: 30_000, label: `${label} booted` });
  await ctx.eval('window.__probe.driven = true; window.__probe.turbo = 1; return true;');
}

// Every pose, on whatever build is currently loaded.
async function capture(ctx) {
  await ctx.eval(ARM);
  const sigs = {};
  for (const pz of POSES) {
    await ctx.eval(pose(pz));
    await sleep(120);                 // let the camera, the gun sway and the mood settle
    await ctx.eval(pose(pz));         // re-pin state.time immediately before the capture
    sigs[pz.name] = await ctx.eval(SIGNATURE, { awaitPromise: true });
  }
  return sigs;
}

async function shoot(ctx, name) {
  try {
    mkdirSync(OUT, { recursive: true });
    const s = await ctx.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `ab-${name}.png`), Buffer.from(s.data, 'base64'));
  } catch { /* a screenshot is a courtesy, never a reason to fail a run */ }
}

export default async function ab(ctx) {
  const { cfg } = ctx;
  // --url points at a build somebody else is serving, and the baseline half of this needs
  // the harness's own server plus a git checkout of the ref. Fail loudly rather than
  // logging a skip: a scenario that quietly does nothing reports green for work it
  // did not do, which is the exact failure item 64 was written to avoid.
  if (cfg.url) {
    ctx.check('ab: runs against the repo, not --url', false,
              'the baseline is served from git show; re-run without --url');
    return;
  }

  const ref = cfg.baseline;
  let baselineSrc;
  try {
    baselineSrc = execFileSync('git', ['show', `${ref}:index.html`], { cwd: ROOT, maxBuffer: 1 << 28 });
  } catch (e) {
    ctx.check(`ab: baseline ref ${ref} resolves`, false, String(e.message).split('\n')[0]);
    return;
  }
  ctx.check(`ab: baseline ref ${ref} resolves`, true, `${(baselineSrc.length / 1024).toFixed(0)}KB of index.html`);

  const dir = join(OUT, 'ab-baseline');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), baselineSrc);
  let baselineServer = null;

  try {
    // --- A, then A again: the noise floor ------------------------------
    const a1 = await capture(ctx);
    await goto(ctx, ctx.url, 'the working tree');
    const a2 = await capture(ctx);
    const floors = POSES.map(pz => compare(a1[pz.name], a2[pz.name]));
    const floor = Math.max(...floors.map(f => f.mad));
    const floorTile = Math.max(...floors.map(f => f.worstDelta));
    ctx.check('ab: the same build twice scores at the noise floor',
              floor * FLOOR_MARGIN < THRESHOLD && floorTile * FLOOR_MARGIN < TILE_THRESHOLD,
              `worst pose ${floor.toFixed(3)} MAD / tile ${floorTile.toFixed(1)}, ` +
              `thresholds ${THRESHOLD} / ${TILE_THRESHOLD} (needs ${FLOOR_MARGIN}x headroom)`);
    ctx.log(`noise floor per pose: ${POSES.map((pz, i) => `${pz.name} ${floors[i].mad.toFixed(3)}`).join(' · ')}`);

    // --- B: the baseline, on its own port ------------------------------
    baselineServer = await serve(dir);
    await goto(ctx, baselineServer.url, `baseline ${ref}`);
    const version = await ctx.eval('return window.__probe && window.__probe.version;');
    if (version !== 1) {
      ctx.check(`ab: baseline ${ref} publishes the same test API`, false,
                `__probe.version=${version} — the ref predates the harness, pick a newer one`);
      return;
    }
    const pinned = await ctx.eval('return typeof window.__probe.fn.resetEnv === "function";');
    if (!pinned) ctx.log(`baseline ${ref} predates __probe.fn.resetEnv — its arena idle clock ` +
                         `(wall-trim breath, dust) runs free, so expect a floor nearer 0.25 than 0.00 below`);
    const b = await capture(ctx);

    // --- the diff ------------------------------------------------------
    const scores = [];
    let failed = 0;
    for (const pz of POSES) {
      const r = compare(a1[pz.name], b[pz.name]);
      // The tile half only when the baseline could pin its own arena clock — see the
      // threshold comment above. Against an older ref the mean is all there is.
      const tileOk = !pinned || r.worstDelta <= TILE_THRESHOLD;
      const ok = r.mad <= THRESHOLD && tileOk;
      scores.push({ pose: pz.name, ...r, ok });
      if (!ok) failed++;
      ctx.check(`ab: ${pz.name} matches ${ref}`, ok,
                `${r.mad.toFixed(3)} MAD (threshold ${THRESHOLD}), worst tile ${r.worstDelta.toFixed(1)}` +
                `${pinned ? ` (threshold ${TILE_THRESHOLD})` : ' (not asserted: unpinned baseline)'} at ${r.worstAt}`);
      if (!ok) await shoot(ctx, `${pz.name}-baseline`);
    }

    if (failed) {
      // The pictures, from the build under test, for the poses that moved. Written only
      // here: on a pass they are six identical frames of an empty arena.
      await goto(ctx, ctx.url, 'the working tree');
      await ctx.eval(ARM);
      for (const s of scores.filter(x => !x.ok)) {
        await ctx.eval(pose(POSES.find(p => p.name === s.pose)));
        await sleep(150);
        await shoot(ctx, `${s.pose}-current`);
      }
      ctx.log(`.playtest/ab-*.png written for ${failed} pose(s) — "-baseline" is ${ref}, "-current" is the working tree`);
    }

    ctx.ab = { ref, threshold: THRESHOLD, floor, baselinePinned: pinned, scores };
  } finally {
    if (baselineServer) await baselineServer.close();
    rmSync(dir, { recursive: true, force: true });
    // Back to the build under test before the loop moves on. `resetPage()` clears
    // localStorage on whatever origin the page is currently showing, so leaving it parked
    // on the baseline port would let this scenario's `neonstrike.*` keys survive into the
    // next one on the origin that matters.
    try {
      await goto(ctx, ctx.url, 'the working tree');
      const back = await ctx.eval('return location.origin + "/";');
      ctx.check('ab: left the page back on the build under test', back === ctx.url, back);
    } catch (e) {
      ctx.check('ab: left the page back on the build under test', false, e.message);
    }
  }
}
