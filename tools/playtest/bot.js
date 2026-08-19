/* In-page autoplay bot. Injected as a plain script by run.mjs — not a module.
 *
 * It reads and writes ONLY through window.__probe (the test API published at the
 * bottom of index.html). No scene-graph fingerprinting: an earlier generation of
 * this rig identified enemies as "scene-level mesh, flat-shaded MeshStandardMaterial,
 * at least one child", which every visual item was one gib/pickup/prop away from
 * breaking — silently, by simply finding no enemies and reporting a clean run.
 *
 * Synthetic mouse events cannot obtain pointer lock, which is why the bot steers by
 * writing yaw/pitch instead of dispatching mousemove, and why the game's firing gate
 * accepts `probe.driven` in place of a real lock.
 */
window.__bot = (() => {
  const cfg = { weaponEvery: 5, forceWeapon: null, move: true };
  let raf = 0, running = false, tPrev = 0;
  let wIdx = 0, wSwapAt = 0, strafe = 1, strafeAt = 0, jumpAt = 0, chooseAt = 0;
  const stats = { ticks: 0, upgradesTaken: 0, weaponSwaps: 0, maxEnemies: 0 };

  const nearest = p => {
    let best = null, bestD = Infinity;
    for (const e of p.live.enemies) {
      if (!e.mesh || !e.mesh.parent) continue;
      const q = e.mesh.position;
      const d = (q.x - p.player.pos.x) ** 2 + (q.z - p.player.pos.z) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best ? { e: best, dist: Math.sqrt(bestD) } : null;
  };

  const release = p => { p.setFire(false); for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']) p.setKey(k, false); };

  function tick() {
    raf = requestAnimationFrame(tick);
    const p = window.__probe;
    if (!p) return;
    stats.ticks++;
    const now = performance.now() / 1000;
    const dt = tPrev ? now - tPrev : 0;
    tPrev = now;

    // Upgrade cards: take one after a beat, so the card is genuinely on screen for a
    // frame or two (a same-frame pick would never exercise showUpgrades' animation).
    if (p.state.choosing) {
      release(p);
      if (!chooseAt) chooseAt = now;
      if (now - chooseAt > 0.3) { chooseAt = 0; stats.upgradesTaken++; p.fn.pickUpgrade(stats.upgradesTaken % 3); }
      return;
    }
    chooseAt = 0;
    if (!p.state.running || p.state.paused) { release(p); return; }

    // Weapon cycling on GAME time, not wall time, so turbo does not turn a swap
    // every 5s into a swap every 30 game-seconds. A blaster-only bot under-tests
    // particle and light load — that was item 22's verification gap.
    if (cfg.forceWeapon === null) {
      if (p.state.time > wSwapAt) {
        wSwapAt = p.state.time + cfg.weaponEvery;
        wIdx = (wIdx + 1) % p.weapons.length;
        stats.weaponSwaps++;
        p.fn.selectWeapon(wIdx);
      }
    } else if (p.currentWeapon !== cfg.forceWeapon) {
      p.fn.selectWeapon(cfg.forceWeapon);
    }

    const live = p.live.enemies.length;
    if (live > stats.maxEnemies) stats.maxEnemies = live;

    const target = nearest(p);
    if (target) {
      const q = target.e.mesh.position;
      p.lookAt(q.x, q.y, q.z);
    } else {
      p.player.yaw += dt * 1.4;          // sweep the arena while the next wave spawns
      p.player.pitch = 0;
    }

    const w = p.weapons[p.currentWeapon];
    if (w.mag <= 0 && !p.reloading) p.fn.reload();
    p.setFire(!!target && !p.reloading && w.mag > 0);

    if (cfg.move) {
      // Strafe constantly (dodges shooters, keeps the camera moving so bloom and
      // motion-dependent effects are actually exercised), close the gap when the
      // nearest enemy is far, back off when something is in our face.
      if (now > strafeAt) { strafe = -strafe; strafeAt = now + 0.8 + Math.random() * 1.2; }
      p.setKey('KeyA', strafe < 0);
      p.setKey('KeyD', strafe > 0);
      p.setKey('KeyW', !!target && target.dist > 18);
      p.setKey('KeyS', !!target && target.dist < 6);
      if (now > jumpAt) { jumpAt = now + 3 + Math.random() * 4; p.setKey('Space', true); setTimeout(() => p.setKey('Space', false), 120); }
    }
  }

  return {
    start(opts = {}) {
      Object.assign(cfg, opts);
      if (running) return;
      running = true; tPrev = 0; wSwapAt = 0;
      window.__probe.driven = true;
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      if (window.__probe) release(window.__probe);
    },
    stats: () => ({ ...stats }),
    cfg,
  };
})();
