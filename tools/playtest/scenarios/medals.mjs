// Medals (roadmap item 41). Everything in the item's "Done when" that a machine can
// settle: a medal fires once, persists across a reload, never re-toasts on a later run,
// two medals unlocking in the same moment queue instead of overlapping, and the death
// recap grid separates earned from unearned.
//
// Two of the ten medals sit behind lifetime thresholds (1,000 kills, 5,000 style) and two
// behind long horizons (10 finished runs, 10 rocket multi-kills), so this scenario SEEDS
// the persistent blob to one event short of each. That seeding is the whole point: without
// it those four are unreachable inside a 45-second run and would ship unverified.
//
// It runs last on purpose — it reloads the page and rewrites `neonstrike.medals`, so it
// must not disturb the leak diffs or the frame-time sample.

const sleep = ms => new Promise(r => setTimeout(r, ms));

const TOAST = `const t = document.getElementById('medaltoast');
  return JSON.stringify({ show: t.classList.contains('show'),
                          name: document.getElementById('mt-name').textContent });`;

export default async function medals(ctx) {
  const toast = () => ctx.eval(TOAST).then(JSON.parse);

  // What the soak + perf runs earned by simply playing. Seed-dependent, so it is reported
  // rather than asserted — the point is that a session can see the organic path firing.
  const organic = await ctx.eval('return Object.keys(window.__probe.medals.earned).join(",");');
  ctx.log(`earned by ordinary play in the runs above: ${organic || '(none)'}`);

  // ------------------------------------------------------------------ seeded profile
  await ctx.eval(`const m = window.__probe.medals;
    for (const k of Object.keys(m.earned)) delete m.earned[k];
    m.kills = 999; m.style = 4999; m.runs = 9; m.rockets = 9;
    localStorage.setItem('neonstrike.medals', JSON.stringify(m)); return true;`);

  // ------------------------------------------------------------------ toast queue
  // Both awards land in ONE javascript turn — the same-moment case from the spec.
  // perf forces turbo back to 1 for its sample; nothing here is timed, so wind it up —
  // otherwise waiting for enemies to close in takes real minutes.
  await ctx.eval(`const p = window.__probe; p.driven = true; p.turbo = 8; p.fn.startGame();
    p.fn.awardMedal('exterminator'); p.fn.awardMedal('stylist'); return true;`);
  let t = await toast();
  ctx.check('two medals at once: the first one shows', t.show && /EXTERMINATOR/.test(t.name), t.name);
  await sleep(1200);
  t = await toast();
  ctx.check('two medals at once: the second does not overwrite it mid-display',
            /EXTERMINATOR/.test(t.name), t.name);
  await ctx.waitFor(`/STYLIST/.test(document.getElementById('mt-name').textContent)`,
                    { timeout: 8_000, label: 'the queued second toast', poll: 150 });
  t = await toast();
  ctx.check('two medals at once: the second toasts after the first', t.show && /STYLIST/.test(t.name), t.name);

  // ------------------------------------------------------------------ fires once
  await ctx.waitFor(`!document.getElementById('medaltoast').classList.contains('show')`,
                    { timeout: 8_000, label: 'the toast to clear', poll: 150 });
  await ctx.eval(`window.__probe.fn.awardMedal('exterminator'); return true;`);
  t = await toast();
  ctx.check('an already-earned medal does not toast again', !t.show, t.name);

  // ------------------------------------------------------------------ blast multi-kill
  // NOVA exercises the gated blast counter that DEMOLITIONIST shares. E is handled by a
  // real keydown listener rather than the polled key map, so dispatch a real event.
  await ctx.eval(`window.__probe.turbo = 8; window.__probe.fn.startWave(4); return true;`);
  const nearby = () => ctx.eval(`const p = window.__probe;
    p.player.hp = p.player.maxHp;   // the harness does not dodge; keep it alive to the blast
    return p.enemies.filter(e => Math.hypot(e.mesh.position.x - p.player.pos.x,
                                            e.mesh.position.z - p.player.pos.z) < 15).length;`);
  let near = 0;
  for (let i = 0; i < 300 && near < 4; i++) { near = await nearby(); if (near < 4) await sleep(120); }
  const killsBefore = await ctx.eval('return window.__probe.medals.kills;');
  await ctx.eval(`window.__probe.state.ult = 100;
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }));
    return true;`);
  await sleep(600);
  ctx.check('NOVA fires on a 3+ multi-kill (the blast counter counts, and only in a blast)',
            await ctx.eval('return !!window.__probe.medals.earned.nova;'), `${near} enemies in radius`);
  const killsAfter = await ctx.eval('return window.__probe.medals.kills;');
  ctx.check('the lifetime kill counter climbs on kills', killsAfter > killsBefore, `${killsBefore} → ${killsAfter}`);

  // ------------------------------------------------------------------ SURVIVOR
  await ctx.eval(`window.__probe.fn.startWave(15); return true;`);
  ctx.check('SURVIVOR fires on reaching wave 15',
            await ctx.eval('return !!window.__probe.medals.earned.survivor;'));

  // ------------------------------------------------------------------ UNTOUCHABLE's flag
  await ctx.eval(`window.__probe.fn.startWave(6); return true;`);
  const clean1 = await ctx.eval('return window.__probe.state.waveClean;');
  await ctx.eval(`window.__probe.fn.damagePlayer(1); return true;`);
  const clean2 = await ctx.eval('return window.__probe.state.waveClean;');
  ctx.check('UNTOUCHABLE: a new wave starts clean and any hit taken ends it',
            clean1 === true && clean2 === false, `startWave→${clean1}, after a hit→${clean2}`);

  // ------------------------------------------------------------------ recap grid
  await ctx.eval(`window.__probe.player.hp = window.__probe.player.maxHp;
    window.__probe.fn.gameOver(); return true;`);
  await sleep(300);
  const g = JSON.parse(await ctx.eval(`const el = document.getElementById('overMedals');
    return JSON.stringify({
      total: el.children.length,
      got: Array.from(el.querySelectorAll('.medal.got b')).map(b => b.textContent),
      earnedSayEarned: Array.from(el.querySelectorAll('.medal.got i')).every(i => i.textContent === 'EARNED'),
      unearnedShowHints: Array.from(el.querySelectorAll('.medal:not(.got)'))
        .every(d => d.querySelector('i').textContent.length > 0),
      toastShown: document.getElementById('medaltoast').classList.contains('show') });`));
  ctx.check('the recap grid renders every medal', g.total === 10, `${g.total} cells`);
  ctx.check('VETERAN lands on the 10th finished run', g.got.includes('VETERAN'), g.got.join(', '));
  const SEEDED = ['EXTERMINATOR', 'STYLIST', 'NOVA', 'SURVIVOR', 'VETERAN'];
  ctx.check('earned medals are stamped, unearned ones carry their hint',
            g.earnedSayEarned && g.unearnedShowHints && SEEDED.every(n => g.got.includes(n)) &&
            g.got.length < 10, g.got.join(', '));
  ctx.check('no medal toast survives onto the death card', !g.toastShown);
  const runs = await ctx.eval('return window.__probe.medals.runs;');
  ctx.check('the run counter is flushed at gameOver', runs === 10, `runs=${runs}`);

  // ------------------------------------------------------------------ across a reload
  await ctx.reload();
  const after = JSON.parse(await ctx.eval('return JSON.stringify(window.__probe.medals);'));
  ctx.check('earned medals survive a reload',
            ['exterminator', 'stylist', 'nova', 'survivor', 'veteran'].every(k => after.earned[k]),
            Object.keys(after.earned).join(', '));
  ctx.check('lifetime counters survive a reload', after.kills > 999 && after.runs === 10,
            `kills=${after.kills} runs=${after.runs}`);
  await ctx.eval(`const p = window.__probe; p.driven = true; p.fn.startGame();
    p.fn.awardMedal('veteran'); p.fn.awardMedal('exterminator'); return true;`);
  t = await toast();
  ctx.check('a later run never re-toasts a medal earned in an earlier one', !t.show, t.name);

  // ------------------------------------------------------------------ a fresh profile
  await ctx.eval(`localStorage.removeItem('neonstrike.medals'); return true;`);
  await ctx.reload();
  await ctx.eval(`const p = window.__probe; p.driven = true; p.fn.startGame(); p.fn.gameOver(); return true;`);
  await sleep(300);
  const fresh = JSON.parse(await ctx.eval(`const el = document.getElementById('overMedals');
    return JSON.stringify({ total: el.children.length, got: el.querySelectorAll('.medal.got').length,
                            hint: el.querySelector('.medal i').textContent });`));
  ctx.check('a fresh profile shows ten unearned stamps, each with its hint',
            fresh.total === 10 && fresh.got === 0 && fresh.hint.length > 0, JSON.stringify(fresh));
}
