// Card reachability on short viewports (roadmap items 67 and 70).
//
// The bug this exists to prevent: the title card grew (attract loop, name entry, a
// second death-screen button) until `ENTER ARENA` sat below the fold inside the card's
// own `max-height:94vh` scroll box, and `document.elementFromPoint` at its centre
// returned `#overlay`. Items 47, 56 and 57 each hit it, and item 47 papered over it
// with an oversized viewport — which is exactly why no automated run ever saw it.
//
// So this scenario asserts the primary CTA of each card is HIT-TESTABLE at heights a
// laptop and a phone in landscape actually have, and clicks the real button to start a
// run at 1280x700 rather than trusting the hit test alone. Item 70 added the death
// card's first-timer NAME row, which item 67 could only log — see nameRowReachable.
//
// It runs LAST, for the same two reasons `medals` does — it reloads the page and it
// changes the canvas size, so it must not perturb the leak diffs or the FPS sample.
//
// Touch emulation needs the reload: `isTouch` is a boot-time const in index.html
// (`(pointer: coarse)`), so metrics alone would measure the desktop layout at phone
// size and leave the `touch-action:pan-y` half of the fix unexercised. The teardown
// reload is just as load-bearing — a leftover `isTouch === true` routes firing through
// `touchFire` and any later scenario would silently stop shooting.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), '.playtest');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1280x700: a 13" laptop with browser chrome. 844x390: iPhone 14-class in landscape,
// the shortest thing the game is expected to be playable on. 1280x950 is item 70's
// CONTROL — the height at which the death card fits and nothing should have to scroll;
// it is here so a future fix for a short viewport cannot quietly start moving a tall one
// (and because with the global board rendered even 950 overflows, which 700 and 390 do
// not distinguish: they overflow before the board lands).
const VIEWPORTS = [
  { name: 'laptop 1280x700',        width: 1280, height: 700, touch: false },
  { name: 'mobile landscape 844x390', width: 844, height: 390, touch: true },
  { name: 'desktop 1280x950',       width: 1280, height: 950, touch: false },
];

// The whole assertion, in the page: the button's own centre must hit the button, and
// the button must lie inside the viewport rather than clipped past its edge.
const hit = sel => `const b = document.querySelector('${sel}');
  if (!b) return JSON.stringify({ found: false });
  const r = b.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return JSON.stringify({ found: true, same: el === b, hit: el ? (el.id || el.tagName) : 'null',
    top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight,
    left: r.left, width: r.width, height: r.height,
    inView: r.top >= 0 && r.bottom <= innerHeight && r.width > 0 });`;

async function reachable(ctx, label, sel) {
  const r = JSON.parse(await ctx.eval(hit(sel)));
  if (!r.found) { ctx.check(`${label}: ${sel} exists`, false); return null; }
  ctx.check(`${label}: ${sel} is clickable`, r.same && r.inView,
            `hit #${r.hit}, y ${r.top}..${r.bottom} of ${r.vh}`);
  return r;
}

// The first-timer NAME row (item 70). It is not a sticky footer, so it is reachable only
// because `revealNameRow()` scrolls the card to it — which means asserting the row is
// SHOWN, that its two live targets hit-test as themselves inside the viewport (the
// pre-fix build failed exactly here: geometrically inside the scrollport, but painted
// under #overBtns' sticky band, so `elementFromPoint` returned the footer), and that the
// touch leg did NOT focus the field — autofocus there throws the on-screen keyboard over
// the recap, which is the reason the touch path has no focus call to begin with.
async function nameRowReachable(ctx, vp, label) {
  const nr = JSON.parse(await ctx.eval(`const n = document.getElementById('nameRow');
    const c = document.getElementById('overCard'); const r = n.getBoundingClientRect();
    return JSON.stringify({ shown: n.style.display !== 'none', scrollTop: Math.round(c.scrollTop),
      top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight,
      focused: document.activeElement === document.getElementById('handleInput') });`));
  ctx.log(`${vp.name} — ${label}: ${nr.shown ? 'shown' : 'hidden'}, y ${nr.top}..${nr.bottom} ` +
          `of ${nr.vh} (card scrolled ${nr.scrollTop}px, field focused: ${nr.focused})`);
  ctx.check(`${vp.name}: ${label} is shown`, nr.shown);
  if (!nr.shown) return;
  await reachable(ctx, `${vp.name} ${label}`, '#handleInput');
  await reachable(ctx, `${vp.name} ${label}`, '#submitName');
  if (vp.touch) ctx.check(`${vp.name}: ${label} does not autofocus (no on-screen keyboard)`, !nr.focused);
}

