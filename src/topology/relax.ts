// Relaxation: a cheap energy minimisation that lets the rope settle into an open, readable
// shape without ever passing through itself.
//
// Each step gives every point four pushes:
//   • a spring along each edge, towards the rest length (the rope keeps its length);
//   • bending: towards the midpoint of its neighbours (smooths kinks);
//   • a weak 1/r² repulsion from every point not near it along the rope (opens the knot out);
//   • a contact push wherever two stretches of rope come closer than the rope's thickness.
// Each point's push is then clamped so it moves no more than `gapSafety` (0.45) × the current
// smallest gap between non-neighbouring segments. When every point moves less than half that
// gap along a straight line, no two segments can meet, so the knot type cannot change —
// this is a guarantee, not a hope. Steps are capped (`maxSteps`), so the work is bounded.
//
// Repulsion stretches the rope as it opens out (by up to about 40%), and each run measures
// its rest length from the rope it is given, so repeated runs would compound. `shaped()`
// therefore hands back the rope scaled back to the size it started at: a uniform scaling is a
// similarity, which cannot change the knot, and it keeps the drawn rope's apparent thickness.

import { type Closest, type Vec3, boundingRadius, centroid, pointCount, segmentClosest, totalLength } from './geometry.ts';

export interface RelaxParams {
  /** Hard cap on steps (a relaxer never runs longer). */
  readonly maxSteps: number;
  readonly spring: number;
  readonly bend: number;
  readonly repel: number;
  /** Strength of the thick-rope contact push. */
  readonly contact: number;
  /** Rope thickness (world units): closer strands are pushed apart. */
  readonly thickness: number;
  /** Largest move per step as a fraction of the rest length. */
  readonly maxMove: number;
  /** Fraction of the current minimum gap a point may move in one step (< 0.5 for safety). */
  readonly gapSafety: number;
  /** Stop early once the largest move falls below this fraction of the rest length. */
  readonly tolerance: number;
}

export const DEFAULT_RELAX: RelaxParams = {
  maxSteps: 600,
  spring: 0.5,
  bend: 0.2,
  repel: 0.06,
  contact: 0.35,
  thickness: 0.5,
  maxMove: 0.25,
  gapSafety: 0.45,
  tolerance: 0.002,
};

export interface RelaxStats {
  readonly steps: number;
  readonly done: boolean;
  /** Smallest gap between non-neighbouring segments now. */
  readonly gap: number;
  /** Smallest gap seen at any step (never 0 by construction). */
  readonly minGapSeen: number;
  /** Largest single-point move in the latest step. */
  readonly lastMove: number;
  /** Largest move allowed in the latest step (0.45 × gap, or the rest-length cap). */
  readonly lastCap: number;
  readonly restLength: number;
  readonly lengthStart: number;
  readonly lengthNow: number;
  /** Uniform scale that brings the rope back to its starting size (see `shaped`). */
  readonly scale: number;
  /** Length of the rope after that scaling. */
  readonly lengthShaped: number;
}

export interface Relaxer {
  /** Run up to k more steps; returns the stats after them. */
  step(k: number): RelaxStats;
  /** The working positions (they grow as the rope opens out). */
  readonly curve: Float64Array;
  stats(): RelaxStats;
  /** A copy of the rope, centred where it started and scaled back to its starting bounding radius. */
  shaped(): Float64Array;
}

/**
 * A copy of `c` moved so its centroid is `centre` and scaled about it so its bounding radius
 * is `radius`. Translation and uniform scaling cannot change a knot.
 */
export function similarTo(c: Float64Array, centre: Vec3, radius: number): { curve: Float64Array; scale: number } {
  const [cx, cy, cz] = centroid(c);
  const r = boundingRadius(c, [cx, cy, cz]);
  const k = r > 0 && radius > 0 ? radius / r : 1;
  const out = new Float64Array(c.length);
  for (let i = 0; i < c.length; i += 3) {
    out[i] = centre[0] + (c[i]! - cx) * k;
    out[i + 1] = centre[1] + (c[i + 1]! - cy) * k;
    out[i + 2] = centre[2] + (c[i + 2]! - cz) * k;
  }
  return { curve: out, scale: k };
}

