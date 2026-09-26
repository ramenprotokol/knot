// From a drawing to a rope, and flipping crossings.
//
// A freehand loop is cleaned, closed and resampled. Its self-crossings are found in the
// plane and given alternating over/under (the classic default: a drawing whose crossings
// alternate is knotted whenever it can be). The rope is then lifted into 3D by raising the
// over-strand and lowering the under-strand in a small bump around each crossing.
//
// Flipping a crossing uses the same bump idea on an existing rope: only the depth of the two
// strands near that crossing changes. Each bump covers a stretch of rope containing no other
// crossing, so in the picture plane it can only meet the rest of the rope at that one
// crossing, where the new depths differ. The result is always a valid, non-self-intersecting
// rope whose diagram differs from the old one in exactly that crossing.

import { type Frame, MAX_POINTS, TOP_FRAME, fromFrame, pointCount, resampleClosed, toFrame } from './geometry.ts';
import { type Diagram, planarHits } from './crossings.ts';

/** Lift height at crossings (world units). The rope's radius is 0.2, so strands clear by 0.2. */
export const LIFT = 0.3;
export const MAX_STROKE_POINTS = 6000;
export const MAX_DRAW_CROSSINGS = 30;
const MIN_STROKE_LENGTH = 3;

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/** Clean, close, resample and smooth a freehand stroke given as x0 y0 x1 y1 … */
export function prepareStroke(raw: ArrayLike<number>): Result<Float64Array> {
  if (raw.length % 2 !== 0) return { ok: false, error: 'the stroke data is malformed' };
  const count = Math.min(raw.length / 2, MAX_STROKE_POINTS);
  const pts: number[] = [];
  let lx = NaN, ly = NaN;
  for (let i = 0; i < count; i++) {
    const x = raw[2 * i]!, y = raw[2 * i + 1]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: 'the stroke has an invalid point' };
    if (Math.hypot(x - lx, y - ly) < 1e-6) continue;
    pts.push(x, y);
    lx = x;
    ly = y;
  }
  const m = pts.length / 2;
  if (m < 8) return { ok: false, error: 'that stroke is too short — draw one bigger loop' };
  let L = 0, minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    if (i < m - 1) L += Math.hypot(pts[2 * j]! - pts[2 * i]!, pts[2 * j + 1]! - pts[2 * i + 1]!);
    minx = Math.min(minx, pts[2 * i]!);
    maxx = Math.max(maxx, pts[2 * i]!);
    miny = Math.min(miny, pts[2 * i + 1]!);
    maxy = Math.max(maxy, pts[2 * i + 1]!);
  }
  if (L < MIN_STROKE_LENGTH || Math.max(maxx - minx, maxy - miny) < 1) {
    return { ok: false, error: 'that stroke is too small — draw one bigger loop' };
  }
  const n = Math.max(60, Math.min(280, Math.round(L / 0.14)));
  let c = resampleClosed(Float64Array.from(pts), 2, n);
  // Three gentle smoothing passes take the jitter out of a hand-drawn line.
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float64Array(c.length);
    for (let i = 0; i < n; i++) {
      const h = (i + n - 1) % n, j = (i + 1) % n;
      for (let k = 0; k < 2; k++) next[2 * i + k] = 0.5 * c[2 * i + k]! + 0.25 * (c[2 * h + k]! + c[2 * j + k]!);
    }
    c = next;
  }
  return { ok: true, value: resampleClosed(c, 2, n) };
}

interface Target {
  /** Segment index + fraction along it. */
  readonly param: number;
  readonly depth: number;
}

/** Arc length of the picture-plane shadow at each point (cum[i]) and in total (cum[n]). */
function shadowArcLength(local: Float64Array): Float64Array {
  const n = pointCount(local);
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    cum[i + 1] = cum[i]! + Math.hypot(local[3 * j]! - local[3 * i]!, local[3 * j + 1]! - local[3 * i + 1]!);
  }
  return cum;
}

function sigmaOf(cum: Float64Array, param: number): number {
  const seg = Math.floor(param);
  return cum[seg]! + (cum[seg + 1]! - cum[seg]!) * (param - seg);
}

function cyclicDist(a: number, b: number, L: number): number {
  const d = Math.abs(a - b) % L;
  return Math.min(d, L - d);
}

/**
 * Set the depth of the rope at the given passages, in frame coordinates. `allEvents` lists
 * every passage of every crossing (params), so each bump can stay clear of the others.
 */
