import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RELAX, createRelaxer, relax } from '../../src/topology/relax.ts';
import { PRESETS } from '../../src/topology/presets.ts';
import { analyse, simplestView } from '../../src/topology/analyse.ts';
import { TOP_FRAME, boundingRadius, centroid, frameFromDirection, maxDisplacement, minGap } from '../../src/topology/geometry.ts';
import { canQuantiseSafely, decodeKnot, encodeKnot, quantise } from '../../src/topology/share.ts';
import { equals } from '../../src/topology/poly.ts';

test('relaxing never changes the knot: Δ is the same before and after, for every preset', () => {
  for (const p of PRESETS) {
    const c = p.build();
    const before = analyse(c, TOP_FRAME).alexander!.delta!;
    const { curve, stats } = relax(c);
    assert.ok(stats.steps <= DEFAULT_RELAX.maxSteps);
    assert.ok(stats.minGapSeen > 0.05, `${p.id}: gap ${stats.minGapSeen}`);
    const top = analyse(curve, TOP_FRAME);
    assert.ok(top.alexander?.delta && equals(top.alexander.delta, before), `${p.id} top view`);
    const best = simplestView(curve, [0, 0, 1]);
    const bv = analyse(curve, frameFromDirection(best.direction));
    assert.ok(bv.alexander?.delta && equals(bv.alexander.delta, before), `${p.id} simplest view`);
    assert.equal(bv.pd.length, best.crossings);
  }
});

test('every step moves each point less than half the smallest gap (the no-pass-through guarantee)', () => {
  const c = PRESETS.find((p) => p.id === 'tangled')!.build();
  const r = createRelaxer(c);
  let prevGap = minGap(r.curve).gap;
  for (let k = 0; k < 120; k++) {
    const before = Float64Array.from(r.curve);
    const s = r.step(1);
    const moved = maxDisplacement(before, r.curve);
    assert.ok(moved <= DEFAULT_RELAX.gapSafety * prevGap + 1e-12, `step ${k}: moved ${moved}, gap ${prevGap}`);
    assert.ok(moved < prevGap / 2);
    prevGap = s.gap;
    if (s.done) break;
  }
});

test('relaxation is deterministic', () => {
  const c = PRESETS.find((p) => p.id === 'three-twist')!.build();
  assert.deepEqual(relax(c).curve, relax(c).curve);
});

test('a short run stretches the rope only modestly (under 20%) and the step cap holds', () => {
  for (const p of PRESETS) {
    const { stats } = relax(p.build(), { ...DEFAULT_RELAX, maxSteps: 50 });
    assert.ok(stats.steps <= 50);
    assert.ok(Math.abs(stats.lengthNow / stats.lengthStart - 1) < 0.2, p.id);
  }
});

test('relaxing opens the three-twist knot to its minimal five-crossing view', () => {
  const c = relax(PRESETS.find((p) => p.id === 'three-twist')!.build()).curve;
  assert.equal(simplestView(c, [0, 0, 1]).crossings, 5);
});

test('relaxing comes back at the starting size, so twelve presses in a row neither grow the rope nor break Share', () => {
  for (const id of ['trefoil', 'cinquefoil', 'tangled']) {
    let c = PRESETS.find((p) => p.id === id)!.build();
    const r0 = boundingRadius(c);
    const before = analyse(c, TOP_FRAME).alexander!.delta!;
    for (let k = 0; k < 12; k++) {
      c = relax(c).curve;
      // What the page does next: recentre (a translation) and snap to the link grid when safe.
      const [x, y, z] = centroid(c);
      for (let i = 0; i < c.length; i += 3) {
        c[i]! -= x;
        c[i + 1]! -= y;
        c[i + 2]! -= z;
      }
      if (canQuantiseSafely(c)) c = quantise(c);
      const r = boundingRadius(c);
      assert.ok(Math.abs(r / r0 - 1) < 0.1, `${id}, press ${k + 1}: radius ${r.toFixed(2)} vs ${r0.toFixed(2)}`);
    }
    assert.ok(minGap(c).gap > 0.1, `${id}: strands still apart`);
    const best = simplestView(c, [0, 0, 1]);
    const a = analyse(c, frameFromDirection(best.direction));
    assert.ok(a.alexander?.delta && equals(a.alexander.delta, before), `${id}: same knot after 12 relaxes`);
    const link = encodeKnot(c, [0, 0, 0, 1]);
    const back = decodeKnot(link);
    assert.ok(back.ok, `${id}: the link decodes`);
  }
});

test('the relax stats report the scaling back to the starting size', () => {
  const { curve, stats } = relax(PRESETS.find((p) => p.id === 'trefoil')!.build());
  assert.ok(stats.scale > 0 && stats.scale < 1, `scale ${stats.scale}`);
  assert.ok(Math.abs(stats.lengthShaped - stats.lengthNow * stats.scale) < 1e-9);
  assert.ok(Math.abs(boundingRadius(curve) - boundingRadius(PRESETS.find((p) => p.id === 'trefoil')!.build())) < 1e-9);
});

test('the view search reports the starting view as the page shows it, even when that view needs a nudge', () => {
  // Seen exactly from the top, a corner of the figure-eight and cinquefoil plates sits on
  // another strand's shadow; the page reads that view after a tiny nudge. The search must
  // report the same count as "before", never -1.
  for (const p of PRESETS) {
    const c = p.build();
    const shown = analyse(c, frameFromDirection([0, 0, 1])).pd.length;
    assert.equal(simplestView(c, [0, 0, 1]).currentCrossings, shown, p.id);
  }
});
