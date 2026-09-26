import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDiagram, planarHits } from '../../src/topology/crossings.ts';
import { type Frame, TOP_FRAME, frameFromDirection, frameFromQuaternion } from '../../src/topology/geometry.ts';
import { formatPD, validatePD } from '../../src/topology/pd.ts';
import { alexander } from '../../src/topology/alexander.ts';
import { toNumbers } from '../../src/topology/poly.ts';
import { PRESETS } from '../../src/topology/presets.ts';
import { analyse } from '../../src/topology/analyse.ts';

function curve(n: number, f: (t: number) => [number, number, number]): Float64Array {
  const out = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) out.set(f((2 * Math.PI * i) / n + 0.0123), 3 * i);
  return out;
}

function diagramOf(c: Float64Array, frame: Frame = TOP_FRAME) {
  const r = extractDiagram(c, frame);
  assert.ok(r.ok, r.ok ? '' : r.message);
  return r.diagram;
}

test('a flat circle has no crossings', () => {
  const d = diagramOf(curve(64, (t) => [Math.cos(t), Math.sin(t), 0]));
  assert.equal(d.crossings.length, 0);
  assert.equal(d.writhe, 0);
});

test('a figure-of-eight loop with a lift has exactly one crossing, at the origin, with the right strand over', () => {
  // x = cos t, y = sin 2t / 2 crosses itself at the origin at t = π/2 (z = +0.5) and 3π/2 (z = −0.5).
  const c = curve(200, (t) => [Math.cos(t), Math.sin(2 * t) / 2, 0.5 * Math.sin(t)]);
  const d = diagramOf(c);
  assert.equal(d.crossings.length, 1);
  const x = d.crossings[0]!;
  assert.ok(Math.hypot(x.x, x.y) < 1e-3);
  assert.ok(x.over.depth > 0.49 && x.under.depth < -0.49);
  // Over-strand heads (−1, −1), under-strand heads (1, −1): cross product > 0, a positive crossing.
  assert.equal(x.sign, 1);
  assert.equal(x.id, 1);
  assert.deepEqual(validatePD(d.crossings.map((k) => k.pd)), { ok: true });
});

test('the same curve seen from below swaps over and under but keeps the crossing sign', () => {
  const c = curve(200, (t) => [Math.cos(t), Math.sin(2 * t) / 2, 0.5 * Math.sin(t)]);
  const below: Frame = { e1: [1, 0, 0], e2: [0, -1, 0], v: [0, 0, -1] };
  const d = diagramOf(c, below);
  assert.equal(d.crossings.length, 1);
  assert.ok(d.crossings[0]!.over.depth > 0);
  assert.equal(d.crossings[0]!.over.param > 100, true, 'the t = 3π/2 strand is now on top');
  assert.equal(d.crossings[0]!.sign, 1);
});

test('the standard trefoil projection has three crossings of one sign, 120° apart', () => {
  const c = curve(300, (t) => [Math.sin(t) + 2 * Math.sin(2 * t), Math.cos(t) - 2 * Math.cos(2 * t), -Math.sin(3 * t)]);
  const d = diagramOf(c);
  assert.equal(d.crossings.length, 3);
  assert.equal(Math.abs(d.writhe), 3);
  const radii = d.crossings.map((k) => Math.hypot(k.x, k.y));
  assert.ok(Math.max(...radii) - Math.min(...radii) < 1e-3, 'equal radii');
  const angles = d.crossings.map((k) => Math.atan2(k.y, k.x)).sort((a, b) => a - b);
  assert.ok(Math.abs(angles[1]! - angles[0]! - (2 * Math.PI) / 3) < 1e-2);
  assert.deepEqual(toNumbers(alexander(d.crossings.map((k) => k.pd)).delta!), [1, -1, 1]);
});

test('crossings are numbered in the order the rope first reaches them', () => {
  const c = PRESETS.find((p) => p.id === 'figure-eight')!.build();
  const d = diagramOf(c);
  const firstParam = d.crossings.map((k) => Math.min(k.over.param, k.under.param));
  for (let i = 1; i < firstParam.length; i++) assert.ok(firstParam[i]! > firstParam[i - 1]!);
});

