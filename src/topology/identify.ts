// Identification: compare the normalised Alexander polynomial with the table and word the
// result honestly. A match means "consistent with", never "is": the Alexander polynomial
// cannot see mirror images, and bigger knots can share a polynomial with a small one.

import { type Poly, equals, fromNumbers } from './poly.ts';
import { KNOT_TABLE, type KnotEntry, MAX_TABLE_CROSSINGS } from './table.ts';

export type Verdict =
  /** Fewer than 3 crossings: every such diagram is an unknot, so this one is certain. */
  | { readonly kind: 'trivial-diagram'; readonly crossings: number; readonly entry: KnotEntry }
  /** One or more table entries share the polynomial. */
  | { readonly kind: 'match'; readonly crossings: number; readonly candidates: readonly KnotEntry[] }
  /** No table entry shares the polynomial. */
  | { readonly kind: 'no-match'; readonly crossings: number }
  /** The polynomial could not be computed (too many crossings, or an unreadable view). */
  | { readonly kind: 'unavailable'; readonly crossings: number | null; readonly reason: string };

const UNKNOT = KNOT_TABLE[0]!;

/** Table rows whose Δ equals `delta` (after the same normalisation). */
export function candidatesFor(delta: Poly): KnotEntry[] {
  return KNOT_TABLE.filter((k) => equals(fromNumbers(k.alexander), delta));
}

export function identify(delta: Poly | null, crossings: number): Verdict {
  if (crossings < 3) return { kind: 'trivial-diagram', crossings, entry: UNKNOT };
  if (delta === null) return { kind: 'unavailable', crossings, reason: 'the determinant came out as zero' };
  // A diagram with c crossings is an upper bound on the knot's crossing number, so any
  // genuine match has crossing number ≤ c. (Every table row is distinguished by Δ except
  // the granny/square pair, so this filter never hides a true candidate.)
  const candidates = candidatesFor(delta).filter((k) => k.crossingNumber <= crossings);
  if (candidates.length === 0) return { kind: 'no-match', crossings };
  return { kind: 'match', crossings, candidates };
}

function nameOf(k: KnotEntry): string {
  return k.name ? `the ${k.name} (${k.label})` : `the knot ${k.label}`;
}

export interface Wording {
  /** One line headline, e.g. "Consistent with the figure-eight knot (4₁)". */
  readonly headline: string;
  /** Plain-English explanation of how sure we are and why. */
  readonly detail: string;
}

/** The words the page shows. Kept here so tests can hold them to the honesty rules. */
export function describe(v: Verdict): Wording {
  switch (v.kind) {
    case 'trivial-diagram':
      return {
        headline: 'The unknot (0₁)',
        detail:
          v.crossings === 0
            ? 'This view shows no crossings at all, so the rope is an untangled loop.'
            : `This view shows ${v.crossings} crossing${v.crossings === 1 ? '' : 's'}. Any knot diagram with fewer than three crossings can be untangled, so this one is certain.`,
      };
    case 'match': {
      const [first] = v.candidates;
      if (!first) throw new Error('match without candidates');
      if (first.id === '0_1') {
        return {
          headline: 'Consistent with the unknot (0₁)',
          detail:
            'Its Alexander polynomial is 1. The unknot is the only knot in the table (up to 7 crossings) with Δ = 1, ' +
            'but some larger knots — the smallest have 11 crossings — also have Δ = 1, so this is strong evidence, not proof.',
        };
      }
      const mirror = v.candidates.some((k) => k.chiral)
        ? ' The Alexander polynomial cannot tell a knot from its mirror image, so left- and right-handed versions look the same here.'
        : '';
      if (v.candidates.length === 1) {
        return {
          headline: `Consistent with ${nameOf(first)}`,
          detail:
            `Its Alexander polynomial matches ${first.label} and nothing else in the table of knots up to ${MAX_TABLE_CROSSINGS} crossings. ` +
            `Knots with more crossings can share a polynomial, so this is evidence, not proof.${mirror}`,
        };
      }
      const names = v.candidates.map(nameOf);
      const list = names.length === 2 ? `${names[0]} or ${names[1]}` : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
      return {
        headline: `Consistent with ${list}`,
        detail:
          `${v.candidates.length} knots in the table share this Alexander polynomial, and the polynomial cannot tell them apart. ` +
          `Knots with more crossings can share it too.${mirror}`,
      };
    }
    case 'no-match':
      return {
        headline: 'Not in our table',
        detail:
          `No knot in the table (every prime knot up to ${MAX_TABLE_CROSSINGS} crossings, plus the granny, square and 3₁ # 4₁ composites) ` +
          'has this Alexander polynomial, so this is none of them. Naming it would need a larger table.',
      };
    case 'unavailable':
      return { headline: 'Not identified', detail: `The polynomial was not computed: ${v.reason}.` };
  }
}