function setDepths(local: Float64Array, allEvents: readonly number[], targets: readonly Target[]): Result<Float64Array> {
  const n = pointCount(local);
  let cum = shadowArcLength(local);
  const L = cum[n]!;
  const evSigma = allEvents.map((p) => sigmaOf(cum, p));
  interface Bump {
    sigma: number;
    plateau: number;
    outer: number;
    depth: number;
    param: number;
  }
  const bumps: Bump[] = targets.map((t) => {
    const sigma = sigmaOf(cum, t.param);
    let gap = L;
    for (const s of evSigma) {
      const d = cyclicDist(s, sigma, L);
      if (d > 1e-9) gap = Math.min(gap, d);
    }
    const outer = Math.min(0.48 * gap, 1.6);
    return { sigma, plateau: 0.45 * outer, outer, depth: t.depth, param: t.param };
  });

  // Insert points so the segment carrying each crossing has both ends on the bump's plateau.
  const inserts: { seg: number; frac: number }[] = [];
  for (const b of bumps) {
    const seg = Math.floor(b.param);
    const a0 = cum[seg]!, a1 = cum[seg + 1]!;
    const len = a1 - a0;
    if (len <= 0) continue;
    if (b.sigma - a0 > b.plateau) inserts.push({ seg, frac: (b.sigma - b.plateau / 2 - a0) / len });
    if (a1 - b.sigma > b.plateau) inserts.push({ seg, frac: (b.sigma + b.plateau / 2 - a0) / len });
  }
  if (n + inserts.length > MAX_POINTS) {
    return { ok: false, error: `the rope would need more than ${MAX_POINTS} points — relax it first` };
  }
  inserts.sort((p, q) => p.seg - q.seg || p.frac - q.frac);
  const out: number[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    out.push(local[3 * i]!, local[3 * i + 1]!, local[3 * i + 2]!);
    const j = (i + 1) % n;
    while (k < inserts.length && inserts[k]!.seg === i) {
      const f = inserts[k]!.frac;
      out.push(
        local[3 * i]! + (local[3 * j]! - local[3 * i]!) * f,
        local[3 * i + 1]! + (local[3 * j + 1]! - local[3 * i + 1]!) * f,
        local[3 * i + 2]! + (local[3 * j + 2]! - local[3 * i + 2]!) * f,
      );
      k++;
    }
  }
  const res = Float64Array.from(out);
  cum = shadowArcLength(res);
  const m = pointCount(res);
  for (let i = 0; i < m; i++) {
    const s = cum[i]!;
    for (const b of bumps) {
      const d = cyclicDist(s, b.sigma, L);
      if (d >= b.outer) continue;
      let w = 1;
      if (d > b.plateau) {
        const x = 1 - (d - b.plateau) / (b.outer - b.plateau);
        w = x * x * (3 - 2 * x);
      }
      res[3 * i + 2] = res[3 * i + 2]! * (1 - w) + b.depth * w;
    }
  }
  return { ok: true, value: res };
}

/** Lift a prepared planar loop (x0 y0 x1 y1 …) into a rope with alternating crossings. */
export function liftDrawing(pts2D: Float64Array): Result<Float64Array> {
  const n = pts2D.length / 2;
  const local = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    local[3 * i] = pts2D[2 * i]!;
    local[3 * i + 1] = pts2D[2 * i + 1]!;
  }
  const hr = planarHits(local, 3, MAX_DRAW_CROSSINGS + 1);
  if (!hr.ok) {
    return hr.reason === 'too-many'
      ? { ok: false, error: `that loop crosses itself more than ${MAX_DRAW_CROSSINGS} times — try a simpler one` }
      : { ok: false, error: 'two parts of the line lie exactly on top of each other — try drawing again' };
  }
  // Passages in order along the loop; alternate over, under, over, …
  const passages = hr.hits.flatMap((h, k) => [
    { param: h.i + h.s, hit: k, first: true },
    { param: h.j + h.t, hit: k, first: false },
  ]);
  passages.sort((p, q) => p.param - q.param);
  const targets: Target[] = passages.map((p, idx) => ({ param: p.param, depth: idx % 2 === 0 ? LIFT : -LIFT }));
  // Sanity: the two passes through each crossing must disagree (true for any closed planar curve).
  const byHit = new Map<number, number[]>();
  passages.forEach((p, idx) => byHit.set(p.hit, [...(byHit.get(p.hit) ?? []), idx % 2]));
  for (const v of byHit.values()) if (v[0] === v[1]) return { ok: false, error: 'could not alternate the crossings' };
  const lifted = setDepths(local, passages.map((p) => p.param), targets);
  if (!lifted.ok) return lifted;
  return { ok: true, value: fromFrame(lifted.value, TOP_FRAME) };
}

/** Swap which strand goes over at crossing `id` of `diagram` (computed from `curve`). */
export function flipCrossing(curve: Float64Array, diagram: Diagram, id: number): Result<Float64Array> {
  const c = diagram.crossings.find((k) => k.id === id);
  if (!c) return { ok: false, error: `there is no crossing ${id}` };
  const frame: Frame = diagram.frame;
  const local = toFrame(curve, frame);
  const mean = (c.over.depth + c.under.depth) / 2;
  const half = Math.max(LIFT, Math.abs(c.over.depth - c.under.depth) / 2);
  const all = diagram.crossings.flatMap((k) => [k.over.param, k.under.param]);
  const res = setDepths(local, all, [
    { param: c.under.param, depth: mean + half },
    { param: c.over.param, depth: mean - half },
  ]);
  if (!res.ok) return res;
  return { ok: true, value: fromFrame(res.value, frame) };
}