test('rotating the rope and the view together leaves the diagram unchanged', () => {
  const c = PRESETS.find((p) => p.id === 'three-twist')!.build();
  const q = [0.2, -0.4, 0.1, 0.88] as const;
  const f = frameFromQuaternion(q);
  // Rotate the rope by the frame (world → picture coordinates); then the top view sees what f saw.
  const rotated = new Float64Array(c.length);
  for (let i = 0; i < c.length; i += 3) {
    const p = [c[i]!, c[i + 1]!, c[i + 2]!];
    rotated[i] = p[0]! * f.e1[0] + p[1]! * f.e1[1] + p[2]! * f.e1[2];
    rotated[i + 1] = p[0]! * f.e2[0] + p[1]! * f.e2[1] + p[2]! * f.e2[2];
    rotated[i + 2] = p[0]! * f.v[0] + p[1]! * f.v[1] + p[2]! * f.v[2];
  }
  assert.equal(formatPD(diagramOf(c, f).crossings.map((k) => k.pd)), formatPD(diagramOf(rotated).crossings.map((k) => k.pd)));
});

test('turning the picture in its own plane does not change the PD code', () => {
  const c = PRESETS.find((p) => p.id === 'cinquefoil')!.build();
  const a = 0.7;
  const turned: Frame = { e1: [Math.cos(a), Math.sin(a), 0], e2: [-Math.sin(a), Math.cos(a), 0], v: [0, 0, 1] };
  assert.equal(formatPD(diagramOf(c).crossings.map((k) => k.pd)), formatPD(diagramOf(c, turned).crossings.map((k) => k.pd)));
});

test('a view where a corner of the rope sits exactly on another strand is nudged, not misread', () => {
  // Square-ish loop whose vertex (0, 0) lies exactly on another segment's shadow.
  const pts = [
    [-1, 0, 0.5], [0, 0, 0.5], [1, 0, 0.5], [1, 1, 0.5], [0, 1, 0.5], [0, -1, -0.5], [-1, -1, -0.5],
  ];
  const c = Float64Array.from(pts.flat());
  const hits = planarHits(c, 3);
  assert.equal(hits.ok, false);
  const d = diagramOf(c);
  assert.equal(d.nudged, true);
  assert.equal(d.crossings.length, 1);
});

test('a rope that passes through itself is reported, not analysed', () => {
  const pts = [
    [-1, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, -1, 0], [-1, -1, 0],
  ];
  const r = extractDiagram(Float64Array.from(pts.flat()), TOP_FRAME);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.reason, 'singular');
});

// PD codes of the presets from the top view. These are deterministic; recording them catches
// any accidental change to the curves, the crossing finder or the labelling.
const PRESET_PD: Record<string, string> = {
  unknot: 'PD[] (no crossings)',
  trefoil: 'X[6,3,1,4] X[4,1,5,2] X[2,5,3,6]',
  'figure-eight': 'X[3,8,4,1] X[1,7,2,6] X[5,3,6,2] X[7,4,8,5]',
  cinquefoil: 'X[10,6,1,5] X[6,2,7,1] X[2,8,3,7] X[8,4,9,3] X[4,10,5,9]',
  'three-twist': 'X[5,1,6,12] X[1,7,2,6] X[7,3,8,2] X[10,4,11,3] X[4,10,5,9] X[8,11,9,12]',
};

test('PD codes for the presets are valid and as recorded', () => {
  for (const p of PRESETS) {
    const d = diagramOf(p.build());
    const pd = d.crossings.map((k) => k.pd);
    assert.deepEqual(validatePD(pd), { ok: true }, p.id);
    if (PRESET_PD[p.id]) assert.equal(formatPD(pd), PRESET_PD[p.id], p.id);
  }
});

test('preset diagrams have the expected crossing counts from the top', () => {
  const expected: Record<string, number> = { unknot: 0, trefoil: 3, 'figure-eight': 4, cinquefoil: 5, 'three-twist': 6, tangled: 11 };
  for (const p of PRESETS) assert.equal(analyse(p.build(), TOP_FRAME).pd.length, expected[p.id], p.id);
});

test('the diagram and its polynomial survive any view direction', () => {
  const c = PRESETS.find((p) => p.id === 'figure-eight')!.build();
  for (const dir of [[1, 0, 0], [0, 1, 0], [1, 1, 1], [-0.3, 0.8, 0.2]] as const) {
    const a = analyse(c, frameFromDirection(dir));
    assert.deepEqual(toNumbers(a.alexander!.delta!), [-1, 3, -1], String(dir));
  }
});
