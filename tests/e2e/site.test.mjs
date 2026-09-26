// End-to-end checks on the built dist/ in headless Chrome: it loads without console errors,
// WebGL draws the rope, the presets are identified, drawing / flipping / relaxing / sharing
// work, hostile links are refused quickly, and the page fits a true 400 px phone screen.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../../scripts/cdp.mjs';
import { headersFor, parseHeaders, startServer } from '../../scripts/serve.mjs';
import { encodeKnot, quantise } from '../../src/topology/share.ts';
import { fitToRadius, resampleClosed } from '../../src/topology/geometry.ts';
import { torusKnotCurve, trefoilCurve } from '../../src/topology/presets.ts';

const dist = fileURLToPath(new URL('../../dist', import.meta.url));
let server;
let base;

before(async () => {
  await stat(`${dist}/index.html`);
  server = await startServer(dist, 0);
  base = `http://127.0.0.1:${server.address().port}/`;
});

after(() => server?.close());

async function withPage(opts, fn) {
  const b = await launch(opts);
  try {
    return await fn(b);
  } finally {
    await b.close();
  }
}

const summary = (b) => b.evaluate('window.__knot.summary()');

async function waitIdle(b, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!(await b.evaluate('window.__knot.summary().busy'))) return;
    await sleep(100);
  }
  throw new Error('page stayed busy');
}

test('loads with no console errors and WebGL 2 draws the rope', async () => {
  await withPage({ width: 1280, height: 800 }, async (b) => {
    await b.goto(base);
    const s = await summary(b);
    assert.equal(s.headline, 'Consistent with the trefoil (3₁)');
    assert.equal(s.crossings, 3);
    await sleep(300);
    const probe = await b.evaluate('window.__knot.probe()');
    assert.equal(probe.webgl2, true, 'WebGL 2 context');
    assert.ok(probe.inkPixels > 200, `ink pixels drawn: ${probe.inkPixels}`);
    assert.equal(await b.evaluate('document.querySelectorAll("#overlay .callout").length'), 3);
    assert.deepEqual(b.problems, []);
  });
});

test('every plate is identified', async () => {
  const expected = {
    unknot: 'The unknot (0₁)',
    trefoil: 'Consistent with the trefoil (3₁)',
    'figure-eight': 'Consistent with the figure-eight knot (4₁)',
    cinquefoil: 'Consistent with the cinquefoil (5₁)',
    'three-twist': 'Consistent with the three-twist knot (5₂)',
    tangled: 'Consistent with the unknot (0₁)',
  };
  await withPage({ width: 1280, height: 800 }, async (b) => {
    await b.goto(base);
    for (const [id, headline] of Object.entries(expected)) {
      await b.click(`.preset[data-id="${id}"]`);
      await sleep(80);
      assert.equal((await summary(b)).headline, headline, id);
      // On the page the subscripts are real <sub> elements, so compare with plain digits.
      const plain = headline.replace(/[₀-₉]/g, (c) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(c)));
      assert.equal(await b.evaluate('document.getElementById("verdict-head").textContent'), plain);
    }
    assert.deepEqual(b.problems, []);
  });
});

/** A trefoil shadow drawn by hand across the figure, in page coordinates. */
async function trefoilPath(b) {
  const r = await b.evaluate('(() => { const r = document.getElementById("figure").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()');
  const [x, y, w, h] = r;
  const cx = x + w / 2, cy = y + h / 2, s = Math.min(w, h) / 8.5;
  const pts = [];
  for (let i = 0; i <= 160; i++) {
    const t = (2 * Math.PI * i) / 160 * 0.98 + 0.3;
    pts.push([cx + s * (Math.sin(t) + 2 * Math.sin(2 * t)), cy - s * (Math.cos(t) - 2 * Math.cos(2 * t))]);
  }
  return pts;
}

