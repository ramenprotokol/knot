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

test('fewer than three crossings is certain; three or more is only ever "consistent with"', () => {
  assert.equal(identify(fromNumbers([1]), 2).kind, 'trivial-diagram');
  assert.match(describe(identify(fromNumbers([1]), 2)).detail, /certain/);
  for (const [delta, n] of [[[1, -1, 1], 3], [[-1, 3, -1], 6], [[1], 9], [[2, -3, 2], 5], [[1, -2, 3, -2, 1], 6]] as const) {
    const w = describe(identify(fromNumbers([...delta]), n));
    assert.match(w.headline, /^Consistent with /);
    assert.match(w.detail, /not proof|can share/);
    assert.doesNotMatch(w.headline + w.detail, /\b(definitely|proven|proves|certainly)\b/i);
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
