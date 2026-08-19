#!/usr/bin/env node
// NEON STRIKE playtest harness (roadmap item 58).
//
//   node tools/playtest/run.mjs [options]        # or: make playtest
//
//   --scenario soak,perf   which scenarios to run, in order (default: soak,perf,medals)
//   --waves N              waves to clear in run 1 before dying (default 4)
//   --perf-wave N          wave to reach before the FPS sample (default 6)
//   --turbo N              sim sub-steps per frame while playing, 1..8 (default 6)
//   --seed N               seeds Math.random, so a failing run is reproducible
//   --url URL              test an already-served build instead of the repo (e.g. the
//                          live site, or `make dev` on :8788) — nothing is served then
//   --headless             SwiftShader; fine for logic + leaks, MEANINGLESS for FPS
//   --keep-open            leave Chrome up afterwards to poke at the failure
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
import medals from './scenarios/medals.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT = join(ROOT, '.playtest');
const SCENARIOS = { soak, perf, medals };

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const cfg = { scenario: 'soak,perf,medals', waves: 4, perfWave: 6, turbo: 6, seed: 1,
                url: null, headless: false, keepOpen: false, saveBaseline: false,
                keepProfile: false, pointLightCap: 8 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--scenario') cfg.scenario = next();
    else if (a === '--waves') cfg.waves = +next();
    else if (a === '--perf-wave') cfg.perfWave = +next();
    else if (a === '--turbo') cfg.turbo = Math.max(1, Math.min(8, +next()));
    else if (a === '--seed') cfg.seed = +next();
    else if (a === '--url') cfg.url = next();
    else if (a === '--point-light-cap') cfg.pointLightCap = +next();
    else if (a === '--headless') cfg.headless = true;
    else if (a === '--keep-open') cfg.keepOpen = true;
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
  // Reload the page and restore what a fresh document loses — the in-page bot. The
  // seeded Math.random survives on its own (addScriptToEvaluateOnNewDocument re-runs).
  // Needed by any scenario asserting that something PERSISTS, which cannot be faked.
  async reload() {
    await cdp.send('Page.navigate', { url: ctx.url });
    await ctx.waitFor('window.__neonReady === true', { timeout: 30_000, label: 'reboot' });
    await cdp.eval(readFileSync(join(HERE, 'bot.js'), 'utf8') + '\nreturn true;');
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
  chrome = await launch({ profileDir: join(HERE, '.chrome-profile'), headless: cfg.headless, keepProfile: cfg.keepProfile });
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

  // 6. bot
  await cdp.eval(readFileSync(join(HERE, 'bot.js'), 'utf8') + '\nreturn true;');

  // 7. scenarios
  for (const name of cfg.scenario.split(',').map(s => s.trim()).filter(Boolean)) {
    const fn = SCENARIOS[name];
    if (!fn) { ctx.check(`scenario ${name}`, false, 'no such scenario'); continue; }
    console.log(`\n${C.dim}── ${name} ──${C.off}`);
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
