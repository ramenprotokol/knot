// The whole pipeline, independent of any rendering: rope + view → diagram → PD code →
// Alexander polynomial → identification.

import { type Frame, type Vec3, dot, frameFromDirection } from './geometry.ts';
import { type Diagram, extractDiagram, planarHits } from './crossings.ts';
import { toFrame } from './geometry.ts';
import type { PDCode } from './pd.ts';
import { type AlexanderWorking, alexander } from './alexander.ts';
import { type Verdict, type Wording, describe, identify } from './identify.ts';

/** Above this many crossings the page does not compute the polynomial (it would get slow). */
export const MAX_ANALYSE_CROSSINGS = 100;

export interface Analysis {
  readonly diagram: Diagram | null;
  readonly pd: PDCode;
  readonly alexander: AlexanderWorking | null;
  readonly verdict: Verdict;
  readonly wording: Wording;
  /** True when the polynomial was skipped on purpose (see AnalyseOptions). */
  readonly deferred?: boolean;
}

export interface AnalyseOptions {
  /**
   * Skip the polynomial when the view has more crossings than this. The page uses it while
   * the figure is being dragged: Δ is the same from every view, so it can wait for the release.
   */
  readonly deferPolynomialAbove?: number;
}

export function analyse(curve: Float64Array, frame: Frame, opts: AnalyseOptions = {}): Analysis {
  const dr = extractDiagram(curve, frame);
  if (!dr.ok) {
    const verdict: Verdict = { kind: 'unavailable', crossings: null, reason: dr.message };
    return { diagram: null, pd: [], alexander: null, verdict, wording: describe(verdict) };
  }
  const diagram = dr.diagram;
  const pd = diagram.crossings.map((c) => c.pd);
  const n = pd.length;
  if (n > MAX_ANALYSE_CROSSINGS) {
    const verdict: Verdict = {
      kind: 'unavailable',
      crossings: n,
      reason: `this view has ${n} crossings and the page stops at ${MAX_ANALYSE_CROSSINGS} — relax the rope or turn it for a simpler view`,
    };
    return { diagram, pd, alexander: null, verdict, wording: describe(verdict) };
  }
  if (opts.deferPolynomialAbove !== undefined && n > opts.deferPolynomialAbove) {
    const verdict: Verdict = { kind: 'unavailable', crossings: n, reason: 'it is worked out again when you let go' };
    return { diagram, pd, alexander: null, verdict, wording: describe(verdict), deferred: true };
  }
  const alex = alexander(pd);
  if (alex.atOne !== null && alex.atOne !== 1n) {
    // Δ(1) = ±1 for every knot; after normalisation it must be exactly 1.
    const verdict: Verdict = { kind: 'unavailable', crossings: n, reason: `Δ(1) came out as ${alex.atOne}, which no knot can have` };
    return { diagram, pd, alexander: alex, verdict, wording: describe(verdict) };
  }
  const verdict = identify(alex.delta, n);
  return { diagram, pd, alexander: alex, verdict, wording: describe(verdict) };
}

/** Evenly spread directions over a hemisphere (a view and its opposite show the same crossings). */
export function hemisphereDirections(count: number): Vec3[] {
  const out: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < count; k++) {
    const z = 1 - (k + 0.5) / count;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    out.push([r * Math.cos(k * golden), r * Math.sin(k * golden), z]);
  }
  return out;
}

export interface ViewSearch {
  readonly direction: Vec3;
  readonly crossings: number;
  readonly tried: number;
  readonly currentCrossings: number;
}

/** Crossing count of a view, and how far apart its closest two crossings are (for legibility). */
function viewScore(curve: Float64Array, dir: Vec3): { count: number; spread: number } {
  const hr = planarHits(toFrame(curve, frameFromDirection(dir)), 3);
  if (!hr.ok) return { count: Infinity, spread: 0 };
  let spread = Infinity;
  const h = hr.hits;
  for (let i = 0; i < h.length; i++) {
    for (let j = i + 1; j < h.length; j++) spread = Math.min(spread, Math.hypot(h[i]!.x - h[j]!.x, h[i]!.y - h[j]!.y));
  }
  return { count: h.length, spread };
}

/**
 * Look at the rope from `count` directions and return the one with the fewest crossings;
 * among equals, the one whose crossings are furthest apart (easiest to read), keeping the
 * current view unless another is clearly better. This only gives an upper bound on the
 * crossing number.
 */
export function simplestView(curve: Float64Array, current: Vec3, count = 64): ViewSearch {
  const now = viewScore(curve, current);
  let best: Vec3 = current;
  let bestScore = now;
  for (const d of hemisphereDirections(count)) {
    // Keep the new view on the same side as the current one, so the picture doesn't mirror-flip.
    const dir: Vec3 = dot(d, current) < 0 ? [-d[0], -d[1], -d[2]] : d;
    const s = viewScore(curve, dir);
    if (s.count < bestScore.count || (s.count === bestScore.count && s.spread > bestScore.spread * 1.15)) {
      best = dir;
      bestScore = s;
    }
  }
  // A degenerate current view has no score above, but the page reads it after a tiny nudge;
  // report the count it shows.
  const shown = Number.isFinite(now.count) ? null : extractDiagram(curve, frameFromDirection(current));
  return {
    direction: best,
    crossings: Number.isFinite(bestScore.count) ? bestScore.count : -1,
    tried: count + 1,
    currentCrossings: Number.isFinite(now.count) ? now.count : shown?.ok ? shown.diagram.crossings.length : -1,
  };
}
