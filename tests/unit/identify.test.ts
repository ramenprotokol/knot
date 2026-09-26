import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../../src/topology/analyse.ts';
import { describe, identify } from '../../src/topology/identify.ts';
import { TOP_FRAME } from '../../src/topology/geometry.ts';
import { fromNumbers } from '../../src/topology/poly.ts';
import { PRESETS, braidClosureCurve, torusKnotCurve } from '../../src/topology/presets.ts';

test('every preset is identified as the knot it was built to be', () => {
  for (const p of PRESETS) {
    const a = analyse(p.build(), TOP_FRAME);
    const v = a.verdict;
    if (p.expected === '0_1' && a.pd.length < 3) {
      assert.equal(v.kind, 'trivial-diagram', p.id);
      continue;
    }
    assert.equal(v.kind, 'match', p.id);
    assert.deepEqual(v.kind === 'match' ? v.candidates.map((k) => k.id) : [], [p.expected], p.id);
  }
});

test('the tangled preset has 11 crossings but is consistent with the unknot', () => {
  const a = analyse(PRESETS.find((p) => p.id === 'tangled')!.build(), TOP_FRAME);
  assert.equal(a.pd.length, 11);
  assert.equal(a.wording.headline, 'Consistent with the unknot (0₁)');
  assert.match(a.wording.detail, /not proof/);
});

test('granny and square share a polynomial, so both are listed', () => {
  const granny = analyse(braidClosureCurve(3, [1, 1, 1, 2, 2, 2]), TOP_FRAME);
  assert.equal(granny.verdict.kind, 'match');
  assert.deepEqual(granny.verdict.kind === 'match' ? granny.verdict.candidates.map((k) => k.id) : [], ['3_1#3_1', '3_1#3_1*']);
  assert.match(granny.wording.headline, /granny knot.* or .*square knot/);
  const square = analyse(braidClosureCurve(3, [1, 1, 1, -2, -2, -2]), TOP_FRAME);
  assert.deepEqual(square.verdict.kind === 'match' ? square.verdict.candidates.map((k) => k.id) : [], ['3_1#3_1', '3_1#3_1*']);
});

test('a trefoil and a figure-eight in a row match 3₁ # 4₁', () => {
  const a = analyse(braidClosureCurve(4, [1, 1, 1, 2, -3, 2, -3]), TOP_FRAME);
  assert.deepEqual(a.verdict.kind === 'match' ? a.verdict.candidates.map((k) => k.id) : [], ['3_1#4_1']);
});

test('7₁ is found, and 9₁ (beyond the table) is reported as not in the table', () => {
  const seven = analyse(torusKnotCurve(2, 7, 260), TOP_FRAME);
  assert.deepEqual(seven.verdict.kind === 'match' ? seven.verdict.candidates.map((k) => k.id) : [], ['7_1']);
  const nine = analyse(torusKnotCurve(2, 9, 320), TOP_FRAME);
  assert.equal(nine.pd.length, 9);
  assert.equal(nine.verdict.kind, 'no-match');
  assert.equal(nine.wording.headline, 'Not in our table');
});

test('fewer than three crossings is certain; three or more is only ever "consistent with" in the headline', () => {
  assert.equal(identify(fromNumbers([1]), 2).kind, 'trivial-diagram');
  assert.match(describe(identify(fromNumbers([1]), 2)).detail, /certain/);
  for (const [delta, n] of [[[1, -1, 1], 3], [[-1, 3, -1], 6], [[1], 9], [[1], 11], [[2, -3, 2], 5], [[1, -1, 1], 8], [[1, -2, 3, -2, 1], 6]] as const) {
    const w = describe(identify(fromNumbers([...delta]), n));
    assert.match(w.headline, /^Consistent with /);
    assert.doesNotMatch(w.headline + w.detail, /\b(definitely|proven|proves|certainly)\b/i);
  }
});

test('small diagrams settle it: a unique match with ≤ 7 crossings is certain up to mirror image', () => {
  // The table holds every knot with up to 7 crossings, so a 3–7 crossing view must show one of them.
  const trefoil = describe(identify(fromNumbers([1, -1, 1]), 3));
  assert.match(trefoil.detail, /this is certain, up to mirror image/);
  assert.match(trefoil.detail, /mirror image/);
  const fiveTwo = describe(identify(fromNumbers([2, -3, 2]), 7));
  assert.match(fiveTwo.detail, /shows only 7, so the knot must be in it: this is certain, up to mirror image/);
  // The figure-eight is its own mirror image, so plain "certain".
  const eight = describe(identify(fromNumbers([-1, 3, -1]), 6));
  assert.match(eight.detail, /this is certain\./);
  assert.doesNotMatch(eight.detail, /mirror/);
  // Granny or square: certain to be one of the two, never which.
  const gs = describe(identify(fromNumbers([1, -2, 3, -2, 1]), 6));
  assert.match(gs.detail, /so it is one of these/);
  assert.doesNotMatch(gs.detail, /this is certain/);
  // Above 7 crossings the same polynomial is only evidence.
  const big = describe(identify(fromNumbers([1, -1, 1]), 8));
  assert.match(big.detail, /evidence, not proof/);
  assert.doesNotMatch(big.detail, /certain/);
});

test('Δ = 1 is the unknot for certain up to 10 crossings, and strong evidence beyond', () => {
  for (const n of [3, 7, 10]) {
    const w = describe(identify(fromNumbers([1]), n));
    assert.equal(w.headline, 'Consistent with the unknot (0₁)');
    assert.match(w.detail, new RegExp(`shows only ${n}, so this is certain: the rope can be untangled`));
  }
  for (const n of [11, 40]) {
    const w = describe(identify(fromNumbers([1]), n));
    assert.match(w.detail, /strong evidence, not proof/);
    assert.doesNotMatch(w.detail, /certain/);
  }
});

test('chiral matches warn about mirror images; the figure-eight (amphichiral) does not need to', () => {
  assert.match(describe(identify(fromNumbers([1, -1, 1]), 3)).detail, /mirror image/);
  assert.doesNotMatch(describe(identify(fromNumbers([-1, 3, -1]), 4)).detail, /mirror image/);
});

test('a polynomial from a diagram with fewer crossings than the matching knot needs is not matched', () => {
  // 7₁'s polynomial on a 5-crossing diagram is impossible, so it must not be offered.
  assert.equal(identify(fromNumbers([1, -1, 1, -1, 1, -1, 1]), 5).kind, 'no-match');
});