// A REAL click, at the coordinates the hit test just measured. `el.click()` is not a
// substitute and this scenario is the proof: on the pre-fix build the synthetic call
// still started a run with the button 100px below the viewport, so only a dispatched
// input event tests what a player can actually reach.
async function clickAt(ctx, r) {
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  await ctx.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await ctx.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

export default async function layout(ctx) {
  for (const vp of VIEWPORTS) {
    await ctx.send('Emulation.setDeviceMetricsOverride',
                   { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.touch });
    await ctx.send('Emulation.setTouchEmulationEnabled', { enabled: vp.touch, maxTouchPoints: 5 });
    // Reload so `isTouch` and `body.touch` are re-derived under the emulated device,
    // and so every leg starts from the title card in the same state.
    await ctx.reload();
    await ctx.waitFor(`innerHeight === ${vp.height} && !document.getElementById('startCard').classList.contains('hidden')`,
                      { timeout: 10_000, label: `${vp.name} title card`, poll: 100 });
    await sleep(150);   // one paint at the new size before anything is measured
    await ctx.eval('window.__probe.driven = true; return true;');
    const touched = await ctx.eval('return document.body.classList.contains("touch");');
    ctx.log(`${vp.name} — body.touch=${touched}, card ${await ctx.eval(
      `const c = document.getElementById('startCard');
       return c.scrollHeight + 'px of content in ' + c.clientHeight + 'px';`)}`);

    // ---------------------------------------------------------------- title card
    const startRect = await reachable(ctx, vp.name, '#startBtn');
    await shot(ctx, `title-${vp.width}x${vp.height}`);

    // The hit test says the pixel belongs to the button; this says the game actually
    // starts from a real click at that size — the thing item 47's viewport override hid.
    if (startRect) await clickAt(ctx, startRect);
    const running = await ctx.eval('return window.__probe.state.running === true;');
    ctx.check(`${vp.name}: clicking ENTER ARENA starts a run`, running);

    // ---------------------------------------------------------------- death card
    // Reported, not asserted: the upgrade screen is not in this item's scope, but it is
    // the same class of bug and a session should see the number. Unhidden and re-hidden
    // inside one JS turn, so nothing paints.
    if (running) {
      // Opened for real through `__probe.fn`, then dismissed by taking the first card —
      // an upgrade screen faked by un-hiding the element measures an empty container.
      // `showUpgrades` landed with this scenario, so a `--url` smoke of an older build
      // (the live site mid-rollback, an older tag) has to skip it rather than throw an
      // exception the harness would report as "the page logged an error".
      const canUpgrade = await ctx.eval('return typeof window.__probe.fn.showUpgrades === "function";');
      if (!canUpgrade) ctx.log(`${vp.name} — build predates __probe.fn.showUpgrades; upgrade screen not measured`);
      const up = !canUpgrade ? null : JSON.parse(await ctx.eval(`window.__probe.fn.showUpgrades();
        const cards = [...document.querySelectorAll('#upcards .upcard')];
        const box = cards.map(c => c.getBoundingClientRect());
        const off = box.filter(r => r.top < 0 || r.bottom > innerHeight).length;
        const hits = box.map(r => { const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                                    return el && el.closest('.upcard') ? 'card' : (el ? (el.id || el.tagName) : 'null'); });
        const reroll = document.getElementById('rerollBtn').getBoundingClientRect();
        window.__probe.fn.pickUpgrade(0);
        return JSON.stringify({ cards: cards.length, off, hits: hits.join(','),
          h: box.length ? Math.round(box[0].height) : 0, vh: innerHeight,
          rerollBottom: Math.round(reroll.bottom) });`));
      if (up) ctx.log(`${vp.name} — upgrade screen: ${up.cards} card(s) ${up.h}px tall, ${up.off} clipped, ` +
                      `centres hit ${up.hits}, REROLL ends at y=${up.rerollBottom} of ${up.vh}`);

      await ctx.eval('window.__probe.fn.gameOver(); return true;');
      await ctx.waitFor(`!document.getElementById('overCard').classList.contains('hidden')`,
                        { timeout: 10_000, label: 'the death card', poll: 100 });
      await sleep(150);
      await reachable(ctx, vp.name, '#againBtn');
      await reachable(ctx, vp.name, '#titleBtn');
      await nameRowReachable(ctx, vp, 'first-timer name row');
      await shot(ctx, `death-${vp.width}x${vp.height}`);

      // …and again once the global board lands UNDER the row. `make playtest` is
      // static, so the real rank GET 404s and this case never happens on its own —
      // `__probe.fn.renderGlobalBoard` (item 70) draws the same DOM with no network.
      // This is the half of the fix that a green run would otherwise never touch:
      // the board grows the card after the row was already revealed.
      const canBoard = await ctx.eval('return typeof window.__probe.fn.renderGlobalBoard === "function";');
      if (!canBoard) ctx.log(`${vp.name} — build predates __probe.fn.renderGlobalBoard; board-lands-late case not measured`);
      else {
        await ctx.eval(`const top = Array.from({ length: 10 }, (_, i) => (
            { name: 'PILOT' + i, score: 9000 - i * 100, wave: 12 - i }));
          window.__probe.fn.renderGlobalBoard({ top, total: 42, rank: 7 }, null, 0, 1);
          return true;`);
        await sleep(150);
        await nameRowReachable(ctx, vp, 'name row survives the board');
        await shot(ctx, `death-board-${vp.width}x${vp.height}`);
      }
      await ctx.eval('window.__probe.fn.returnToTitle(); return true;');
    }
  }

  // ---------------------------------------------------------------- teardown
  await ctx.send('Emulation.clearDeviceMetricsOverride');
  await ctx.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
  await ctx.reload();   // NOT optional — see the header: `isTouch` is decided at boot
  const back = await ctx.eval('return !document.body.classList.contains("touch") && innerHeight > 600;');
  ctx.check('viewport emulation cleared', back, `innerHeight ${await ctx.eval('return innerHeight;')}`);
}

// The one thing here a human still has to judge — whether the compressed card and the
// sticky footer LOOK right — so leave the frames behind for them.
async function shot(ctx, name) {
  try {
    mkdirSync(OUT, { recursive: true });
    const s = await ctx.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `layout-${name}.png`), Buffer.from(s.data, 'base64'));
  } catch { /* a screenshot is a courtesy, never a reason to fail a run */ }
}
