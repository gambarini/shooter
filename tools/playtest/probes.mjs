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
  // Item 89 — how many of the resources renderer.info counts the game can still REACH.
  // three.js registers a 'dispose' listener on a geometry, a texture or a render target
  // the first time it uploads it, and removes it on dispose, so that listener is exactly
  // "counted by info.memory right now". Everything the game owns is reachable from four
  // roots: the scene (the camera and the viewmodel hang off it), the pools, the live
  // lists, and __probe.gpuShared — the module-scope singletons and the composer, which
  // no scene walk can see. info.memory minus this census is what the game has LOST, and
  // gpuAccounted below is the assertion over that number.
  // (No backticks in this string: SNAPSHOT is itself a template literal.)
  const uploaded = o => !!(o && o._listeners && o._listeners.dispose && o._listeners.dispose.length);
  const gSeen = new Set(), tSeen = new Set();
  // A render target's dispose listener sits on the TARGET, while what info.memory counted
  // is its texture — so credit the texture and test the target, never the other way round.
  const rt = t => { if (uploaded(t)) for (const x of t.textures || [t.texture]) if (x) tSeen.add(x.id); };
  const mat = m => { for (const k in m) { const v = m[k]; if (v && v.isTexture && uploaded(v)) tSeen.add(v.id); } };
  const hold = o => {
    if (o.geometry && uploaded(o.geometry)) gSeen.add(o.geometry.id);
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) mat(m);
    if (o.shadow && o.shadow.map) rt(o.shadow.map);   // lazily allocated on the first shadow frame
  };
  const walk = e => { const o = e && (e.mesh || e.sprite || e.group || e); if (o && o.traverse) o.traverse(hold); };
  // The composer is handed over as one object, so the census digs for the resources
  // hanging off its passes rather than naming three.js's own field layout. Depth-limited
  // and cycle-guarded; Object3Ds hand back to the traverse above, and the renderer and
  // the DOM are dead ends on purpose (walking a canvas element enumerates hundreds of
  // accessors and reaches nothing the game owns).
  const been = new Set();
  const deep = (o, d) => {
    if (!o || typeof o !== 'object' || d > 6 || been.has(o) || o.nodeType || o.isWebGLRenderer) return;
    been.add(o);
    if (o.isBufferGeometry) { if (uploaded(o)) gSeen.add(o.id); return; }
    if (o.isTexture)        { if (uploaded(o)) tSeen.add(o.id); return; }
    if (o.isWebGLRenderTarget) { rt(o); return; }
    if (o.isObject3D)       { o.traverse(hold); return; }
    if (o.isMaterial)       { mat(o); return; }
    if (Array.isArray(o))   { for (const v of o) deep(v, d + 1); return; }
    if (o instanceof Set || o instanceof Map) { o.forEach(v => deep(v, d + 1)); return; }
    for (const k in o) deep(o[k], d + 1);
  };
  p.scene.traverse(hold);
  for (const k in p.pools) p.pools[k].forEach(walk);
  for (const k in p.live) p.live[k].forEach(walk);
  for (const o of p.gpuShared || []) deep(o, 0);
  return {
    t: performance.now(),
    sceneChildren: p.scene.children.length,
    live: counts(p.live),
    pools: counts(p.pools),
    census: { pointLights, meshes, sprites },
    gpu: { geometries: info.memory.geometries, textures: info.memory.textures,
           reachGeo: gSeen.size, reachTex: tSeen.size,
           programs: info.programs ? info.programs.length : -1,
           calls: info.render.calls, triangles: info.render.triangles },
    state: JSON.parse(JSON.stringify(p.state)),
    mods: JSON.parse(JSON.stringify(p.mods)),
    player: { hp: p.player.hp, maxHp: p.player.maxHp, invuln: +p.player.invuln.toFixed(3) },
    // Item 64 — the two things a restart taken DURING the boss intro leaves behind. Neither
    // lives on state or in the DOM: the countdown is a module-level let that animate()
    // owns, and the FOV punch is written straight onto the camera. The || 0 is there
    // because --url can point at a build older than the getter.
    // (No backticks in this string: SNAPSHOT is itself a template literal.)
    anim: { bossIntroT: +(p.bossIntroT || 0).toFixed(2), fov: +p.camera.fov.toFixed(2) },
    // Item 82 — the arena is rebuilt between waves from a pure function of the wave
    // number. One compact signature of the LIVE obstacle list covers the whole promise
    // (no backticks in this string: SNAPSHOT is itself a template literal):
    // it is identical at t = 0 of every run (so the reset diff above polices it for
    // free), it is reproducible per seed, and it is what the arena scenario compares
    // across waves. The || guards keep --url pointed at an older build from throwing.
    arena: {
      name: (p.arena || {}).name || '', wave: (p.arena || {}).wave || 0,
      count: (p.obstacles || []).length,
      sig: (p.obstacles || []).map(o => [o.mesh.position.x, o.mesh.position.z, o.hw, o.hd, o.h]
             .map(v => Math.round(v * 10) / 10).join(',')).join('|'),
    },
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
  // `reachGeo`/`reachTex` move with them, for the same reason and by the same amount.
  'gpu.geometries', 'gpu.textures', 'gpu.reachGeo', 'gpu.reachTex',
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

// A leak is an uploaded GPU resource the game can no longer reach: `disposeEnemy` not
// called leaves the geometry in the renderer's registry with nothing pointing at it.
// That number — `info.memory` minus SNAPSHOT's census — is what this asserts on, and it
// must be ZERO. Not "must not grow": every root the game has is walked, so on a clean
// build every counted resource is reached and there is nothing left over to tolerate.
//
// Item 89 — why it is an absolute and not a difference. It used to diff `info.memory`
// itself against "how many objects the pools minted", and that was structurally flaky:
// info.memory counts a resource when it is first RENDERED, not when it is created, so a
// shared singleton the run happened not to draw until the second leg (a wasp's cone, a
// splitter's mini) read as "+1 geometry, 0 new pooled objects" — red on a commit that
// changed nothing. Measured over 16 headless CI-shape runs of one unchanged build, that
// first-draw noise moved `geometries` 42–47 and `textures` 19–24 between two t = 0
// snapshots, and the old check's pooled allowance swung 0/4/7/22/33/40/56/58 — whether a
// +1 passed depended on where that number landed. Under the census the leftover is 0 at
// every sample of every scenario, on a cold boot and 24 s into a wave alike.
//
// It fails on exactly two things, and both deserve a red run: a resource nothing
// disposed, and a shared singleton missing from `__probe.gpuShared` (which is the same
// bug seen from the harness — the game can reach it, but it never said so).
export function gpuAccounted(prev, next) {
  const over = [];
  for (const [count, reach] of [['geometries', 'reachGeo'], ['textures', 'reachTex']]) {
    const before = prev.gpu[count] - prev.gpu[reach], after = next.gpu[count] - next.gpu[reach];
    if (after > 0) over.push(`${count}: ${after} of ${next.gpu[count]} counted are uploaded but ` +
      `unreachable (${before} before this leg) — nothing disposed them, or a shared one is ` +
      `missing from __probe.gpuShared`);
  }
  return { over, unreachable: { geometries: next.gpu.geometries - next.gpu.reachGeo,
                                textures: next.gpu.textures - next.gpu.reachTex } };
}