/** 1/r² repulsion skips point pairs this close along the rope (springs and bending hold them). */
const SKIP = 3;

export function createRelaxer(start: Float64Array, params: RelaxParams = DEFAULT_RELAX): Relaxer {
  const n = pointCount(start);
  const P = Float64Array.from(start);
  const F = new Float64Array(P.length);
  const C = new Float64Array(P.length); // contact pushes for the current positions
  const mx = new Float64Array(n), my = new Float64Array(n), mz = new Float64Array(n), hl = new Float64Array(n);
  const lengthStart = totalLength(P);
  const L0 = lengthStart / n;
  const startCentre = centroid(P);
  const startRadius = boundingRadius(P, startCentre);
  const D = params.thickness;
  // Contact ignores segment pairs closer than this many segments along the rope.
  const contactSkip = Math.max(2, Math.ceil((1.6 * D) / L0));
  const scratch: Closest = { s: 0, t: 0, d: 0 };
  let gap = Infinity;
  let minGapSeen = Infinity;
  let steps = 0;
  let lastMove = 0;
  let lastCap = 0;
  let done = false;

  /**
   * One pass over segment pairs for the current positions: returns the minimum gap between
   * non-neighbouring segments and fills C with the thick-rope contact pushes.
   */
  const pairs = (): number => {
    C.fill(0);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      mx[i] = (P[3 * i]! + P[3 * j]!) / 2;
      my[i] = (P[3 * i + 1]! + P[3 * j + 1]!) / 2;
      mz[i] = (P[3 * i + 2]! + P[3 * j + 2]!) / 2;
      const ex = P[3 * j]! - P[3 * i]!, ey = P[3 * j + 1]! - P[3 * i + 1]!, ez = P[3 * j + 2]! - P[3 * i + 2]!;
      hl[i] = Math.sqrt(ex * ex + ey * ey + ez * ez) / 2;
    }
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      const mxi = mx[i]!, myi = my[i]!, mzi = mz[i]!, hli = hl[i]!;
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const ax = mxi - mx[j]!, ay = myi - my[j]!, az = mzi - mz[j]!;
        const lower = Math.sqrt(ax * ax + ay * ay + az * az) - hli - hl[j]!;
        if (lower >= best && lower >= D) continue;
        const j1 = (j + 1) % n;
        segmentClosest(
          P[3 * i]!, P[3 * i + 1]!, P[3 * i + 2]!, P[3 * i1]!, P[3 * i1 + 1]!, P[3 * i1 + 2]!,
          P[3 * j]!, P[3 * j + 1]!, P[3 * j + 2]!, P[3 * j1]!, P[3 * j1 + 1]!, P[3 * j1 + 2]!,
          scratch,
        );
        const d = scratch.d;
        if (d < best) best = d;
        if (d >= D) continue;
        const along = Math.min(j - i, n - (j - i));
        if (along <= contactSkip) continue;
        const s = scratch.s, t = scratch.t;
        let dx = P[3 * i]! + (P[3 * i1]! - P[3 * i]!) * s - (P[3 * j]! + (P[3 * j1]! - P[3 * j]!) * t);
        let dy = P[3 * i + 1]! + (P[3 * i1 + 1]! - P[3 * i + 1]!) * s - (P[3 * j + 1]! + (P[3 * j1 + 1]! - P[3 * j + 1]!) * t);
        let dz = P[3 * i + 2]! + (P[3 * i1 + 2]! - P[3 * i + 2]!) * s - (P[3 * j + 2]! + (P[3 * j1 + 2]! - P[3 * j + 2]!) * t);
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-12) continue;
        const f = (params.contact * (D - d)) / len;
        dx *= f;
        dy *= f;
        dz *= f;
        C[3 * i]! += dx * (1 - s);
        C[3 * i + 1]! += dy * (1 - s);
        C[3 * i + 2]! += dz * (1 - s);
        C[3 * i1]! += dx * s;
        C[3 * i1 + 1]! += dy * s;
        C[3 * i1 + 2]! += dz * s;
        C[3 * j]! -= dx * (1 - t);
        C[3 * j + 1]! -= dy * (1 - t);
        C[3 * j + 2]! -= dz * (1 - t);
        C[3 * j1]! -= dx * t;
        C[3 * j1 + 1]! -= dy * t;
        C[3 * j1 + 2]! -= dz * t;
      }
    }
    return best;
  };

  gap = pairs();
  minGapSeen = gap;

  const shaped = (): { curve: Float64Array; scale: number } => similarTo(P, startCentre, startRadius);

  const stats = (): RelaxStats => {
    const lengthNow = totalLength(P);
    const { scale } = shaped();
    return {
      steps,
      done,
      gap,
      minGapSeen,
      lastMove,
      lastCap,
      restLength: L0,
      lengthStart,
      lengthNow,
      scale,
      lengthShaped: lengthNow * scale,
    };
  };

  const one = (): void => {
    F.set(C);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const h = (i + n - 1) % n;
      const dx = P[3 * j]! - P[3 * i]!, dy = P[3 * j + 1]! - P[3 * i + 1]!, dz = P[3 * j + 2]! - P[3 * i + 2]!;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-12;
      const k = (params.spring * 0.5 * (len - L0)) / len;
      F[3 * i]! += k * dx;
      F[3 * i + 1]! += k * dy;
      F[3 * i + 2]! += k * dz;
      F[3 * j]! -= k * dx;
      F[3 * j + 1]! -= k * dy;
      F[3 * j + 2]! -= k * dz;
      F[3 * i]! += params.bend * ((P[3 * h]! + P[3 * j]!) / 2 - P[3 * i]!);
      F[3 * i + 1]! += params.bend * ((P[3 * h + 1]! + P[3 * j + 1]!) / 2 - P[3 * i + 1]!);
      F[3 * i + 2]! += params.bend * ((P[3 * h + 2]! + P[3 * j + 2]!) / 2 - P[3 * i + 2]!);
    }
    const q = params.repel * L0 * L0 * L0;
    for (let i = 0; i < n; i++) {
      const xi = P[3 * i]!, yi = P[3 * i + 1]!, zi = P[3 * i + 2]!;
      let fx = 0, fy = 0, fz = 0;
      for (let j = i + SKIP; j < n; j++) {
        if (i + n - j < SKIP) continue;
        const dx = xi - P[3 * j]!, dy = yi - P[3 * j + 1]!, dz = zi - P[3 * j + 2]!;
        const r2 = dx * dx + dy * dy + dz * dz + 1e-12;
        const f = q / (r2 * Math.sqrt(r2));
        fx += f * dx;
        fy += f * dy;
        fz += f * dz;
        F[3 * j]! -= f * dx;
        F[3 * j + 1]! -= f * dy;
        F[3 * j + 2]! -= f * dz;
      }
      F[3 * i]! += fx;
      F[3 * i + 1]! += fy;
      F[3 * i + 2]! += fz;
    }
    // Clamp every point's move to the safe step (gap measured before this step moves anything).
    const cap = Math.min(params.maxMove * L0, params.gapSafety * gap);
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const fx = F[3 * i]!, fy = F[3 * i + 1]!, fz = F[3 * i + 2]!;
      const m = Math.sqrt(fx * fx + fy * fy + fz * fz);
      const k = m > cap ? cap / m : 1;
      P[3 * i]! += fx * k;
      P[3 * i + 1]! += fy * k;
      P[3 * i + 2]! += fz * k;
      moved = Math.max(moved, m * k);
    }
    lastMove = moved;
    lastCap = cap;
    steps++;
    gap = pairs();
    minGapSeen = Math.min(minGapSeen, gap);
    if (moved < params.tolerance * L0 || steps >= params.maxSteps) done = true;
  };

  return {
    curve: P,
    stats,
    shaped: () => shaped().curve,
    step(k: number): RelaxStats {
      for (let s = 0; s < k && !done; s++) one();
      return stats();
    },
  };
}

/** Run to completion (bounded by maxSteps); the rope comes back at its starting size. */
export function relax(start: Float64Array, params: RelaxParams = DEFAULT_RELAX): { curve: Float64Array; stats: RelaxStats } {
  const r = createRelaxer(start, params);
  const stats = r.step(params.maxSteps);
  return { curve: r.shaped(), stats };
}
