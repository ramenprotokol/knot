import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RELAX, createRelaxer, relax } from '../../src/topology/relax.ts';
import { PRESETS } from '../../src/topology/presets.ts';
import { analyse, simplestView } from '../../src/topology/analyse.ts';
import { TOP_FRAME, frameFromDirection, maxDisplacement, minGap } from '../../src/topology/geometry.ts';
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
