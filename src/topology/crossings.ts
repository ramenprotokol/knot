// Crossing extraction: project the closed rope onto the picture plane of a frame, find
// where the shadow crosses itself, read over/under from depth, number the crossings in
// the order the rope first reaches them, and write the planar diagram (PD) code.

import { type Frame, type Vec3, nudgeFrame, pointCount, toFrame } from './geometry.ts';
import type { PDCrossing } from './pd.ts';

/** Hard cap on crossings found in one projection, so a hostile curve can't blow up memory. */
export const MAX_FOUND_CROSSINGS = 400;

/** One place where the projection crosses itself: segment i at s ∈ [0,1), segment j at t ∈ [0,1). */
export interface Hit {
  readonly i: number;
  readonly s: number;
  readonly j: number;
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

export type HitsResult =
  | { readonly ok: true; readonly hits: readonly Hit[] }
  | { readonly ok: false; readonly reason: 'degenerate' | 'too-many' };

const PARAM_EPS = 1e-9;

/**
 * All transversal self-intersections of a closed polyline's shadow. `pts` holds points with
 * the given stride; only the first two coordinates are used. Returns 'degenerate' when the
 * shadow touches itself at a vertex or runs along itself (a nudge of the view fixes that).
 */
export function planarHits(pts: Float64Array, stride: number, cap = MAX_FOUND_CROSSINGS): HitsResult {
  const n = pts.length / stride;
  const minx = new Float64Array(n), maxx = new Float64Array(n), miny = new Float64Array(n), maxy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * stride]!, ay = pts[i * stride + 1]!, bx = pts[j * stride]!, by = pts[j * stride + 1]!;
    minx[i] = Math.min(ax, bx);
    maxx[i] = Math.max(ax, bx);
    miny[i] = Math.min(ay, by);
    maxy[i] = Math.max(ay, by);
  }
  const hits: Hit[] = [];
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    const px = pts[i * stride]!, py = pts[i * stride + 1]!;
    const rx = pts[i1 * stride]! - px, ry = pts[i1 * stride + 1]! - py;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours through point 0
      if (maxx[j]! < minx[i]! || minx[j]! > maxx[i]! || maxy[j]! < miny[i]! || miny[j]! > maxy[i]!) continue;
      const j1 = (j + 1) % n;
      const qx = pts[j * stride]!, qy = pts[j * stride + 1]!;
      const sx = pts[j1 * stride]! - qx, sy = pts[j1 * stride + 1]! - qy;
      const denom = rx * sy - ry * sx;
      const qpx = qx - px, qpy = qy - py;
      const scaleRS = Math.hypot(rx, ry) * Math.hypot(sx, sy);
      if (Math.abs(denom) <= 1e-12 * scaleRS) {
        // Parallel. Only a problem if the two segments lie on one line and overlap.
        const lineDist = Math.abs(qpx * ry - qpy * rx) / (Math.hypot(rx, ry) || 1);
        if (lineDist < 1e-9) {
          const rr = rx * rx + ry * ry || 1;
          const t0 = (qpx * rx + qpy * ry) / rr;
          const t1 = ((qx + sx - px) * rx + (qy + sy - py) * ry) / rr;
          if (Math.max(t0, t1) >= -PARAM_EPS && Math.min(t0, t1) <= 1 + PARAM_EPS) return { ok: false, reason: 'degenerate' };
        }
        continue;
      }
      const s = (qpx * sy - qpy * sx) / denom;
      const t = (qpx * ry - qpy * rx) / denom;
      if (s < -PARAM_EPS || s > 1 + PARAM_EPS || t < -PARAM_EPS || t > 1 + PARAM_EPS) continue;
      if (s < PARAM_EPS || s > 1 - PARAM_EPS || t < PARAM_EPS || t > 1 - PARAM_EPS) return { ok: false, reason: 'degenerate' };
      hits.push({ i, s, j, t, x: px + rx * s, y: py + ry * s });
      if (hits.length > cap) return { ok: false, reason: 'too-many' };
    }
  }
  return { ok: true, hits };
}

/** A pass of the rope through a crossing. `param` = segment index + position along it. */
export interface Passage {
  readonly seg: number;
  readonly s: number;
  readonly param: number;
  /** Height towards the viewer, in frame units. */
  readonly depth: number;
  /** The point on the rope's centre line, in world coordinates. */
  readonly point: Vec3;
  /** 1-based index of this passage along the rope, from point 0 (the PD event number). */
  readonly event: number;
}

export interface Crossing {
  /** 1-based, in the order the rope first reaches the crossing from point 0. */
  readonly id: number;
  /** Position in the picture plane (frame coordinates). */
  readonly x: number;
  readonly y: number;
  readonly over: Passage;
  readonly under: Passage;
  /** +1 right-handed, -1 left-handed. */
  readonly sign: 1 | -1;
  readonly pd: PDCrossing;
}

export interface Diagram {
  /** The frame actually used (may differ by a tiny nudge from the one requested). */
  readonly frame: Frame;
  readonly nudged: boolean;
  readonly crossings: readonly Crossing[];
  readonly writhe: number;
}

export type DiagramResult =
  | { readonly ok: true; readonly diagram: Diagram }
  | { readonly ok: false; readonly reason: 'degenerate' | 'too-many' | 'singular'; readonly message: string };

const NUDGES: readonly (readonly [number, number])[] = [
  [0, 0],
  [1e-4, 0],
  [0, 1e-4],
  [2.3e-4, 1.7e-4],
  [-3.1e-4, 2.9e-4],
];

