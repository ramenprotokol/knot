import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DRAW_CROSSINGS, flipCrossing, liftDrawing, prepareStroke } from '../../src/topology/lift.ts';
import { analyse } from '../../src/topology/analyse.ts';
import { extractDiagram } from '../../src/topology/crossings.ts';
import { TOP_FRAME, frameFromDirection, minGap, pointCount } from '../../src/topology/geometry.ts';
import { toNumbers } from '../../src/topology/poly.ts';
import { PRESETS } from '../../src/topology/presets.ts';
import { relax } from '../../src/topology/relax.ts';

function stroke(n: number, f: (t: number) => [number, number]): number[] {
  const out: number[] = [];
  // An open stroke that stops just short of where it began, like a real hand-drawn loop.
  for (let i = 0; i < n; i++) out.push(...f((2 * Math.PI * i) / n * 0.985 + 0.2));
  return out;
}

const trefoilStroke = () => stroke(400, (t) => [1.4 * (Math.sin(t) + 2 * Math.sin(2 * t)), 1.4 * (Math.cos(t) - 2 * Math.cos(2 * t))]);
const eightStroke = () => stroke(500, (t) => [1.6 * (2 + Math.cos(2 * t)) * Math.cos(3 * t), 1.6 * (2 + Math.cos(2 * t)) * Math.sin(3 * t)]);

function lift(raw: number[]): Float64Array {
  const p = prepareStroke(raw);
  assert.ok(p.ok, p.ok ? '' : p.error);
  const l = liftDrawing(p.value);
  assert.ok(l.ok, l.ok ? '' : l.error);
  return l.value;
}

test('bad strokes get a clear message', () => {
  const tooShort = prepareStroke([0, 0, 1, 1]);
  assert.equal(tooShort.ok, false);
  assert.match(tooShort.ok ? '' : tooShort.error, /too short/);
  const tiny = prepareStroke(stroke(100, (t) => [0.1 * Math.cos(t), 0.1 * Math.sin(t)]));
  assert.match(tiny.ok ? '' : tiny.error, /too small/);
  const odd = prepareStroke([0, 0, 1]);
  assert.match(odd.ok ? '' : odd.error, /malformed/);
  const nan = prepareStroke([0, 0, NaN, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]);
  assert.match(nan.ok ? '' : nan.error, /invalid/);
});

test('a huge stroke is capped by point count, not processed in full', () => {
  // 50 000 points going ten times round a circle; only the first 6 000 are ever read.
  const raw: number[] = [];
  for (let i = 0; i < 50_000; i++) raw.push(3 * Math.cos(i / 800), 3 * Math.sin(i / 800));
  const p = prepareStroke(raw);
  assert.ok(p.ok);
  assert.ok(p.value.length / 2 <= 280);
});

test('a drawn trefoil shadow lifts to an alternating trefoil', () => {
  const c = lift(trefoilStroke());
  const a = analyse(c, TOP_FRAME);
  assert.equal(a.pd.length, 3);
  assert.deepEqual(toNumbers(a.alexander!.delta!), [1, -1, 1]);
  assert.equal(a.verdict.kind, 'match');
});

test('drawn crossings alternate over, under, over… along the rope', () => {
  const c = lift(eightStroke());
  const d = extractDiagram(c, TOP_FRAME);
  assert.ok(d.ok);
  const passes = d.diagram.crossings.flatMap((k) => [
    { p: k.over.param, over: true },
    { p: k.under.param, over: false },
  ]);
  passes.sort((x, y) => x.p - y.p);
  for (let i = 1; i < passes.length; i++) assert.notEqual(passes[i]!.over, passes[i - 1]!.over);
  assert.deepEqual(toNumbers(analyse(c, TOP_FRAME).alexander!.delta!), [-1, 3, -1]);
});

test('the lifted rope never touches itself', () => {
  for (const raw of [trefoilStroke(), eightStroke()]) assert.ok(minGap(lift(raw)).gap > 0.05);
});

test('a loop with one self-crossing is the unknot', () => {
  const c = lift(stroke(300, (t) => [3 * Math.cos(t), 1.5 * Math.sin(2 * t)]));
  const a = analyse(c, TOP_FRAME);
  assert.equal(a.pd.length, 1);
  assert.equal(a.verdict.kind, 'trivial-diagram');
});

test('flipping one crossing of the trefoil drawing unties it; flipping back reties it', () => {
  const c = lift(trefoilStroke());
  const d0 = extractDiagram(c, TOP_FRAME);
  assert.ok(d0.ok);
  const f1 = flipCrossing(c, d0.diagram, 2);
  assert.ok(f1.ok);
  const a1 = analyse(f1.value, TOP_FRAME);
  assert.equal(a1.pd.length, 3, 'same shadow, same crossings');
  assert.deepEqual(toNumbers(a1.alexander!.delta!), [1]);
  assert.equal(a1.diagram!.crossings[1]!.sign, -d0.diagram.crossings[1]!.sign, 'crossing 2 changed sign');
  assert.equal(a1.diagram!.crossings[0]!.sign, d0.diagram.crossings[0]!.sign, 'crossing 1 did not');
  const d1 = extractDiagram(f1.value, TOP_FRAME);
  assert.ok(d1.ok);
  const f2 = flipCrossing(f1.value, d1.diagram, 2);
  assert.ok(f2.ok);
  assert.deepEqual(toNumbers(analyse(f2.value, TOP_FRAME).alexander!.delta!), [1, -1, 1]);
  // Flipping does not keep adding points once the crossing already has room.
  assert.equal(pointCount(f2.value), pointCount(f1.value));
});

test('flipping works on a relaxed 3D rope seen from any angle', () => {
  const relaxed = relax(PRESETS.find((p) => p.id === 'figure-eight')!.build()).curve;
  const frame = frameFromDirection([0.3, -0.5, 0.8]);
  const d = extractDiagram(relaxed, frame);
  assert.ok(d.ok);
  const before = analyse(relaxed, frame);
  assert.deepEqual(toNumbers(before.alexander!.delta!), [-1, 3, -1]);
  let changed = 0;
  for (const k of d.diagram.crossings) {
    const f = flipCrossing(relaxed, d.diagram, k.id);
    assert.ok(f.ok);
    assert.ok(minGap(f.value).gap > 0.05, 'still a clean rope');
    const after = analyse(f.value, frame);
    assert.equal(after.pd.length, before.pd.length);
    if (toNumbers(after.alexander!.delta!).join() !== '-1,3,-1') changed++;
  }
  assert.ok(changed > 0, 'some single flip changes the knot');
});

test('a scribble with too many crossings is refused with a message', () => {
  // A {13/5} star polygon drawn in one stroke: 13 × 4 = 52 crossings.
  const raw: number[] = [];
  for (let k = 0; k < 13; k++) {
    const a0 = (2 * Math.PI * 5 * k) / 13, a1 = (2 * Math.PI * 5 * (k + 1)) / 13;
    for (let s = 0; s < 40; s++) {
      const u = s / 40;
      raw.push(4 * ((1 - u) * Math.cos(a0) + u * Math.cos(a1)), 4 * ((1 - u) * Math.sin(a0) + u * Math.sin(a1)));
    }
  }
  const p = prepareStroke(raw);
  assert.ok(p.ok);
  const l = liftDrawing(p.value);
  assert.equal(l.ok, false);
  assert.match(l.ok ? '' : l.error, new RegExp(`more than ${MAX_DRAW_CROSSINGS}`));
});
