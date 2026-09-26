import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alexander, alexanderMatrix, arcsFromPD, determinant, normaliseAlexander } from '../../src/topology/alexander.ts';
import { parsePD, validatePD, writheOf } from '../../src/topology/pd.ts';
import { type Poly, equals, fromNumbers, mul, toNumbers } from '../../src/topology/poly.ts';
import { KNOT_TABLE } from '../../src/topology/table.ts';

// PD codes as published in the Knot Atlas (katlas.org), copied 2026-09-26. They are an
// independent source: the table's polynomials were typed in separately, and this test
// recomputes every one from these diagrams with our own matrix and determinant code.
const KNOT_ATLAS_PD: Record<string, string> = {
  '3_1': 'X1425 X3641 X5263',
  '4_1': 'X4251 X8615 X6374 X2738',
  '5_1': 'X1627 X3849 X5,10,6,1 X7283 X9,4,10,5',
  '5_2': 'X1425 X3849 X5,10,6,1 X9,6,10,7 X7283',
  '6_1': 'X1425 X7,10,8,11 X3948 X9,3,10,2 X5,12,6,1 X11,6,12,7',
  '6_2': 'X1425 X5,10,6,11 X3948 X9,3,10,2 X7,12,8,1 X11,6,12,7',
  '6_3': 'X4251 X8493 X12,9,1,10 X10,5,11,6 X6,11,7,12 X2837',
  '7_1': 'X1829 X3,10,4,11 X5,12,6,13 X7,14,8,1 X9,2,10,3 X11,4,12,5 X13,6,14,7',
  '7_2': 'X1425 X3,10,4,11 X5,14,6,1 X7,12,8,13 X11,8,12,9 X13,6,14,7 X9,2,10,3',
  '7_3': 'X6271 X10,4,11,3 X14,8,1,7 X8,14,9,13 X12,6,13,5 X2,10,3,9 X4,12,5,11',
  '7_4': 'X6271 X12,6,13,5 X14,8,1,7 X8,14,9,13 X2,12,3,11 X10,4,11,3 X4,10,5,9',
  '7_5': 'X1425 X3,10,4,11 X5,12,6,13 X7,14,8,1 X13,6,14,7 X11,8,12,9 X9,2,10,3',
  '7_6': 'X1425 X3849 X5,12,6,13 X9,1,10,14 X13,11,14,10 X11,6,12,7 X7283',
  '7_7': 'X1425 X5,10,6,11 X3948 X9,3,10,2 X11,14,12,1 X7,13,8,12 X13,7,14,6',
};

const deltaOf = (pd: string): Poly => {
  const d = alexander(parsePD(pd)).delta;
  assert.ok(d, 'determinant was zero');
  return d;
};

test('every Knot Atlas PD code parses and is structurally valid', () => {
  for (const [id, text] of Object.entries(KNOT_ATLAS_PD)) {
    const pd = parsePD(text);
    assert.equal(pd.length, Number(id.split('_')[0]), id);
    assert.deepEqual(validatePD(pd), { ok: true }, id);
  }
});

test('Alexander polynomial from each Knot Atlas PD code equals the table entry', () => {
  for (const [id, text] of Object.entries(KNOT_ATLAS_PD)) {
    const row = KNOT_TABLE.find((k) => k.id === id);
    assert.ok(row, id);
    assert.deepEqual(toNumbers(deltaOf(text)), [...row.alexander], id);
  }
});

test('known values: unknot 1, trefoil t²−t+1, figure-eight −t²+3t−1, 5₁, 5₂', () => {
  assert.deepEqual(toNumbers(alexander([]).delta!), [1]);
  assert.deepEqual(toNumbers(deltaOf(KNOT_ATLAS_PD['3_1']!)), [1, -1, 1]);
  assert.deepEqual(toNumbers(deltaOf(KNOT_ATLAS_PD['4_1']!)), [-1, 3, -1]);
  assert.deepEqual(toNumbers(deltaOf(KNOT_ATLAS_PD['5_1']!)), [1, -1, 1, -1, 1]);
  assert.deepEqual(toNumbers(deltaOf(KNOT_ATLAS_PD['5_2']!)), [2, -3, 2]);
});

test('normalisation: divides out tᵏ and fixes the sign so Δ(1) = 1', () => {
  // −t³ + t² − t is −t·(t² − t + 1): the raw determinant of a trefoil minor can look like this.
  const n = normaliseAlexander(fromNumbers([0, -1, 1, -1]));
  assert.ok(n);
  assert.equal(n.shift, 1);
  assert.equal(n.negated, true);
  assert.deepEqual(toNumbers(n.delta), [1, -1, 1]);
  // t² − 3t + 1 (figure-eight with the other sign) normalises to −t² + 3t − 1.
  assert.deepEqual(toNumbers(normaliseAlexander(fromNumbers([1, -3, 1]))!.delta), [-1, 3, -1]);
  assert.equal(normaliseAlexander([]), null);
});