/**
 * Project `curve` onto `frame`'s picture plane and build the diagram. If the view is exactly
 * degenerate (a vertex on another strand's shadow), the view is nudged by a fraction of a
 * milliradian and tried again; `nudged` reports that.
 */
export function extractDiagram(curve: Float64Array, frame: Frame): DiagramResult {
  for (const [a, b] of NUDGES) {
    const f = a === 0 && b === 0 ? frame : nudgeFrame(frame, a, b);
    const local = toFrame(curve, f);
    const hr = planarHits(local, 3);
    if (!hr.ok) {
      if (hr.reason === 'too-many') {
        return { ok: false, reason: 'too-many', message: `this view shows more than ${MAX_FOUND_CROSSINGS} crossings` };
      }
      continue;
    }
    const built = buildDiagram(curve, local, hr.hits, f, !(a === 0 && b === 0));
    if (built === 'degenerate') continue;
    return built;
  }
  return { ok: false, reason: 'degenerate', message: 'the rope lies exactly along its own shadow from this angle' };
}

function lerpPoint(c: Float64Array, seg: number, s: number): Vec3 {
  const n = pointCount(c);
  const j = (seg + 1) % n;
  return [
    c[3 * seg]! + (c[3 * j]! - c[3 * seg]!) * s,
    c[3 * seg + 1]! + (c[3 * j + 1]! - c[3 * seg + 1]!) * s,
    c[3 * seg + 2]! + (c[3 * j + 2]! - c[3 * seg + 2]!) * s,
  ];
}

function buildDiagram(
  world: Float64Array,
  local: Float64Array,
  hits: readonly Hit[],
  frame: Frame,
  nudged: boolean,
): DiagramResult | 'degenerate' {
  const n = pointCount(local);
  interface Raw {
    x: number;
    y: number;
    over: { seg: number; s: number; depth: number };
    under: { seg: number; s: number; depth: number };
    sign: 1 | -1;
  }
  const raws: Raw[] = [];
  for (const h of hits) {
    const i1 = (h.i + 1) % n, j1 = (h.j + 1) % n;
    const di = local[3 * h.i + 2]! + (local[3 * i1 + 2]! - local[3 * h.i + 2]!) * h.s;
    const dj = local[3 * h.j + 2]! + (local[3 * j1 + 2]! - local[3 * h.j + 2]!) * h.t;
    if (Math.abs(di - dj) < 1e-9) {
      return { ok: false, reason: 'singular', message: 'the rope passes through itself here' };
    }
    const iOver = di > dj;
    const dix = local[3 * i1]! - local[3 * h.i]!, diy = local[3 * i1 + 1]! - local[3 * h.i + 1]!;
    const djx = local[3 * j1]! - local[3 * h.j]!, djy = local[3 * j1 + 1]! - local[3 * h.j + 1]!;
    // sign = sign of (over direction × under direction) in the picture plane.
    const crossOU = iOver ? dix * djy - diy * djx : djx * diy - djy * dix;
    const a = { seg: h.i, s: h.s, depth: di };
    const b = { seg: h.j, s: h.t, depth: dj };
    raws.push({ x: h.x, y: h.y, over: iOver ? a : b, under: iOver ? b : a, sign: crossOU > 0 ? 1 : -1 });
  }

  // Order all 2n passages along the rope.
  interface Ev {
    param: number;
    raw: number;
    role: 'over' | 'under';
  }
  const evs: Ev[] = [];
  raws.forEach((r, k) => {
    evs.push({ param: r.over.seg + r.over.s, raw: k, role: 'over' });
    evs.push({ param: r.under.seg + r.under.s, raw: k, role: 'under' });
  });
  evs.sort((p, q) => p.param - q.param);
  for (let k = 1; k < evs.length; k++) if (evs[k]!.param - evs[k - 1]!.param < 1e-12) return 'degenerate';

  const edges = evs.length;
  const eventOf = new Map<string, number>();
  const idOf = new Array<number>(raws.length).fill(0);
  let nextId = 1;
  evs.forEach((e, k) => {
    eventOf.set(`${e.raw}:${e.role}`, k + 1);
    if (idOf[e.raw] === 0) idOf[e.raw] = nextId++;
  });
  const inEdge = (ev: number): number => (ev === 1 ? edges : ev - 1);
  const outEdge = (ev: number): number => ev;

  const crossings: Crossing[] = raws.map((r, k) => {
    const evU = eventOf.get(`${k}:under`)!;
    const evO = eventOf.get(`${k}:over`)!;
    const a = inEdge(evU), c = outEdge(evU);
    const oIn = inEdge(evO), oOut = outEdge(evO);
    const pd: PDCrossing = r.sign > 0 ? { a, b: oOut, c, d: oIn } : { a, b: oIn, c, d: oOut };
    const passage = (p: { seg: number; s: number; depth: number }, event: number): Passage => ({
      seg: p.seg,
      s: p.s,
      param: p.seg + p.s,
      depth: p.depth,
      point: lerpPoint(world, p.seg, p.s),
      event,
    });
    return { id: idOf[k]!, x: r.x, y: r.y, over: passage(r.over, evO), under: passage(r.under, evU), sign: r.sign, pd };
  });
  crossings.sort((p, q) => p.id - q.id);
  const writhe = crossings.reduce((w, c) => w + c.sign, 0);
  return { ok: true, diagram: { frame, nudged, crossings, writhe } };
}

/** Just count crossings (for searching many views quickly); -1 if degenerate or too many. */
export function countCrossings(curve: Float64Array, frame: Frame, cap = MAX_FOUND_CROSSINGS): number {
  const hr = planarHits(toFrame(curve, frame), 3, cap);
  return hr.ok ? hr.hits.length : -1;
}
