// Geometry of closed polygonal curves. A curve is a Float64Array of N points laid out
// x0 y0 z0 x1 y1 z1 …; segment i joins point i to point (i + 1) mod N.

export type Vec3 = readonly [number, number, number];

/** The analysis frame: e1 and e2 span the picture plane, v points at the viewer. e1 × e2 = v. */
export interface Frame {
  readonly e1: Vec3;
  readonly e2: Vec3;
  readonly v: Vec3;
}

export const MIN_POINTS = 8;
export const MAX_POINTS = 480;

export function pointCount(c: Float64Array): number {
  return c.length / 3;
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  if (!(n > 0) || !Number.isFinite(n)) throw new RangeError('cannot normalise a zero or non-finite vector');
  return [a[0] / n, a[1] / n, a[2] / n];
}

/** The standard frame looking down the z axis: picture x = world x, picture y = world y. */
export const TOP_FRAME: Frame = { e1: [1, 0, 0], e2: [0, 1, 0], v: [0, 0, 1] };

/** A right-handed frame whose viewing direction is `dir` (pointing from the knot to the viewer). */
export function frameFromDirection(dir: Vec3): Frame {
  const v = normalize(dir);
  const helper: Vec3 = Math.abs(v[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const e1 = normalize(cross(helper, v));
  const e2 = cross(v, e1);
  return { e1, e2, v };
}

/** Rotate a frame by a small angle about its own e1 then e2 axes (used to escape degenerate views). */
export function nudgeFrame(f: Frame, a: number, b: number): Frame {
  const rot = (x: Vec3, axis: Vec3, ang: number): Vec3 => {
    // Rodrigues' rotation formula.
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const k = dot(axis, x) * (1 - c);
    const cr = cross(axis, x);
    return [x[0] * c + cr[0] * s + axis[0] * k, x[1] * c + cr[1] * s + axis[1] * k, x[2] * c + cr[2] * s + axis[2] * k];
  };
  let { e1, e2, v } = f;
  e2 = rot(e2, e1, a);
  v = rot(v, e1, a);
  e1 = rot(e1, e2, b);
  v = rot(v, e2, b);
  return { e1: normalize(e1), e2: normalize(e2), v: normalize(v) };
}

/** Express a world-space curve in frame coordinates (u, w, depth). */
export function toFrame(c: Float64Array, f: Frame): Float64Array {
  const n = pointCount(c);
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = c[3 * i]!, y = c[3 * i + 1]!, z = c[3 * i + 2]!;
    out[3 * i] = x * f.e1[0] + y * f.e1[1] + z * f.e1[2];
    out[3 * i + 1] = x * f.e2[0] + y * f.e2[1] + z * f.e2[2];
    out[3 * i + 2] = x * f.v[0] + y * f.v[1] + z * f.v[2];
  }
  return out;
}

/** Inverse of toFrame for an orthonormal frame. */
export function fromFrame(c: Float64Array, f: Frame): Float64Array {
  const n = pointCount(c);
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = c[3 * i]!, w = c[3 * i + 1]!, d = c[3 * i + 2]!;
    out[3 * i] = u * f.e1[0] + w * f.e2[0] + d * f.v[0];
    out[3 * i + 1] = u * f.e1[1] + w * f.e2[1] + d * f.v[1];
    out[3 * i + 2] = u * f.e1[2] + w * f.e2[2] + d * f.v[2];
  }
  return out;
}

export function totalLength(c: Float64Array): number {
  const n = pointCount(c);
  let L = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    L += Math.hypot(c[3 * j]! - c[3 * i]!, c[3 * j + 1]! - c[3 * i + 1]!, c[3 * j + 2]! - c[3 * i + 2]!);
  }
  return L;
}

export function minEdgeLength(c: Float64Array): number {
  const n = pointCount(c);
  let m = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    m = Math.min(m, Math.hypot(c[3 * j]! - c[3 * i]!, c[3 * j + 1]! - c[3 * i + 1]!, c[3 * j + 2]! - c[3 * i + 2]!));
  }
  return m;
}

export function centroid(c: Float64Array): Vec3 {
  const n = pointCount(c);
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < n; i++) {
    x += c[3 * i]!;
    y += c[3 * i + 1]!;
    z += c[3 * i + 2]!;
  }
  return [x / n, y / n, z / n];
}

export function boundingRadius(c: Float64Array, about: Vec3 = centroid(c)): number {
  const n = pointCount(c);
  let r = 0;
  for (let i = 0; i < n; i++) {
    r = Math.max(r, Math.hypot(c[3 * i]! - about[0], c[3 * i + 1]! - about[1], c[3 * i + 2]! - about[2]));
  }
  return r;
}

/** Translate and scale so the centroid is at the origin and the bounding radius is `radius`. */
export function fitToRadius(c: Float64Array, radius: number): Float64Array {
  const ctr = centroid(c);
  const r = boundingRadius(c, ctr);
  const k = r > 0 ? radius / r : 1;
  const out = new Float64Array(c.length);
  for (let i = 0; i < c.length; i += 3) {
    out[i] = (c[i]! - ctr[0]) * k;
    out[i + 1] = (c[i + 1]! - ctr[1]) * k;
    out[i + 2] = (c[i + 2]! - ctr[2]) * k;
  }
  return out;
}

/** Scratch result for segmentClosest: parameters of the closest points and their distance. */
export interface Closest {
  s: number;
  t: number;
  d: number;
}

/**
 * Closest points between segments p0p1 and q0q1 (method from Ericson, "Real-Time Collision
 * Detection", §5.1.9), with degenerate segments handled. Writes into `out` to avoid garbage.
 */
