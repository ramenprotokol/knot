// Example knots, built deterministically so tests and the page see the same curves.

import { fitToRadius, resampleClosed } from './geometry.ts';

export const PRESET_RADIUS = 4.2;

function sample(n: number, f: (t: number) => readonly [number, number, number]): Float64Array {
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = f((2 * Math.PI * i) / n);
    out[3 * i] = x;
    out[3 * i + 1] = y;
    out[3 * i + 2] = z;
  }
  return out;
}

/** A gently wavy loop: the unknot, no crossings from above. */
export function unknotCurve(n = 120): Float64Array {
  return fitToRadius(
    sample(n, (t) => [Math.cos(t) * (1 + 0.12 * Math.cos(3 * t)), Math.sin(t) * (1 + 0.12 * Math.cos(3 * t)), 0.35 * Math.sin(2 * t)]),
    PRESET_RADIUS,
  );
}

/** The standard trefoil: (sin t + 2 sin 2t, cos t − 2 cos 2t, −sin 3t). */
export function trefoilCurve(n = 150): Float64Array {
  return fitToRadius(
    sample(n, (t) => [Math.sin(t) + 2 * Math.sin(2 * t), Math.cos(t) - 2 * Math.cos(2 * t), -Math.sin(3 * t)]),
    PRESET_RADIUS,
  );
}

/** The figure-eight knot: ((2 + cos 2t) cos 3t, (2 + cos 2t) sin 3t, sin 4t). */
export function figureEightCurve(n = 180): Float64Array {
  return fitToRadius(
    sample(n, (t) => [(2 + Math.cos(2 * t)) * Math.cos(3 * t), (2 + Math.cos(2 * t)) * Math.sin(3 * t), Math.sin(4 * t)]),
    PRESET_RADIUS,
  );
}

/** The (p, q) torus knot winding p times round the axis: 5₁ is (2, 5). */
export function torusKnotCurve(p: number, q: number, n = 200): Float64Array {
  return fitToRadius(
    sample(n, (t) => {
      const r = 2 + Math.cos(q * t);
      return [r * Math.cos(p * t), r * Math.sin(p * t), -Math.sin(q * t) * 0.9];
    }),
    PRESET_RADIUS,
  );
}

/**
 * The closure of a braid. `word` lists generators: +i is σᵢ (strand in position i passes over
 * position i + 1), −i is σᵢ⁻¹. Strands sit on nested circles round the braid axis; each
 * generator swaps two neighbouring circles over one slot of angle, one strand rising and one
 * dipping. The braid's permutation must be a single cycle so the closure is one rope.
 */
export function braidClosureCurve(strands: number, word: readonly number[], n = 220): Float64Array {
  if (strands < 1 || word.length === 0) throw new RangeError('empty braid');
  for (const g of word) {
    if (!Number.isInteger(g) || g === 0 || Math.abs(g) >= strands) throw new RangeError(`bad generator ${g}`);
  }
  const L = word.length;
  const perSlot = 10;
  const r0 = 2.2, dr = 1.0, h = 0.55;
  // Follow one strand (by the circle it is on) through every slot, lap after lap, until it
  // returns to where it started; a single cycle visits every circle once.
  const pts: number[] = [];
  let pos = 0;
  const visited = new Set<number>();
  for (let lap = 0; lap < strands; lap++) {
    if (visited.has(pos)) throw new RangeError('braid closure has more than one component');
    visited.add(pos);
    for (let g = 0; g < L; g++) {
      const gen = word[g]!;
      const i = Math.abs(gen) - 1; // swaps positions i and i + 1
      const moving = pos === i ? 1 : pos === i + 1 ? -1 : 0;
      for (let k = 0; k < perSlot; k++) {
        const tau = k / perSlot;
        const ang = (2 * Math.PI * (g + tau)) / L;
        const smooth = tau * tau * (3 - 2 * tau);
        let radius = r0 + dr * pos;
        let z = 0;
        if (moving !== 0) {
          radius = r0 + dr * (pos + moving * smooth);
          // For σᵢ (gen > 0) the strand moving outward (from i to i + 1) goes over.
          const over = (moving === 1) === gen > 0;
          z = (over ? 1 : -1) * h * Math.sin(Math.PI * tau);
        }
        pts.push(radius * Math.cos(ang), radius * Math.sin(ang), z);
      }
      if (moving !== 0) pos += moving;
    }
  }
  if (pos !== 0) throw new RangeError('braid closure has more than one component');
  if (visited.size !== strands) throw new RangeError('braid closure has more than one component');
  return fitToRadius(resampleClosed(Float64Array.from(pts), 3, n), PRESET_RADIUS);
}

export interface Preset {
  readonly id: string;
  readonly title: string;
  /** Rolfsen label of the knot it is built to be, for tests. */
  readonly expected: string;
  readonly build: () => Float64Array;
  readonly blurb: string;
}

/** σ₁σ₂σ₃ closes to an unknot; conjugating by u = σ₂σ₁⁻¹σ₃⁻¹σ₂ keeps the closure the same knot. */
export const TANGLED_UNKNOT_WORD: readonly number[] = [2, -1, -3, 2, 1, 2, 3, -2, 3, 1, -2];

export const PRESETS: readonly Preset[] = [
  { id: 'unknot', title: 'Unknot', expected: '0_1', build: () => unknotCurve(), blurb: 'A plain loop of rope.' },
  { id: 'trefoil', title: 'Trefoil', expected: '3_1', build: () => trefoilCurve(), blurb: 'An overhand knot with the ends joined.' },
  { id: 'figure-eight', title: 'Figure-eight', expected: '4_1', build: () => figureEightCurve(), blurb: 'A figure-eight stopper with the ends joined.' },
  { id: 'cinquefoil', title: 'Cinquefoil', expected: '5_1', build: () => torusKnotCurve(2, 5), blurb: 'Wound twice round, five times through.' },
  {
    id: 'three-twist',
    title: 'Three-twist',
    expected: '5_2',
    build: () => braidClosureCurve(3, [1, 1, 1, 2, -1, 2], 200),
    blurb: 'Closed braid σ₁³σ₂σ₁⁻¹σ₂: six crossings drawn, five needed.',
  },
  {
    id: 'tangled',
    title: 'Tangled',
    expected: '0_1',
    build: () => braidClosureCurve(4, TANGLED_UNKNOT_WORD, 240),
    blurb: 'Eleven crossings from above, and yet its Alexander polynomial is 1.',
  },
];

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
