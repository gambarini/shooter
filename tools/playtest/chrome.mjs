// Launches a DEDICATED Chrome for the playtest and hands back its CDP port.
//
// Dedicated is the whole point. Driving the user's own Chrome is what fails: the
// tab goes `visibilityState: hidden` on every tool call, which throttles
// requestAnimationFrame to a crawl (invalidating every FPS number) *and* trips the
// game's own visibilitychange auto-pause, so the run silently stops advancing.
// See the "Chrome automation hidden tab" finding behind items 49/50/51.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MAC_CANARY = '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';
const MAC_CHROMIUM = '/Applications/Chromium.app/Contents/MacOS/Chromium';
const LINUX = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const p of [MAC, MAC_CANARY, MAC_CHROMIUM]) if (existsSync(p)) return p;
  for (const name of LINUX) {
    try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); } catch {}
  }
  throw new Error('no Chrome found — set CHROME=/path/to/chrome');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch({ profileDir, headless = false, keepProfile = false, window = '1280,860' } = {}) {
  const bin = findChrome();
  // A wiped profile each run is what makes a run reproducible: settings live in
  // localStorage, so a stale profile could start the game with bloom off and
  // silently invalidate the perf numbers. `--keep-profile` opts out.
  if (!keepProfile && existsSync(profileDir)) rmSync(profileDir, { recursive: true, force: true });
  const portFile = join(profileDir, 'DevToolsActivePort');
  if (existsSync(portFile)) rmSync(portFile, { force: true });

  const args = [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',        // real port lands in DevToolsActivePort; no collisions
    '--no-first-run', '--no-default-browser-check', '--disable-sync',
    '--use-mock-keychain', '--password-store=basic',
    // The three flags that keep rAF running at full speed in an unattended window.
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    // The game synthesises all audio through WebAudio; without this the context
    // stays suspended and `initAudio` throws on some builds.
    '--autoplay-policy=no-user-gesture-required',
    `--window-size=${window}`, '--window-position=0,0',
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new', '--enable-unsafe-swiftshader');

  const proc = spawn(bin, args, { stdio: 'ignore', detached: false });
  proc.on('error', e => { throw e; });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const port = parseInt(readFileSync(portFile, 'utf8').split('\n')[0], 10);
      if (port > 0) return { proc, port, close: () => { try { proc.kill('SIGKILL'); } catch {} } };
    }
    if (proc.exitCode !== null) throw new Error(`Chrome exited early (code ${proc.exitCode})`);
    await sleep(100);
  }
  try { proc.kill('SIGKILL'); } catch {}
  throw new Error('Chrome never wrote DevToolsActivePort');
}