export function segmentClosest(
  px: number, py: number, pz: number, p1x: number, p1y: number, p1z: number,
  qx: number, qy: number, qz: number, q1x: number, q1y: number, q1z: number,
  out: Closest,
): Closest {
  const d1x = p1x - px, d1y = p1y - py, d1z = p1z - pz;
  const d2x = q1x - qx, d2y = q1y - qy, d2z = q1z - qz;
  const rx = px - qx, ry = py - qy, rz = pz - qz;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const EPS = 1e-18;
  let s: number, t: number;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS * a * e ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const dx = px + d1x * s - (qx + d2x * t);
  const dy = py + d1y * s - (qy + d2y * t);
  const dz = pz + d1z * s - (qz + d2z * t);
  out.s = s;
  out.t = t;
  out.d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return out;
}

const SCRATCH: Closest = { s: 0, t: 0, d: 0 };

/** Distance between segments p0p1 and q0q1. */
export function segmentDistance(
  px: number, py: number, pz: number, p1x: number, p1y: number, p1z: number,
  qx: number, qy: number, qz: number, q1x: number, q1y: number, q1z: number,
): number {
  return segmentClosest(px, py, pz, p1x, p1y, p1z, qx, qy, qz, q1x, q1y, q1z, SCRATCH).d;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export interface Gap {
  /** Smallest distance between two segments that do not share a point. */
  readonly gap: number;
  readonly i: number;
  readonly j: number;
}

/**
 * Minimum distance between non-adjacent segments. If every point of the curve then
 * moves less than gap / 2 along a straight line, no two segments can pass through
 * each other, so the knot type cannot change. O(N²) with a cheap midpoint bound.
 */
export function minGap(c: Float64Array): Gap {
  const n = pointCount(c);
  const mx = new Float64Array(n), my = new Float64Array(n), mz = new Float64Array(n), hl = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mx[i] = (c[3 * i]! + c[3 * j]!) / 2;
    my[i] = (c[3 * i + 1]! + c[3 * j + 1]!) / 2;
    mz[i] = (c[3 * i + 2]! + c[3 * j + 2]!) / 2;
    hl[i] = Math.hypot(c[3 * j]! - c[3 * i]!, c[3 * j + 1]! - c[3 * i + 1]!, c[3 * j + 2]! - c[3 * i + 2]!) / 2;
  }
  let best = Infinity, bi = -1, bj = -1;
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // these two share point 0
      const lower = Math.hypot(mx[i]! - mx[j]!, my[i]! - my[j]!, mz[i]! - mz[j]!) - hl[i]! - hl[j]!;
      if (lower >= best) continue;
      const j1 = (j + 1) % n;
      const d = segmentDistance(
        c[3 * i]!, c[3 * i + 1]!, c[3 * i + 2]!, c[3 * i1]!, c[3 * i1 + 1]!, c[3 * i1 + 2]!,
        c[3 * j]!, c[3 * j + 1]!, c[3 * j + 2]!, c[3 * j1]!, c[3 * j1 + 1]!, c[3 * j1 + 2]!,
      );
      if (d < best) {
        best = d;
        bi = i;
        bj = j;
      }
    }
  }
  return { gap: best, i: bi, j: bj };
}

/** Largest distance any single point moved between two curves with the same point count. */
export function maxDisplacement(a: Float64Array, b: Float64Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i += 3) {
    m = Math.max(m, Math.hypot(a[i]! - b[i]!, a[i + 1]! - b[i + 1]!, a[i + 2]! - b[i + 2]!));
  }
  return m;
}

/** Resample a closed polyline to n points evenly spaced by arc length. Works in any dimension. */
export function resampleClosed(pts: Float64Array, dim: number, n: number): Float64Array {
  const m = pts.length / dim;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    let s = 0;
    for (let k = 0; k < dim; k++) s += (pts[j * dim + k]! - pts[i * dim + k]!) ** 2;
    cum[i + 1] = cum[i]! + Math.sqrt(s);
  }
  const L = cum[m]!;
  const out = new Float64Array(n * dim);
  let seg = 0;
  for (let q = 0; q < n; q++) {
    const target = (q * L) / n;
    while (seg < m - 1 && cum[seg + 1]! <= target) seg++;
    const len = cum[seg + 1]! - cum[seg]!;
    const t = len > 0 ? (target - cum[seg]!) / len : 0;
    const j = (seg + 1) % m;
    for (let k = 0; k < dim; k++) out[q * dim + k] = pts[seg * dim + k]! + (pts[j * dim + k]! - pts[seg * dim + k]!) * t;
  }
  return out;
}

/** A unit quaternion (x, y, z, w), the same layout three.js uses. */
export type Quat = readonly [number, number, number, number];

/**
 * The frame seen by a fixed camera looking down −z at a knot rotated by q: the picture axes
 * and viewing direction expressed in the knot's own coordinates (the rows of q's matrix).
 */
export function frameFromQuaternion(q: Quat): Frame {
  const [x, y, z, w] = q;
  const n2 = x * x + y * y + z * z + w * w;
  if (!(n2 > 0) || !Number.isFinite(n2)) throw new RangeError('zero or non-finite quaternion');
  const s = 2 / n2; // works for any non-zero quaternion, not only unit ones
  return {
    e1: [1 - s * (y * y + z * z), s * (x * y - z * w), s * (x * z + y * w)],
    e2: [s * (x * y + z * w), 1 - s * (x * x + z * z), s * (y * z - x * w)],
    v: [s * (x * z - y * w), s * (y * z + x * w), 1 - s * (x * x + y * y)],
  };
}
