// End-to-end checks on the built dist/ in headless Chrome: it loads without console errors,
// WebGL draws the rope, the presets are identified, drawing / flipping / relaxing / sharing
// work, hostile links are refused quickly, and the page fits a true 400 px phone screen.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../../scripts/cdp.mjs';
import { headersFor, parseHeaders, startServer } from '../../scripts/serve.mjs';
import { encodeKnot } from '../../src/topology/share.ts';

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
      const note = await b.evaluate('document.getElementById("figure-note").textContent');
      assert.match(note, /couldn't be read/);
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
