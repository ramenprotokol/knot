import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FRAGMENT, canQuantiseSafely, decodeKnot, encodeKnot, quantise, quantiseRotation } from '../../src/topology/share.ts';
import { PRESETS } from '../../src/topology/presets.ts';
import { analyse, MAX_ANALYSE_CROSSINGS } from '../../src/topology/analyse.ts';
import { frameFromQuaternion } from '../../src/topology/geometry.ts';
import { formatPD } from '../../src/topology/pd.ts';

const ROT = [0.1234567, -0.2345678, 0.0555, 0.9612] as const;

test('round trip: the decoded rope and view are exactly the snapped ones', () => {
  for (const p of PRESETS) {
    const c = quantise(p.build());
    assert.ok(canQuantiseSafely(p.build()));
    const rot = quantiseRotation(ROT);
    const frag = encodeKnot(c, rot);
    const d = decodeKnot(`#${frag}`);
    assert.ok(d.ok, d.ok ? '' : d.error);
    assert.deepEqual(d.knot.curve, c, p.id);
    assert.deepEqual(d.knot.rotation, rot);
    // So the analysis is identical too.
    assert.equal(
      formatPD(analyse(d.knot.curve, frameFromQuaternion(d.knot.rotation)).pd),
      formatPD(analyse(c, frameFromQuaternion(rot)).pd),
    );
  }
});

test('snapping is idempotent', () => {
  const r = quantiseRotation(ROT);
  assert.deepEqual(quantiseRotation(r), r);
  const c = quantise(PRESETS[1]!.build());
  assert.deepEqual(quantise(c), c);
});

test('links are compact', () => {
  const frag = encodeKnot(quantise(PRESETS[5]!.build()), [0, 0, 0, 1]);
  assert.ok(frag.length < 2000, `${frag.length} characters`);
});

function bytesToFrag(bytes: number[]): string {
  return `k=1.${Buffer.from(bytes).toString('base64url')}`;
}

test('hostile and broken links get a clear message, fast', () => {
  const good = encodeKnot(quantise(PRESETS[1]!.build()), [0, 0, 0, 1]);
  const cases: [string, RegExp][] = [
    ['#' + 'k=1.' + 'A'.repeat(200_000), /too long/],
    ['#hello', /not in the knot format/],
    ['#k=2.AAAA', /version 2/],
    ['#k=1.AAA$', /not in the knot format/],
    ['#k=1.A', /damaged/],
    [`#${good.slice(0, good.length - 40)}`, /cut short|damaged/],
    [`#${good}AAAA`, /extra data|damaged/],
    ['#' + bytesToFrag([1, 0xff, 0xff, 0xff, 0x7f]), /points/],
    ['#' + bytesToFrag([1, 0xe8, 0x07]), /points/],
    ['#' + bytesToFrag([1, 8, 0, 0, 0, 0, 0]), /view/],
    ['#' + bytesToFrag([1, 8, 0x80, 0x80, 0x80, 0x80, 0x01]), /view/],
  ];
  for (const [frag, re] of cases) {
    const t0 = performance.now();
    const d = decodeKnot(frag);
    const ms = performance.now() - t0;
    assert.equal(d.ok, false, frag.slice(0, 40));
    assert.match(d.ok ? '' : d.error, re, frag.slice(0, 40));
    assert.ok(ms < 100, `${ms} ms`);
  }
  assert.ok(MAX_FRAGMENT < 10_000);
});

/** Build a raw link from points (no quantisation checks), for crafting hostile ropes. */
function rawLink(points: number[][], rot = [0, 0, 0, 1000]): string {
  const bytes: number[] = [1];
  const push = (u: number) => {
    while (u >= 0x80) {
      bytes.push((u & 0x7f) | 0x80);
      u = Math.floor(u / 128);
    }
    bytes.push(u);
  };
  const zig = (v: number) => (v >= 0 ? 2 * v : -2 * v - 1);
  push(points.length);
  for (const c of rot) push(zig(c));
  let prev = [0, 0, 0];
  for (const p of points) {
    const q = p.map((x) => Math.round(x * 100));
    for (let k = 0; k < 3; k++) push(zig(q[k]! - prev[k]!));
    prev = q;
  }
  return bytesToFrag(bytes);
}

test('a link whose rope is out of range, repeats a point or passes through itself is refused', () => {
  const square = (z = 0) => [[0, 0, z], [1, 0, z], [2, 0, z], [2, 1, z], [2, 2, z], [1, 2, z], [0, 2, z], [0, 1, z]];
  assert.ok(decodeKnot(rawLink(square())).ok);
  assert.match((decodeKnot(rawLink(square(150))) as { error: string }).error, /too large/);
  const dup = square();
  dup[3] = dup[2]!;
  assert.match((decodeKnot(rawLink(dup)) as { error: string }).error, /repeated/);
  const through = [[-1, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, -1, 0], [-1, -1, 0], [-1, -0.5, 0], [-1, -0.2, 0]];
  assert.match((decodeKnot(rawLink(through)) as { error: string }).error, /passes through itself/);
});

test('a valid link with a monstrous number of crossings is decoded but not analysed, quickly', () => {
  // The (5, 41) torus knot on 480 points: 164 crossings seen down its axis.
  const pts: number[][] = [];
  for (let i = 0; i < 480; i++) {
    const t = (2 * Math.PI * i) / 480;
    const r = 6 + 2.5 * Math.cos(41 * t);
    pts.push([r * Math.cos(5 * t), r * Math.sin(5 * t), 2.5 * Math.sin(41 * t)]);
  }
  const d = decodeKnot(rawLink(pts));
  assert.ok(d.ok, d.ok ? '' : d.error);
  const t0 = performance.now();
  const a = analyse(d.knot.curve, frameFromQuaternion(d.knot.rotation));
  const ms = performance.now() - t0;
  assert.equal(a.verdict.kind, 'unavailable');
  assert.ok(a.pd.length > MAX_ANALYSE_CROSSINGS || a.diagram === null);
  assert.ok(ms < 1000, `${ms} ms`);
});
