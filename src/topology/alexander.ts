// The Alexander polynomial from a PD code, computed exactly.
//
// Arcs: the rope between two consecutive under-passes is one arc (over-passes don't break it),
// so a diagram with n ≥ 1 crossings has n arcs. Each crossing gives one row of the n×n
// Alexander matrix (Alexander 1928; equivalently the abelianised Fox derivatives of the
// Wirtinger presentation):  1 − t in the over-arc's column, t in the column of the under-arc
// on the over-strand's right, −1 in the column of the under-arc on its left.
// Deleting one row and one column and taking the determinant gives Δ(t) up to ±tᵏ; we then
// normalise so the lowest power is t⁰ and Δ(1) = +1.

import { type Poly, ONE, ZERO, add, degree, evaluate, exactDiv, isPalindromic, isZero, lowestDegree, mul, neg, sub } from './poly.ts';
import { type PDCode, nextLabel, signFromLabels } from './pd.ts';

export interface Arcs {
  /** arcOfEdge[e] = arc number (1-based) of edge label e (index 0 unused). */
  readonly arcOfEdge: readonly number[];
  /** Edge labels on each arc, in order along the knot (index 0 = arc 1). */
  readonly edgesOfArc: readonly (readonly number[])[];
}

export function arcsFromPD(pd: PDCode): Arcs {
  const edges = 2 * pd.length;
  if (edges === 0) return { arcOfEdge: [0], edgesOfArc: [] };
  // Only an under-pass breaks the rope into a new arc: edge a does not continue into edge c.
  const joined = new Array<boolean>(edges + 1).fill(true); // joined[e]: edge e continues into e+1
  for (const p of pd) {
    if (p.c !== nextLabel(p.a, edges)) throw new RangeError('under-edges are not consecutive');
    joined[p.a] = false;
  }
  // Start numbering right after an under-pass so every arc is one contiguous run.
  let start = 1;
  for (let e = 1; e <= edges; e++) {
    const prev = e === 1 ? edges : e - 1;
    if (!joined[prev]) {
      start = e;
      break;
    }
  }
  const arcOfEdge = new Array<number>(edges + 1).fill(0);
  const edgesOfArc: number[][] = [];
  let e = start;
  for (let k = 0; k < edges; k++) {
    if (k === 0 || !joined[e === 1 ? edges : e - 1]) edgesOfArc.push([]);
    arcOfEdge[e] = edgesOfArc.length;
    edgesOfArc[edgesOfArc.length - 1]!.push(e);
    e = nextLabel(e, edges);
  }
  return { arcOfEdge, edgesOfArc };
}

const T: Poly = [0n, 1n];
const ONE_MINUS_T: Poly = [1n, -1n];
const MINUS_ONE: Poly = [-1n];

export function alexanderMatrix(pd: PDCode, arcs: Arcs = arcsFromPD(pd)): Poly[][] {
  const n = pd.length;
  const edges = 2 * n;
  const m: Poly[][] = Array.from({ length: n }, () => new Array<Poly>(arcs.edgesOfArc.length).fill(ZERO));
  pd.forEach((p, row) => {
    const r = m[row]!;
    const over = arcs.arcOfEdge[p.b]! - 1;
    const inArc = arcs.arcOfEdge[p.a]! - 1;
    const outArc = arcs.arcOfEdge[p.c]! - 1;
    const positive = n === 1 ? true : signFromLabels(p, edges) > 0;
    // Positive crossing: the incoming under-arc lies on the over-strand's right.
    r[over] = add(r[over]!, ONE_MINUS_T);
    r[inArc] = add(r[inArc]!, positive ? T : MINUS_ONE);
    r[outArc] = add(r[outArc]!, positive ? MINUS_ONE : T);
  });
  return m;
}

/**
 * Determinant over Z[t] by fraction-free (Bareiss) elimination: every division is exact,
 * so every intermediate value is an integer polynomial.
 */
