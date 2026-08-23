#!/usr/bin/env node
// NEON STRIKE playtest harness (roadmap item 58).
//
//   node tools/playtest/run.mjs [options]        # or: make playtest
//
//   --scenario soak,perf   which scenarios to run, in order (default: soak,chaos,perf,boss,medals,arena,layout)
//   --waves N              waves to clear in run 1 before dying (default 4)
//   --perf-wave N          wave to reach before the FPS sample (default 6)
//   --turbo N              sim sub-steps per frame while playing, 1..8 (default 6)
//   --seed N               seeds Math.random, so a failing run is reproducible
//   --baseline REF         git ref the `ab` scenario diffs the current frame against
//                          (default HEAD; `ab` is opt-in and not in the default list)
//   --url URL              test an already-served build instead of the repo (e.g. the
//                          live site, or `make dev` on :8788) — nothing is served then
//   --headless             SwiftShader; fine for logic + leaks, MEANINGLESS for FPS
//   --no-sandbox           drop Chrome's sandbox — for CI containers only, never locally
//   --window WxH           Chrome's window size (default 1280,860). The perf baseline is
//                          only comparable at the default — move it for headless logic runs only
//   --keep-open            leave Chrome up afterwards to poke at the failure
//   --save-poses           `ab` only: write every pose to .playtest/ even on a pass, so the
//                          six camera angles can be reviewed rather than trusted
//   --save-baseline        record this run's perf numbers as the local baseline
//   --keep-profile         reuse the Chrome profile instead of wiping it
//
// Exits non-zero if any check fails, if the page logged an error or an unhandled
// rejection, or if window.__neonReady never became true.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { attachToPage } from './cdp.mjs';
import { launch } from './chrome.mjs';
import { serve } from './server.mjs';
import { SNAPSHOT } from './probes.mjs';
import soak from './scenarios/soak.mjs';
import perf from './scenarios/perf.mjs';
import boss from './scenarios/boss.mjs';
import medals from './scenarios/medals.mjs';
import layout from './scenarios/layout.mjs';
import chaos from './scenarios/chaos.mjs';
import ab from './scenarios/ab.mjs';
import arena from './scenarios/arena.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT = join(ROOT, '.playtest');
// `ab` is deliberately absent from the DEFAULT list below, not from this map: its default
// baseline is HEAD, so every legitimate visual item would turn the default run red.
const SCENARIOS = { soak, chaos, perf, boss, medals, arena, layout, ab };

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const cfg = { scenario: 'soak,chaos,perf,boss,medals,arena,layout', waves: 4, perfWave: 6, turbo: 6, seed: 1,
                url: null, headless: false, keepOpen: false, saveBaseline: false, savePoses: false,
                keepProfile: false, pointLightCap: 8, baseline: 'HEAD', noSandbox: false,
                window: '1280,860' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--scenario') cfg.scenario = next();
    else if (a === '--waves') cfg.waves = +next();
    else if (a === '--perf-wave') cfg.perfWave = +next();
    else if (a === '--turbo') cfg.turbo = Math.max(1, Math.min(8, +next()));
    else if (a === '--seed') cfg.seed = +next();
    else if (a === '--baseline') cfg.baseline = next();
    else if (a === '--url') cfg.url = next();
    else if (a === '--point-light-cap') cfg.pointLightCap = +next();
    else if (a === '--headless') cfg.headless = true;
    else if (a === '--no-sandbox') cfg.noSandbox = true;
    else if (a === '--window') cfg.window = next().replace('x', ',');
    else if (a === '--keep-open') cfg.keepOpen = true;
    else if (a === '--save-poses') cfg.savePoses = true;
    else if (a === '--save-baseline') cfg.saveBaseline = true;
    else if (a === '--keep-profile') cfg.keepProfile = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error(`unknown option: ${a}`); process.exit(2); }
  }
  return cfg;
}
function printHelp() {
  console.log(readFileSync(new URL(import.meta.url), 'utf8')
    .split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n'));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const C = { ok: '\x1b[32m', bad: '\x1b[31m', dim: '\x1b[2m', warn: '\x1b[33m', off: '\x1b[0m' };

// ---------------------------------------------------------------- main
const cfg = parseArgs(process.argv.slice(2));
const checks = [];
const pageErrors = [];
const pageWarnings = [];
let server = null, chrome = null, cdp = null;

const ctx = {
  cfg, checks, pageErrors,
  log: msg => console.log(`${C.dim}   ${msg}${C.off}`),
  check(name, ok, detail = '') {
    checks.push({ name, ok: !!ok, detail: String(detail) });
    console.log(`${ok ? C.ok + ' PASS' : C.bad + ' FAIL'}${C.off} ${name}${detail ? `  ${C.dim}${detail}${C.off}` : ''}`);
    return !!ok;
  },
  snapshot: () => cdp.eval(SNAPSHOT),
  eval: (...a) => cdp.eval(...a),
  // Raw CDP, for the domains that have no in-page equivalent — Emulation (viewport and
  // touch, item 67) and Page.captureScreenshot. Everything about the GAME still goes
  // through `__probe`; this is for things the page cannot do to itself.
  send: (...a) => cdp.send(...a),
  // Reload the page and restore what a fresh document loses — the in-page bot. The
  // seeded Math.random survives on its own (addScriptToEvaluateOnNewDocument re-runs).
  // Needed by any scenario asserting that something PERSISTS, which cannot be faked.
  async reload() {
    await cdp.send('Page.navigate', { url: ctx.url });
    await ctx.waitFor('window.__neonReady === true', { timeout: 30_000, label: 'reboot' });
    await cdp.eval(readFileSync(join(HERE, 'bot.js'), 'utf8') + '\nreturn true;');
  },
  // Put the page back into the only state a scenario is entitled to assume: a freshly
  // booted document at the title card, with the bot injected and stopped, no run in
  // progress, turbo 1 and a clean profile (item 73).
  //
  // The contract that makes this cheap: a reload resets EVERYTHING in-page, so the only
  // things needing an explicit clear are the two that survive it — `localStorage` and the
  // CDP `Emulation` overrides. Nothing else here has to know what the last scenario did.
  //
  // The scenario loop calls it before every scenario, so order independence is structural
  // rather than a convention each new file has to remember.
  async resetPage() {
    // Cleared BEFORE navigating: the game reads every `neonstrike.*` key at boot. By
    // prefix rather than localStorage.clear(), which would also wipe anything Chrome or a
    // --url target keeps here. In a try, because a scenario that broke the page must not
    // be able to block the reset that repairs it.
    try {
      await cdp.eval(`for (const k of Object.keys(localStorage))
        if (k.startsWith('neonstrike.')) localStorage.removeItem(k);
      return true;`);
    } catch { /* the reload below fixes the page regardless */ }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
    await ctx.reload();
    // `driven` from the first frame, not from the scenario's first bot.start(): until it
    // is set the blur/visibility auto-pauses are armed, and a Chrome window that loses
    // focus in that gap pauses the game into a timeout nothing explains.
    await cdp.eval('window.__probe.driven = true; window.__probe.turbo = 1; return true;');
  },
  // Poll a boolean expression in the page. Every wait in the rig is a condition,
  // never a fixed sleep — turbo makes any hard-coded duration wrong.
  async waitFor(expr, { timeout = 90_000, label = expr, poll = 100, onPoll } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await cdp.eval(`return !!(${expr});`)) return true;
      if (onPoll) await onPoll();
      await sleep(poll);
    }
    throw new Error(`timed out after ${timeout}ms waiting for: ${label}`);
  },
};

try {
  // 1. serve (unless pointed at an existing build)
  let url = cfg.url;
  if (!url) { server = await serve(ROOT); url = server.url; }
  ctx.url = url;   // ctx.reload() navigates back here
  console.log(`${C.dim}NEON STRIKE playtest — ${url}  seed=${cfg.seed} turbo=${cfg.turbo}${cfg.headless ? ' headless' : ''}${C.off}\n`);

  // 2. dedicated Chrome + CDP
  chrome = await launch({ profileDir: join(HERE, '.chrome-profile'), headless: cfg.headless,
                          keepProfile: cfg.keepProfile, noSandbox: cfg.noSandbox, window: cfg.window });
  cdp = await attachToPage(chrome.port);
  await Promise.all([cdp.send('Runtime.enable'), cdp.send('Log.enable'),
                     cdp.send('Network.enable'), cdp.send('Page.enable')]);

  // 3. collect everything that counts as "the page went wrong"
  const text = args => args.map(a => a.description ?? a.value ?? a.unserializableValue ?? '?').join(' ');
  cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error') pageErrors.push(`console.error: ${text(p.args)}`);
    else if (p.type === 'warning') pageWarnings.push(text(p.args));
  });
  cdp.on('Runtime.exceptionThrown', p =>
    pageErrors.push(`exception: ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`));
  cdp.on('Log.entryAdded', p => {
    const e = p.entry;
    // A failed /api/* request is the documented no-Functions-runtime case: `make serve`
    // 404s it and the game shows OFFLINE on purpose. The harness's own server stubs it,
    // but --url can point at a build that doesn't, so it is a warning, never a failure.
    if (e.source === 'network' && /\/api\//.test(e.url || '')) { pageWarnings.push(`leaderboard offline: ${e.text}`); return; }
    if (e.level === 'error') pageErrors.push(`${e.source}: ${e.text}`);
    else if (e.level === 'warning') pageWarnings.push(`${e.source}: ${e.text}`);
  });
  const failedUrls = new Map();
  cdp.on('Network.requestWillBeSent', p => failedUrls.set(p.requestId, p.request.url));
  cdp.on('Network.loadingFailed', p => {
    const url = failedUrls.get(p.requestId) || '';
    if (p.canceled || /\/api\//.test(url)) return;
    pageErrors.push(`request failed (${p.type}): ${p.errorText} ${url}`);
  });

  // 4. seed Math.random before any page script runs. No game change needed, and it
  //    makes wave composition, upgrade cards and mutator rolls repeatable — so a
  //    failure is reproducible with the same --seed instead of "it happened once".
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => { let s = ${cfg.seed} >>> 0;
      Math.random = () => { s = s + 0x6D2B79F5 | 0;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();` });

  // 5. boot
  await cdp.send('Page.navigate', { url });
  await ctx.waitFor('window.__neonReady === true', { timeout: 30_000, label: 'window.__neonReady' })
    .catch(() => {});
  const ready = await cdp.eval('return window.__neonReady === true;');
  ctx.check('boot: window.__neonReady === true', ready);
  if (!ready) throw new Error('the engine never booted — check the console errors below');
  const version = await cdp.eval('return window.__probe && window.__probe.version;');
  ctx.check('boot: test API published', version === 1, `__probe.version=${version}`);
  if (version !== 1) throw new Error('window.__probe is missing or a different version');

  // Item 89 — the GPU-leak checks rest on SNAPSHOT's reachable census, and this is the
  // tripwire under it: on a freshly booted title screen the game has leaked nothing, so
  // every resource `renderer.info` counts must be one the census reaches. Two ways to
  // break that, both of which would otherwise turn into a flaky gate rather than a
  // failure. Pin three to a version that renames the 'dispose' listener the census reads
  // and the count silently goes to zero, taking every leak check with it — that fails
  // here, at boot, on a scene that has leaked nothing. Add a shared geometry or texture
  // without listing it in `__probe.gpuShared` and it reads as unreachable from the first
  // frame that draws it: at boot if it is drawn at boot, and otherwise at every leg check
  // from then on, which is a standing failure rather than the coin flip it used to be.
  const gpu0 = (await ctx.snapshot()).gpu;
  ctx.check('boot: the GPU census accounts for every uploaded resource',
            gpu0.reachGeo === gpu0.geometries && gpu0.reachTex === gpu0.textures,
            `${gpu0.reachGeo}/${gpu0.geometries} geometries and ${gpu0.reachTex}/${gpu0.textures} ` +
            `textures reached — see __probe.gpuShared`);

  // 6. bot
  await cdp.eval(readFileSync(join(HERE, 'bot.js'), 'utf8') + '\nreturn true;');

  // 7. scenarios
  for (const name of cfg.scenario.split(',').map(s => s.trim()).filter(Boolean)) {
    const fn = SCENARIOS[name];
    if (!fn) { ctx.check(`scenario ${name}`, false, 'no such scenario'); continue; }
    console.log(`\n${C.dim}── ${name} ──${C.off}`);
    // Item 73: every scenario starts from the same fresh page, so running one alone or
    // reordering the list cannot change a result. The order in SCENARIOS is kept for
    // readability — cheap first, environment-bending last — and nothing depends on it.
    await ctx.resetPage();
    const pre = JSON.parse(await cdp.eval(`return JSON.stringify({
      ready: window.__neonReady === true, version: window.__probe && window.__probe.version,
      running: window.__probe.state.running,
      title: !document.getElementById('startCard').classList.contains('hidden'),
      bot: typeof window.__bot === 'object',
      profile: Object.keys(localStorage).filter(k => k.startsWith('neonstrike.')) });`));
    ctx.check(`${name}: starts from a fresh page`,
              pre.ready && pre.version === 1 && !pre.running && pre.title &&
              pre.bot && pre.profile.length === 0,
              `running=${pre.running} title=${pre.title} bot=${pre.bot} profile=[${pre.profile}]`);
    await fn(ctx);
  }
} catch (err) {
  ctx.check('harness completed', false, err.message);
  if (cdp) {
    try {
      mkdirSync(OUT, { recursive: true });
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, 'failure.png'), Buffer.from(shot.data, 'base64'));
      console.log(`${C.dim}   screenshot: .playtest/failure.png${C.off}`);
    } catch {}
  }
} finally {
  // ---------------------------------------------------------------- report
  ctx.check('page logged no errors', pageErrors.length === 0,
            pageErrors.length ? `${pageErrors.length}: ${pageErrors[0]}` : '');

  const failed = checks.filter(c => !c.ok);
  console.log('');
  if (pageWarnings.length) console.log(`${C.warn} ${pageWarnings.length} page warning(s)${C.off} ${C.dim}${pageWarnings[0]}${C.off}`);
  for (const e of pageErrors.slice(0, 10)) console.log(`${C.bad} error${C.off} ${e}`);
  console.log(failed.length
    ? `${C.bad}FAILED${C.off} ${failed.length}/${checks.length} checks: ${failed.map(f => f.name).join(', ')}`
    : `${C.ok}OK${C.off} ${checks.length}/${checks.length} checks passed`);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(
    { cfg, checks, pageErrors, pageWarnings, perf: ctx.perf ?? null, at: new Date().toISOString() }, null, 2));

  if (cfg.saveBaseline && ctx.perf) {
    writeFileSync(join(OUT, 'baseline.json'), JSON.stringify(ctx.perf, null, 2));
    console.log(`${C.dim}baseline saved to .playtest/baseline.json${C.off}`);
  }

  if (cdp && !cfg.keepOpen) cdp.close();
  if (chrome && !cfg.keepOpen) chrome.close();
  if (server && !cfg.keepOpen) await server.close();
  if (cfg.keepOpen) console.log(`${C.dim}--keep-open: Chrome left running on CDP port ${chrome?.port}${C.off}`);
  process.exit(failed.length ? 1 : 0);
}
