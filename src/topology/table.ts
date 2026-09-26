// The knot table: every prime knot with up to 7 crossings (Rolfsen's table), plus the three
// composite knots with up to 7 crossings. Mirror images are not listed separately because the
// Alexander polynomial cannot tell a knot from its mirror image.
//
// Source: D. Rolfsen, "Knots and Links" (1976), Appendix C, as reproduced in the Knot Atlas
// (katlas.org, "The Rolfsen Knot Table"), checked on 2026-09-26; see also C. Livingston and
// A. H. Moore, "KnotInfo: Table of Knot Invariants", knotinfo.org. The polynomials are
// mathematical facts, typed in by hand; tests/unit/table.test.ts recomputes every one of them
// from the Knot Atlas PD codes with this project's own Alexander-matrix code.
//
// Normalisation: coefficients lowest power first, lowest power t⁰, and Δ(1) = +1.
// Composite rows use Δ(K₁ # K₂) = Δ(K₁)·Δ(K₂).

export interface KnotEntry {
  /** Rolfsen name, e.g. "4_1", or "3_1#3_1" for a composite. */
  readonly id: string;
  /** Display label with subscripts, e.g. "4₁". */
  readonly label: string;
  /** Common name, if it has one. */
  readonly name: string | null;
  /** Minimal crossing number. */
  readonly crossingNumber: number;
  readonly alexander: readonly number[];
  readonly composite: boolean;
  /** True if the knot differs from its mirror image. */
  readonly chiral: boolean;
  /** A short note, e.g. the rope knot it comes from. */
  readonly note: string | null;
}

const entry = (
  id: string,
  label: string,
  name: string | null,
  crossingNumber: number,
  alexander: readonly number[],
  chiral: boolean,
  note: string | null = null,
  composite = false,
): KnotEntry => ({ id, label, name, crossingNumber, alexander, composite, chiral, note });

export const KNOT_TABLE: readonly KnotEntry[] = [
  entry('0_1', '0₁', 'unknot', 0, [1], false, 'A plain loop: no crossings are needed.'),
  entry('3_1', '3₁', 'trefoil', 3, [1, -1, 1], true, 'An overhand knot with its ends joined.'),
  entry('4_1', '4₁', 'figure-eight knot', 4, [-1, 3, -1], false, 'A figure-eight stopper with its ends joined.'),
  entry('5_1', '5₁', 'cinquefoil', 5, [1, -1, 1, -1, 1], true, 'The (2,5) torus knot.'),
  entry('5_2', '5₂', 'three-twist knot', 5, [2, -3, 2], true),
  entry('6_1', '6₁', 'stevedore knot', 6, [-2, 5, -2], true, 'A stevedore stopper with its ends joined.'),
  entry('6_2', '6₂', 'Miller Institute knot', 6, [-1, 3, -3, 3, -1], true),
  entry('6_3', '6₃', null, 6, [1, -3, 5, -3, 1], false),
  entry('7_1', '7₁', 'septafoil', 7, [1, -1, 1, -1, 1, -1, 1], true, 'The (2,7) torus knot.'),
  entry('7_2', '7₂', null, 7, [3, -5, 3], true),
  entry('7_3', '7₃', null, 7, [2, -3, 3, -3, 2], true),
  entry('7_4', '7₄', 'endless knot', 7, [4, -7, 4], true),
  entry('7_5', '7₅', null, 7, [2, -4, 5, -4, 2], true),
  entry('7_6', '7₆', null, 7, [-1, 5, -7, 5, -1], true),
  entry('7_7', '7₇', null, 7, [1, -5, 9, -5, 1], true),
  entry('3_1#3_1', '3₁ # 3₁', 'granny knot', 6, [1, -2, 3, -2, 1], true, 'Two trefoils of the same handedness in a row.', true),
  entry('3_1#3_1*', '3₁ # 3₁*', 'square knot', 6, [1, -2, 3, -2, 1], false, 'A trefoil and its mirror image in a row (a reef knot).', true),
  entry('3_1#4_1', '3₁ # 4₁', null, 7, [-1, 4, -5, 4, -1], true, 'A trefoil and a figure-eight in a row.', true),
];

export const TABLE_SOURCE =
  'Rolfsen, Knots and Links (1976), Appendix C, via the Knot Atlas (katlas.org); cross-reference: Livingston & Moore, KnotInfo (knotinfo.org).';

export const MAX_TABLE_CROSSINGS = 7;
