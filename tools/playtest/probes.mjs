// The in-page probe expressions, plus the Node-side assertions over them.
//
// Every probe reads window.__probe and nothing else. Adding a check should mean
// adding a field here, not teaching the harness a new heuristic.

// One structured snapshot of everything worth asserting on. Used as the tail of an
// eval, so it must `return` (cdp.eval wraps the whole expression in an IIFE).
export const SNAPSHOT = `
  const p = window.__probe;
  const counts = o => { const r = {}; for (const k in o) r[k] = o[k].length; return r; };
  let pointLights = 0, meshes = 0, sprites = 0;
  p.scene.traverse(o => { if (o.isPointLight) pointLights++; else if (o.isMesh) meshes++; else if (o.isSprite) sprites++; });
  const info = p.renderer.info;
  const el = id => document.getElementById(id);
  const opa = id => (el(id) ? el(id).style.opacity : '?') || '';
  return {
    t: performance.now(),
    sceneChildren: p.scene.children.length,
    live: counts(p.live),
    pools: counts(p.pools),
    census: { pointLights, meshes, sprites },
    gpu: { geometries: info.memory.geometries, textures: info.memory.textures,
           programs: info.programs ? info.programs.length : -1,
           calls: info.render.calls, triangles: info.render.triangles },
    state: JSON.parse(JSON.stringify(p.state)),
    mods: JSON.parse(JSON.stringify(p.mods)),
    player: { hp: p.player.hp, maxHp: p.player.maxHp, invuln: +p.player.invuln.toFixed(3) },
    weapons: p.weapons.map(w => ({ name: w.name, mag: w.mag, magSize: w.magSize,
                                   reserve: w.reserve === Infinity ? 'inf' : w.reserve })),
    // Item 56 was a damage-flash that survived a reset, so the "should be idle" DOM
    // is snapshotted too — CSS-only leaks are invisible to any scene-graph check.
    dom: {
      body: document.body.className,
      canvas: document.querySelector('canvas').className,
      flash: opa('damageflash'), lowhp: opa('lowhp'),
      bossWrap: el('bosswrap').style.display, bossCard: el('bosscard').className,
      upgrade: el('upgrade').className, odBanner: el('odbanner').className,
      dmgDirs: Array.from(document.querySelectorAll('.dmgdir')).map(d => d.style.opacity || '0').join(','),
      wave: document.querySelector('#wave b').textContent,
    },
  };
`;

// Frame-time sampler. Wall-clock only — it must run at turbo 1 or the extra sim
// sub-steps inflate every frame and the numbers mean nothing.
// Draw calls need autoReset off: with bloom on, EffectComposer calls renderer.render()
// several times per frame and each call clears renderer.info, so a naive read returns
// the last pass's single fullscreen quad. With autoReset off the counts accumulate and
// this sampler resets them once per frame — and since rAF callbacks fire in
// registration order, and the game registered its loop at boot, this always runs after
// animate(). Draw calls and triangles are the perf numbers that DO transfer between
// machines, which is what makes them assertable where an FPS number is not.
export const FPS_START = `
  const f = window.__fps = { frames: [], calls: [], tris: [], last: 0, raf: 0 };
  const info = window.__probe.renderer.info;
  info.autoReset = false;
  info.reset();
  const tick = () => {
    f.raf = requestAnimationFrame(tick);
    const t = performance.now();
    if (f.last) { f.frames.push(t - f.last); f.calls.push(info.render.calls); f.tris.push(info.render.triangles); }
    f.last = t;
    info.reset();
  };
  f.raf = requestAnimationFrame(tick);
  return true;
`;

export const FPS_STOP = `
  const f = window.__fps;
  cancelAnimationFrame(f.raf);
  window.__probe.renderer.info.autoReset = true;
  const d = f.frames.slice(3).sort((a, b) => a - b);   // drop warm-up frames
  if (d.length < 10) return null;
  const q = x => d[Math.min(d.length - 1, Math.floor(d.length * x))];
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const calls = f.calls.slice().sort((a, b) => a - b);
  return {
    frames: d.length,
    fpsMedian: +(1000 / q(0.5)).toFixed(1),
    fpsMean:   +(1000 / mean).toFixed(1),
    fpsP1:     +(1000 / q(0.99)).toFixed(1),
    fpsMin:    +(1000 / d[d.length - 1]).toFixed(1),
    worstFrameMs: +d[d.length - 1].toFixed(1),
    longFrames: d.filter(x => x > 33.4).length,
    drawCallsMedian: calls[calls.length >> 1],
    drawCallsMax: calls[calls.length - 1],
    trianglesMedian: f.tris.slice().sort((a, b) => a - b)[f.tris.length >> 1],
  };
`;