test('draw a knot, flip a crossing, relax it, share it', async () => {
  await withPage({ width: 1280, height: 800 }, async (b) => {
    await b.goto(base);
    await b.click('#btn-draw');
    assert.equal((await summary(b)).mode, 'draw');
    await b.evaluate('window.scrollTo(0, 0)');
    await b.drag(await trefoilPath(b));
    await sleep(150);
    let s = await summary(b);
    assert.equal(s.mode, 'look');
    assert.equal(s.crossings, 3);
    assert.equal(s.headline, 'Consistent with the trefoil (3₁)');

    // Tap callout 2 on the figure: the drawing unties.
    await b.click('#overlay .callout[data-id="2"] .badge');
    await sleep(150);
    s = await summary(b);
    assert.equal(s.crossings, 3);
    assert.equal(s.delta, '1');
    assert.equal(s.headline, 'Consistent with the unknot (0₁)');
    assert.equal(s.selected, 2);
    assert.equal(await b.evaluate('document.querySelector("#overlay .callout.is-current")?.dataset.id'), '2');

    // Flip it back with the keyboard-reachable list button.
    await b.click('#crossing-list button.flip[data-id="2"]');
    await sleep(150);
    assert.equal((await summary(b)).delta, 't² − t + 1');

    // Relax: the knot must survive.
    await b.click('#btn-relax');
    await waitIdle(b);
    s = await summary(b);
    assert.equal(s.delta, 't² − t + 1');
    assert.match(s.headline, /trefoil/);

    // Share, then open the link fresh: same diagram, same polynomial.
    await b.click('#btn-share');
    await sleep(100);
    const url = await b.evaluate('location.href');
    assert.match(url, /#k=1\./);
    const before = await summary(b);
    await withPage({ width: 1280, height: 800 }, async (c) => {
      await c.goto(url);
      const after = await summary(c);
      assert.equal(after.pd, before.pd);
      assert.equal(after.delta, before.delta);
      assert.deepEqual(c.problems, []);
    });
    assert.deepEqual(b.problems, []);
  });
});

test('turning the figure changes the diagram but never the polynomial', async () => {
  await withPage({ width: 1280, height: 800 }, async (b) => {
    await b.goto(base);
    await b.click('.preset[data-id="figure-eight"]');
    await b.evaluate('document.getElementById("figure").focus()');
    const pds = new Set();
    for (let i = 0; i < 6; i++) {
      await b.key('ArrowRight');
      await b.key('ArrowDown');
      await sleep(40);
      const s = await summary(b);
      assert.equal(s.delta, '−t² + 3t − 1');
      pds.add(s.pd);
    }
    assert.ok(pds.size > 1, 'the diagram changed as it turned');
    await b.click('#btn-simplest');
    await waitIdle(b);
    const s = await summary(b);
    assert.equal(s.delta, '−t² + 3t − 1');
    assert.ok(s.crossings >= 4);
    assert.deepEqual(b.problems, []);
  });
});

test('bad and hostile links get a clear message and never hang the tab', async () => {
  // The (5, 41) torus knot: a valid rope with 164 crossings from above.
  const pts = new Float64Array(480 * 3);
  for (let i = 0; i < 480; i++) {
    const t = (2 * Math.PI * i) / 480;
    const r = 6 + 2.5 * Math.cos(41 * t);
    pts.set([r * Math.cos(5 * t), r * Math.sin(5 * t), 2.5 * Math.sin(41 * t)], 3 * i);
  }
  const monster = `#${encodeKnot(pts, [0, 0, 0, 1])}`;
  const cases = [
    ['#k=1.' + 'A'.repeat(200_000), /too long/],
    ['#k=1.%%%', /not in the knot format/],
    ['#k=9.AAAA', /version 9/],
    ['#k=1.AQj_____', /damaged|points|view/],
  ];
  await withPage({ width: 1280, height: 800 }, async (b) => {
    let visit = 0;
    for (const [hash, re] of cases) {
      const t0 = Date.now();
      // A fresh query string forces a full page load for each link.
      await b.goto(`${base}?v=${visit++}${hash}`, { readyTimeout: 8000 });
      assert.ok(Date.now() - t0 < 8000);
      // The note must actually be on screen, not just present in the DOM.
      const note = await b.evaluate(
        '(n => (n.hidden || getComputedStyle(n).display === "none" || n.getBoundingClientRect().height < 10) ? "[not shown]" : n.innerText)(document.getElementById("figure-note"))',
      );
      assert.match(note, /couldn't be read/, `${hash.slice(0, 20)}: ${note}`);
      assert.match(note, re);
      assert.equal((await summary(b)).headline, 'Consistent with the trefoil (3₁)');
    }
    const t0 = Date.now();
    await b.goto(`${base}?v=${visit++}${monster}`, { readyTimeout: 8000 });
    assert.ok(Date.now() - t0 < 8000, 'monster link handled in time');
    const s = await summary(b);
    assert.equal(s.crossings, 164);
    assert.equal(s.delta, null);
    assert.match(await b.evaluate('document.getElementById("verdict-detail").textContent'), /stops at 100/);
    assert.equal(s.callouts, 0, 'too many to label');
    assert.deepEqual(b.problems, []);
  });
});

test('true 400 px phone: no sideways scroll, figure and verdict present', async () => {
  await withPage({ width: 400, height: 860, mobile: true, deviceScaleFactor: 2 }, async (b) => {
    await b.goto(base);
    const [sw, iw] = await b.evaluate('[document.documentElement.scrollWidth, window.innerWidth]');
    assert.equal(iw, 400);
    assert.ok(sw <= iw, `scrollWidth ${sw}`);
    const fig = await b.evaluate('document.getElementById("figure").getBoundingClientRect().width');
    assert.ok(fig > 300 && fig <= 400);
    await b.evaluate('document.getElementById("working").open = true');
    await sleep(100);
    const [sw2] = await b.evaluate('[document.documentElement.scrollWidth]');
    assert.ok(sw2 <= 400, `with working open: ${sw2}`);
    assert.deepEqual(b.problems, []);
  });
});

test('reduced motion: no idle sway; otherwise a gentle one', async () => {
  await withPage({ width: 1000, height: 800, reducedMotion: true }, async (b) => {
    await b.goto(base);
    assert.equal((await summary(b)).swaying, false);
  });
  await withPage({ width: 1000, height: 800 }, async (b) => {
    await b.goto(base);
    assert.equal((await summary(b)).swaying, true);
  });
});

test('the flat fallback (no WebGL) still identifies the knot', async () => {
  await withPage({ width: 1000, height: 800 }, async (b) => {
    await b.goto(`${base}?flat`);
    assert.equal((await summary(b)).headline, 'Consistent with the trefoil (3₁)');
    await sleep(200);
    // The whole rope once (outline + core), then halo, outline and core again over each of the 3 crossings.
    assert.equal(await b.evaluate('document.querySelectorAll("#figure svg polygon").length'), 2);
    assert.equal(await b.evaluate('document.querySelectorAll("#figure svg polyline").length'), 9);
    assert.deepEqual(b.problems, []);
  });
});

test('third-party notices ship in dist/ and are linked from the colophon', async () => {
  const text = await readFile(`${dist}/THIRD-PARTY-NOTICES.txt`, 'utf8');
  const three = JSON.parse(await readFile(fileURLToPath(new URL('../../node_modules/three/package.json', import.meta.url)), 'utf8'));
  assert.match(text, new RegExp(`three\\.js ${three.version.replace(/\./g, '\\.')}`));
  assert.match(text, /Copyright © 2010-2026 three\.js authors/);
  assert.match(text, /Permission is hereby granted/);
  for (const font of ['Barlow Condensed', 'Source Serif 4', 'IBM Plex Mono']) assert.match(text, new RegExp(font));
  assert.match(text, /Open Font License/);
  assert.match(text, /Rolfsen/);
  assert.match(text, /KnotInfo/);
  await withPage({ width: 1000, height: 800 }, async (b) => {
    await b.goto(base);
    assert.equal(await b.evaluate('document.querySelector(".colophon a[href=\\"THIRD-PARTY-NOTICES.txt\\"]") !== null'), true);
    const res = await fetch(`${base}THIRD-PARTY-NOTICES.txt`);
    assert.equal(res.status, 200);
  });
});

test('cache rules: long cache only on hashed assets', async () => {
  const rules = parseHeaders(await readFile(`${dist}/_headers`, 'utf8'));
  assert.match(headersFor(rules, '/')['cache-control'] ?? '', /no-cache/);
  assert.match(headersFor(rules, '/index.html')['cache-control'] ?? '', /no-cache/);
  const html = await readFile(`${dist}/index.html`, 'utf8');
  const assets = [...html.matchAll(/assets\/[^"]+/g)].map((m) => m[0]);
  assert.equal(assets.length, 3);
  for (const a of assets) {
    assert.match(a, /-[A-Za-z0-9]{8}\.(js|css)$/, `${a} is content-hashed`);
    assert.match(headersFor(rules, `/${a}`)['cache-control'], /immutable/);
  }
  assert.doesNotMatch(headersFor(rules, '/THIRD-PARTY-NOTICES.txt')['cache-control'] ?? '', /max-age/);
});

/** Signs in the crossing list, as "id:+" strings. */
const signs = (b) => b.evaluate('[...document.querySelectorAll("#crossing-list li")].map((li) => li.dataset.id + ":" + li.querySelector(".desc").textContent.trim()[0])');

test('flipping a crossing changes that crossing and no other (cinquefoil turned 88°)', async () => {
  await withPage({ width: 1280, height: 800, reducedMotion: true }, async (b) => {
    await b.goto(base);
    await b.click('.preset[data-id="cinquefoil"]');
    await b.evaluate('document.getElementById("figure").focus()');
    for (let i = 0; i < 11; i++) await b.key('ArrowDown');
    await sleep(100);
    const start = await signs(b);
    assert.ok(start.length >= 10, `${start.length} crossings`);
    for (let id = 1; id <= start.length; id++) {
      const before = await signs(b);
      await b.evaluate(`document.querySelector('#crossing-list button.flip[data-id="${id}"]').click()`);
      await sleep(60);
      const after = await signs(b);
      const changed = before.filter((x, i) => x !== after[i]).map((x) => Number(x.split(':')[0]));
      assert.deepEqual(changed, [id], `flip ${id}`);
      await b.evaluate(`document.querySelector('#crossing-list button.flip[data-id="${id}"]').click()`);
      await sleep(60);
    }
    assert.deepEqual(await signs(b), start, 'flipping each back restores the diagram');
    assert.deepEqual(b.problems, []);
  });
});

test('twelve relaxes in a row keep the rope its size, and Share still works', async () => {
  await withPage({ width: 1280, height: 800, reducedMotion: true }, async (b) => {
    await b.goto(base);
    await b.click('.preset[data-id="cinquefoil"]');
    const r0 = (await summary(b)).radius;
    for (let k = 0; k < 12; k++) {
      await b.evaluate('document.getElementById("btn-relax").click()');
      await waitIdle(b);
    }
    const s = await summary(b);
    assert.ok(Math.abs(s.radius / r0 - 1) < 0.1, `radius ${s.radius} vs ${r0}`);
    assert.match(s.headline, /cinquefoil/);
    await b.evaluate('document.getElementById("btn-share").click()');
    await sleep(100);
    assert.match(await b.evaluate('document.getElementById("share-url").value'), /#k=1\./);
    assert.deepEqual(b.problems, []);
  });
});

test('dragging a 99-crossing rope leaves the polynomial until the release', async () => {
  const c = quantise(fitToRadius(torusKnotCurve(2, 99, 480), 60));
  await withPage({ width: 1280, height: 800, reducedMotion: true }, async (b) => {
    await b.goto(`${base}#${encodeKnot(c, [0, 0, 0, 1])}`, { readyTimeout: 15000 });
    let s = await summary(b);
    assert.equal(s.crossings, 99);
    assert.notEqual(s.delta, null);
    const headline = s.headline;
    const [x, y] = await b.evaluate('(r => [r.x + r.width / 2, r.y + r.height / 2])(document.getElementById("figure").getBoundingClientRect())');
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    const times = [];
    // Small turns: this torus knot keeps its 99 crossings for about 0.03 rad, then jumps past
    // the 100-crossing cap.
    for (let k = 1; k <= 3; k++) {
      await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + k, y, button: 'left', buttons: 1 });
      // Live analysis runs on the next animation frame (slow under software WebGL): wait for it.
      for (let i = 0; i < 40 && !(await summary(b)).deferred; i++) await sleep(50);
      s = await summary(b);
      assert.equal(s.crossings, 99);
      assert.equal(s.deferred, true, 'polynomial deferred mid-drag');
      assert.equal(s.headline, headline, 'the verdict stays up while dragging');
      times.push(s.ms);
    }
    await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 3, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(300);
    s = await summary(b);
    assert.equal(s.deferred, false);
    assert.notEqual(s.delta, null, 'worked out on release');
    console.log(`# drag analysis ms (polynomial deferred): ${times.map((t) => t.toFixed(1)).join(', ')}; on release: ${s.ms.toFixed(1)}`);
    assert.deepEqual(b.problems, []);
  });
});

test('at 1280×800 the tools, the how-to line and the whole figure are above the fold', async () => {
  await withPage({ width: 1280, height: 800 }, async (b) => {
    await b.goto(base);
    const r = await b.evaluate(
      '["btn-draw", "btn-share", "howline", "figure"].map((id) => { const e = document.getElementById(id).getBoundingClientRect(); return [e.top, e.bottom]; })',
    );
    for (const [top, bottom] of r) assert.ok(top >= 0 && bottom <= 800, `${top}–${bottom}`);
    assert.ok(r[0][1] <= r[3][0], 'Draw a knot sits above the figure');
    const line = await b.evaluate('(e => [e.innerText, Math.round(e.getBoundingClientRect().height)])(document.getElementById("howline"))');
    for (const re of [/turn it/, /Draw a knot/, /flip/]) assert.match(line[0], re);
    assert.ok(line[1] <= 24, `the how-to fits on one line (${line[1]} px tall)`);
  });
});

test('the idle sway pauses while the working is open', async () => {
  await withPage({ width: 1280, height: 800 }, async (b) => {
    await b.goto(base);
    assert.equal((await summary(b)).swaying, true);
    await b.click('#working summary');
    await sleep(50);
    assert.equal(await b.evaluate('document.getElementById("working").open'), true);
    assert.equal((await summary(b)).swaying, false);
    await b.click('#working summary');
    await sleep(50);
    assert.equal((await summary(b)).swaying, true);
  });
});

/** A closed path across the figure, in page coordinates: f maps t in [0, 2π) to [-1, 1]². */
async function figurePath(b, count, f) {
  await b.evaluate('window.scrollTo(0, 0)');
  const [x, y, w, h] = await b.evaluate('(r => [r.x, r.y, r.width, r.height])(document.getElementById("figure").getBoundingClientRect())');
  const cx = x + w / 2, cy = y + h / 2, s = Math.min(w, h) * 0.4;
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const [u, v] = f((2 * Math.PI * i) / count * 0.985 + 0.2);
    pts.push([cx + s * u, cy + s * v]);
  }
  return pts;
}

test('a one-crossing loop reads "1 crossing"', async () => {
  await withPage({ width: 1280, height: 800, reducedMotion: true }, async (b) => {
    await b.goto(base);
    await b.click('#btn-draw');
    await b.drag(await figurePath(b, 200, (t) => [Math.cos(t), 0.5 * Math.sin(2 * t)]));
    await sleep(150);
    assert.equal((await summary(b)).crossings, 1);
    const meta = await b.evaluate('document.getElementById("fig-meta").textContent');
    assert.match(meta, /· 1 crossing ·/);
    assert.doesNotMatch(meta, /1 crossings/);
  });
});

test('on a dense drawing no two crossing labels overlap', async () => {
  await withPage({ width: 1280, height: 800, reducedMotion: true }, async (b) => {
    await b.goto(base);
    await b.click('#btn-draw');
    // A loop with a big nine-fold wobble: about twenty crossings, many near the centre.
    await b.drag(await figurePath(b, 900, (t) => [(Math.cos(t) + 0.8 * Math.cos(9 * t)) / 1.8, (Math.sin(t) + 0.8 * Math.sin(8 * t)) / 1.8]));
    await sleep(300);
    const s = await summary(b);
    assert.ok(s.crossings >= 15, `${s.crossings} crossings`);
    assert.equal(s.callouts, s.crossings);
    const check = async (when) => {
      const badges = await b.evaluate('[...document.querySelectorAll("#overlay .callout .badge")].map((c) => [Number(c.getAttribute("cx")), Number(c.getAttribute("cy"))])');
      let closest = Infinity;
      for (let i = 0; i < badges.length; i++) {
        for (let j = i + 1; j < badges.length; j++) closest = Math.min(closest, Math.hypot(badges[i][0] - badges[j][0], badges[i][1] - badges[j][1]));
      }
      assert.ok(closest >= 23, `${when}: closest two labels are ${closest.toFixed(1)} px apart (badges are 23 px across)`);
      // Each leader starts at its crossing as drawn now.
      const drawn = await b.evaluate('[...document.querySelectorAll("#overlay .callout .dot")].map((c) => [Number(c.getAttribute("cx")), Number(c.getAttribute("cy"))])');
      const dots = await b.evaluate('window.__knot.dots()');
      dots.forEach((d, k) => assert.ok(Math.hypot(d[0] - drawn[k][0], d[1] - drawn[k][1]) < 1, `${when}: dot ${k + 1} is on its crossing`));
    };
    await check('as drawn');
    // Turn it: the labels are laid out again for the new view.
    await b.evaluate('document.getElementById("figure").focus()');
    for (let i = 0; i < 3; i++) await b.key('ArrowUp');
    await sleep(600);
    await check('turned');
    assert.deepEqual(b.problems, []);
  });
});

test('a sparse 8-point shared rope: every crossing dot sits on the drawn rope', async () => {
  const sparse = quantise(resampleClosed(trefoilCurve(300), 3, 8));
  await withPage({ width: 1280, height: 800, reducedMotion: true }, async (b) => {
    await b.goto(`${base}#${encodeKnot(sparse, [0, 0, 0, 1])}`);
    const s = await summary(b);
    assert.equal(s.crossings, 3);
    assert.equal(s.points, 8);
    await sleep(200);
    const dots = await b.evaluate('window.__knot.dots()');
    const probe = await b.evaluate(`window.__knot.probe(${JSON.stringify(dots)})`);
    assert.deepEqual(probe.ropeAt, [true, true, true], `dots at ${JSON.stringify(dots)}`);
    assert.deepEqual(b.problems, []);
  });
});