export function determinant(matrix: readonly (readonly Poly[])[]): Poly {
  const n = matrix.length;
  if (n === 0) return ONE;
  const a = matrix.map((row) => row.slice());
  let negate = false;
  let prev: Poly = ONE;
  for (let k = 0; k < n - 1; k++) {
    // Pick the simplest non-zero pivot in column k (lowest degree, then smallest leading term).
    let best = -1;
    for (let r = k; r < n; r++) {
      const v = a[r]![k]!;
      if (isZero(v)) continue;
      if (best < 0) {
        best = r;
        continue;
      }
      const b = a[best]![k]!;
      const lv = v[v.length - 1]!, lb = b[b.length - 1]!;
      if (degree(v) < degree(b) || (degree(v) === degree(b) && (lv < 0n ? -lv : lv) < (lb < 0n ? -lb : lb))) best = r;
    }
    if (best < 0) return ZERO;
    if (best !== k) {
      const tmp = a[k]!;
      a[k] = a[best]!;
      a[best] = tmp;
      negate = !negate;
    }
    const pivot = a[k]![k]!;
    for (let i = k + 1; i < n; i++) {
      const rowI = a[i]!;
      const aik = rowI[k]!;
      for (let j = k + 1; j < n; j++) {
        rowI[j] = exactDiv(sub(mul(rowI[j]!, pivot), mul(aik, a[k]![j]!)), prev);
      }
      rowI[k] = ZERO;
    }
    prev = pivot;
  }
  const d = a[n - 1]![n - 1]!;
  return negate ? neg(d) : d;
}

export interface Normalisation {
  /** Power of t divided out. */
  readonly shift: number;
  /** Whether the polynomial was multiplied by −1 to make Δ(1) = +1. */
  readonly negated: boolean;
  readonly delta: Poly;
}

export function normaliseAlexander(raw: Poly): Normalisation | null {
  if (isZero(raw)) return null;
  const shift = lowestDegree(raw);
  const p = raw.slice(shift);
  const negated = evaluate(p, 1n) < 0n;
  return { shift, negated, delta: negated ? neg(p) : p };
}

export interface AlexanderWorking {
  readonly arcs: Arcs;
  readonly matrix: Poly[][];
  /** The (n−1)×(n−1) minor after deleting the last row and last column. */
  readonly minor: Poly[][];
  readonly det: Poly;
  readonly normalisation: Normalisation | null;
  /** Normalised Δ(t), lowest power t⁰, Δ(1) = 1. Null only if the determinant was 0. */
  readonly delta: Poly | null;
  /** Δ(1). It is ±1 for every knot; anything else signals a bug or a link. */
  readonly atOne: bigint | null;
  /** |Δ(−1)|, the knot determinant. */
  readonly knotDeterminant: bigint | null;
  readonly symmetric: boolean;
}

export function alexander(pd: PDCode): AlexanderWorking {
  const arcs = arcsFromPD(pd);
  const matrix = alexanderMatrix(pd, arcs);
  const n = matrix.length;
  const minor = n === 0 ? [] : matrix.slice(0, n - 1).map((row) => row.slice(0, n - 1));
  const det = determinant(minor);
  const normalisation = normaliseAlexander(det);
  const delta = normalisation?.delta ?? null;
  const atOne = delta ? evaluate(delta, 1n) : null;
  const atMinus = delta ? evaluate(delta, -1n) : null;
  return {
    arcs,
    matrix,
    minor,
    det,
    normalisation,
    delta,
    atOne,
    knotDeterminant: atMinus === null ? null : atMinus < 0n ? -atMinus : atMinus,
    symmetric: delta ? isPalindromic(delta) : false,
  };
}

/** Δ of a connected sum is the product of the summands' Δ (used to build composite table rows). */
export function productOf(...ps: Poly[]): Poly {
  return ps.reduce((acc, p) => mul(acc, p), ONE);
}