test('mirror image (every crossing switched) gives the same polynomial', () => {
  // Switching a crossing keeps the four edges in the same counter-clockwise order but makes the
  // old over-strand the under-strand, so the code restarts from the old over-strand's incoming edge.
  for (const [id, text] of Object.entries(KNOT_ATLAS_PD)) {
    const pd = parsePD(text);
    const edges = 2 * pd.length;
    const next = (e: number) => (e === edges ? 1 : e + 1);
    const mirror = pd.map((p) => {
      const inOver = p.b === next(p.d) ? p.d : p.b;
      return inOver === p.d ? { a: p.d, b: p.a, c: p.b, d: p.c } : { a: p.b, b: p.c, c: p.d, d: p.a };
    });
    assert.deepEqual(validatePD(mirror), { ok: true }, id);
    assert.equal(writheOf(mirror) + writheOf(pd), 0, id);
    assert.ok(equals(deltaOf(text), alexander(mirror).delta!), id);
  }
});

test('arcs: a diagram with n crossings has n arcs, each a run of consecutive edges', () => {
  for (const text of Object.values(KNOT_ATLAS_PD)) {
    const pd = parsePD(text);
    const arcs = arcsFromPD(pd);
    assert.equal(arcs.edgesOfArc.length, pd.length);
    assert.equal(arcs.edgesOfArc.flat().length, 2 * pd.length);
  }
});

test('every Alexander matrix row sums to zero (so any minor gives the same Δ up to ±tᵏ)', () => {
  for (const text of Object.values(KNOT_ATLAS_PD)) {
    const pd = parsePD(text);
    const m = alexanderMatrix(pd);
    for (const row of m) {
      const sum = row.reduce<Poly>((acc, p) => {
        const out: bigint[] = [];
        for (let i = 0; i < Math.max(acc.length, p.length); i++) out.push((acc[i] ?? 0n) + (p[i] ?? 0n));
        return out;
      }, []);
      assert.ok(sum.every((c) => c === 0n));
    }
    // Deleting a different row/column gives the same normalised polynomial.
    const n = m.length;
    const minor0 = m.slice(1).map((r) => r.slice(1));
    const minorLast = m.slice(0, n - 1).map((r) => r.slice(0, n - 1));
    assert.ok(equals(normaliseAlexander(determinant(minor0))!.delta, normaliseAlexander(determinant(minorLast))!.delta));
  }
});

test('Bareiss determinant agrees with cofactor expansion on small integer-polynomial matrices', () => {
  const P = (...c: number[]) => fromNumbers(c);
  const m = [
    [P(1, -1), P(0, 1), P(-1)],
    [P(-1), P(1, -1), P(0, 1)],
    [P(0, 1), P(-1), P(1, -1)],
  ];
  const cof = (a: Poly[][]): Poly => {
    if (a.length === 1) return a[0]![0]!;
    let acc: Poly = [];
    a[0]!.forEach((v, j) => {
      const sub = a.slice(1).map((r) => r.filter((_, k) => k !== j));
      const term = mul(v, cof(sub));
      const signed = j % 2 === 0 ? term : term.map((c) => -c);
      const out: bigint[] = [];
      for (let i = 0; i < Math.max(acc.length, signed.length); i++) out.push((acc[i] ?? 0n) + (signed[i] ?? 0n));
      while (out.length && out[out.length - 1] === 0n) out.pop();
      acc = out;
    });
    return acc;
  };
  assert.ok(equals(determinant(m), cof(m)));
  // A zero pivot forces a row swap.
  const z = [
    [P(), P(1)],
    [P(0, 1), P(2)],
  ];
  assert.deepEqual(toNumbers(determinant(z)), [0, -1]);
});

test('composite rows equal the product of their summands', () => {
  const row = (id: string) => fromNumbers(KNOT_TABLE.find((k) => k.id === id)!.alexander);
  assert.ok(equals(row('3_1#3_1'), mul(row('3_1'), row('3_1'))));
  assert.ok(equals(row('3_1#3_1*'), mul(row('3_1'), row('3_1'))));
  assert.ok(equals(row('3_1#4_1'), mul(row('3_1'), row('4_1'))));
});

test('table: every row has Δ(1) = 1, is palindromic, and all but granny/square are distinct', () => {
  const seen = new Map<string, string>();
  for (const k of KNOT_TABLE) {
    const p = k.alexander;
    assert.equal(p.reduce((a, b) => a + b, 0), 1, k.id);
    assert.deepEqual([...p].reverse(), [...p], k.id);
    const key = p.join(',');
    if (seen.has(key)) assert.deepEqual([seen.get(key), k.id].sort(), ['3_1#3_1', '3_1#3_1*']);
    seen.set(key, k.id);
  }
});
