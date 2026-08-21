// Frame-time sample under the load that actually hurts: shotgun spam into a crowd,
// with bloom on.
//
// Two deliberate choices. Turbo drops to 1 first — extra sim sub-steps inflate every
// frame, so an FPS number measured under turbo is meaningless. And FPS is reported
// against a machine-local baseline rather than an absolute threshold, because an
// absolute number is unfalsifiable across machines; the portable signals are draw
// calls and long-frame count, which do not vary with the hardware.
//
// The baseline is also a same-page-age comparison: since item 73 the sample always runs
// on a document booted moments earlier, never on one soak has already played three runs
// in. That made no measurable difference on a vsync-capped machine, but a baseline
// recorded before item 73 is measuring a warmer page — re-record rather than retune if it
// starts to wobble.

import { FPS_START, FPS_STOP } from '../probes.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), '.playtest', 'baseline.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SAMPLE_MS = 8000;

export default async function perf(ctx) {
  const { cfg } = ctx;

  // Since item 73 every scenario is handed a fresh page at the title card, so this is
  // always the first run of a freshly booted document — never a continuation of soak's.
  await ctx.eval(`document.getElementById('startBtn').click(); return true;`);

  // The sample must not be cut short by a death, so the player is made unkillable
  // for the ramp. This changes nothing about what is rendered — same enemies, same
  // particles, same lights — only who survives them.
  await ctx.eval(`const p = window.__probe;
    p.player.maxHp = 1e9; p.player.hp = 1e9;
    p.turbo = ${cfg.turbo}; window.__bot.start(); return true;`);

  await ctx.waitFor(`window.__probe.state.wave >= ${cfg.perfWave}`,
                    { label: `wave ${cfg.perfWave}`, timeout: 240_000, poll: 400 });
  // Wait for a crowd rather than a fixed delay: an empty inter-wave lull would
  // measure an idle arena and call it a perf result.
  await ctx.waitFor('window.__probe.live.enemies.length >= 4',
                    { label: 'a crowd to shoot', timeout: 60_000, poll: 200 });

  await ctx.eval('const p = window.__probe; p.turbo = 1; window.__bot.cfg.forceWeapon = 1; return true;');
  await sleep(700);   // let the weapon swap and the frame pacing settle

  await ctx.eval(FPS_START);
  await sleep(SAMPLE_MS);
  const r = await ctx.eval(FPS_STOP);
  const shape = await ctx.snapshot();
  await ctx.eval('window.__bot.cfg.forceWeapon = null; return true;');

  if (!r) { ctx.check('FPS sample collected', false, 'fewer than 10 frames sampled'); return; }
  ctx.perf = { ...r, wave: shape.state.wave, enemies: shape.live.enemies,
               particles: shape.live.particles, headless: cfg.headless };
  ctx.check('FPS sample collected during shotgun spam', true,
    `median ${r.fpsMedian} · mean ${r.fpsMean} · 1% low ${r.fpsP1} · min ${r.fpsMin} fps ` +
    `(wave ${shape.state.wave}, ${shape.live.enemies} enemies, ${shape.live.particles} particles)`);
  ctx.log(`worst frame ${r.worstFrameMs}ms · ${r.longFrames}/${r.frames} frames over 33ms · ` +
          `draw calls median ${r.drawCallsMedian}, max ${r.drawCallsMax}`);

  if (cfg.headless) {
    ctx.log('headless: SwiftShader renders on the CPU — the FPS numbers above are not comparable to a real run');
  } else {
    ctx.check('no catastrophic stalls', r.worstFrameMs < 250, `worst frame ${r.worstFrameMs}ms`);
    ctx.check('frame pacing holds (under a third of frames dropped)',
              r.longFrames / r.frames < 0.33, `${r.longFrames}/${r.frames} frames over 33ms`);
  }

  if (existsSync(BASELINE)) {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const ratio = r.fpsMedian / base.fpsMedian;
    ctx.check('no FPS regression vs the local baseline', ratio >= 0.8,
              `${r.fpsMedian} vs baseline ${base.fpsMedian} (${(ratio * 100).toFixed(0)}%)`);
    ctx.check('no draw-call regression vs the local baseline', r.drawCallsMax <= base.drawCallsMax * 1.25,
              `${r.drawCallsMax} vs baseline ${base.drawCallsMax}`);
  } else {
    ctx.log('no .playtest/baseline.json yet — run with --save-baseline on a quiet machine to create one');
  }
}