// live list -> its free list. Anything with both is subject to the conservation law
// below; `enemies` and `pickups` are unpooled by design and simply absent here.
export const POOL_PAIRS = {
  particles: 'particlePool', tracers: 'tracerPool', dmgNumbers: 'dmgNumberPool',
  shockRings: 'shockRingPool', flashes: 'flashPool', gibs: 'gibPool',
  trailSegs: 'trailSegPool', waspTrail: 'waspTrailPool',
  rockets: 'rocketPool', enemyShots: 'enemyShotPool',
};

// live + free is the number of objects that pool ever minted. Pools only grow, so
// the total can rise but must NEVER fall: a drop means an object left the live list
// without being handed back — the exact shape of every "forgot to free it" bug.
export function poolTotals(snap) {
  const t = {};
  for (const [live, pool] of Object.entries(POOL_PAIRS)) t[live] = snap.live[live] + snap.pools[pool];
  return t;
}

export const sumPools = snap => Object.values(poolTotals(snap)).reduce((a, b) => a + b, 0);

export function conservationViolations(prev, next) {
  const a = poolTotals(prev), b = poolTotals(next), bad = [];
  for (const k of Object.keys(a)) if (b[k] < a[k]) bad.push(`${k}: ${a[k]} -> ${b[k]} (${a[k] - b[k]} lost)`);
  return bad;
}

// Fields that legitimately differ between two snapshots taken at the same moment of
// two different runs. Everything else differing is a resetGame() miss.
// Exact keys, never prefixes: a prefix rule here would silently swallow any future
// field that happens to start with the same letters as one of these ('t' would eat a
// 'touch' or 'timing' field the day someone adds one), and this is the probe least
// able to afford a silent hole.
const RESET_IGNORE_EXACT = new Set([
  't',                              // wall clock
  'gpu.calls', 'gpu.triangles',     // last rendered frame, not run state
  'gpu.programs',                   // shader programs are cached; run 1 compiles some
  // Pooled objects can own GPU resources — every damage number mints a CanvasTexture —
  // so these grow legitimately whenever a pool grows. They get their own accounted
  // check (gpuAccounted) instead of a flat equality that would cry leak every run.
  'gpu.geometries', 'gpu.textures',
]);
// Whole subtrees. Pools legitimately grow across a run; conservation covers them.
const RESET_IGNORE_SUBTREE = ['pools.'];

function flatten(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}

// Diff two "t = 0 of a run" snapshots. This is the highest-value probe in the rig:
// any per-run field a future item adds and forgets to clear in resetGame shows up
// here BY NAME, with no new harness code, forever.
export function resetDiff(a, b) {
  const fa = flatten(a), fb = flatten(b), diffs = [];
  for (const key of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    if (RESET_IGNORE_EXACT.has(key) || RESET_IGNORE_SUBTREE.some(p => key.startsWith(p))) continue;
    if (fa[key] !== fb[key]) diffs.push({ key, first: fa[key], second: fb[key] });
  }
  return diffs;
}

// Geometry/texture counts may only grow as fast as pools mint new objects: each newly
// pooled object can own at most one of each. Run against two consecutive restarts —
// by then pools are warm, so the allowance is a handful of objects and the check is
// tight enough to catch a dropped disposeEnemy (which leaks ~1 geometry per kill).
export function gpuAccounted(prev, next) {
  const allowance = sumPools(next) - sumPools(prev);
  const over = [];
  for (const k of ['geometries', 'textures']) {
    const grew = next.gpu[k] - prev.gpu[k];
    if (grew > allowance) over.push(`${k} +${grew} with only ${allowance} new pooled object(s)`);
  }
  return { over, allowance };
}
