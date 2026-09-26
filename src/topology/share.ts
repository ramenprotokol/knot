// Share links: the rope's points and the viewing direction, packed into the URL fragment.
//
// Format: "#k=1.<base64url>". The bytes are: version (1), point count (varint), the viewing
// rotation as four zig-zag varints of round(q × 1000) for its quaternion, then the points on a
// 0.01 grid: the first point as zig-zag varints, every later point as deltas from the one before.
// The page snaps both the rope and the rotation to these grids before it analyses anything, so
// the person opening a link sees exactly the diagram the sender saw.
//
// A link is untrusted input, so decoding is bounded before any real work: the fragment's
// length is checked first, then the byte count, point count, varint length and coordinate
// range, and finally the rope must not pass through itself. All of it is O(points²) with at
// most MAX_POINTS points.

import { type Quat, MAX_POINTS, MIN_POINTS, minEdgeLength, minGap, pointCount } from './geometry.ts';

export const QUANTUM = 0.01;
export const MAX_COORD = 100;
export const MAX_FRAGMENT = 8192;
const MAX_BYTES = 6144;
const VERSION = 1;
/** A shared rope must keep at least this clearance between non-neighbouring segments. */
export const MIN_SHARED_GAP = 0.02;

export interface SharedKnot {
  readonly curve: Float64Array;
  readonly rotation: Quat;
}

export type DecodeResult = { readonly ok: true; readonly knot: SharedKnot } | { readonly ok: false; readonly error: string };

/** Snap a curve to the share grid, so what is analysed is exactly what a link reproduces. */
export function quantise(curve: Float64Array): Float64Array {
  const out = new Float64Array(curve.length);
  // (+ 0 turns −0 into 0, so a snapped rope compares equal to its decoded link.)
  for (let i = 0; i < curve.length; i++) out[i] = (Math.round(curve[i]! / QUANTUM) + 0) * QUANTUM;
  return out;
}

/**
 * Snapping moves each point at most QUANTUM·√3/2 ≈ 0.0087. That cannot change the knot if the
 * rope's minimum gap is more than twice that, which this checks.
 */
export function canQuantiseSafely(curve: Float64Array): boolean {
  return minGap(curve).gap > QUANTUM * Math.sqrt(3) * 1.05;
}

/**
 * Snap a rotation to the share grid: each component to a multiple of 0.001. The result is not
 * renormalised (frameFromQuaternion accepts any non-zero quaternion), so snapping twice gives
 * the same numbers and a link reproduces the sender's view exactly.
 */
export function quantiseRotation(q: Quat): Quat {
  return quatFromInts([Math.round(q[0] * 1000), Math.round(q[1] * 1000), Math.round(q[2] * 1000), Math.round(q[3] * 1000)]) ?? [0, 0, 0, 1];
}

function quatFromInts(r: readonly [number, number, number, number]): Quat | null {
  const len = Math.hypot(r[0], r[1], r[2], r[3]);
  if (!(len >= 500 && len <= 1500)) return null;
  return [(r[0] + 0) / 1000, (r[1] + 0) / 1000, (r[2] + 0) / 1000, (r[3] + 0) / 1000];
}

function zig(v: number): number {
  return v >= 0 ? 2 * v : -2 * v - 1;
}
function unzig(u: number): number {
  return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
}

function pushVarint(out: number[], u: number): void {
  while (u >= 0x80) {
    out.push((u & 0x7f) | 0x80);
    u = Math.floor(u / 128);
  }
  out.push(u);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: readonly number[]): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!, b1 = bytes[i + 1] ?? 0, b2 = bytes[i + 2] ?? 0;
    const v = (b0 << 16) | (b1 << 8) | b2;
    s += B64[(v >> 18) & 63]! + B64[(v >> 12) & 63]!;
    if (i + 1 < bytes.length) s += B64[(v >> 6) & 63]!;
    if (i + 2 < bytes.length) s += B64[v & 63]!;
  }
  return s;
}

function fromBase64Url(s: string): Uint8Array | null {
  if (s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0, acc = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    const v = B64.indexOf(s[i]!);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
    acc &= 0xffff;
  }
  return out.subarray(0, o);
}

export function encodeKnot(curve: Float64Array, rotation: Quat): string {
  const n = pointCount(curve);
  if (n < MIN_POINTS || n > MAX_POINTS) throw new RangeError(`a shared rope needs ${MIN_POINTS}–${MAX_POINTS} points`);
  const bytes: number[] = [VERSION];
  pushVarint(bytes, n);
  for (const c of rotation) pushVarint(bytes, zig(Math.round(c * 1000)));
  let prev = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const q = [0, 1, 2].map((k) => {
      const val = Math.round(curve[3 * i + k]! / QUANTUM);
      if (Math.abs(val * QUANTUM) > MAX_COORD) throw new RangeError('rope is too large to share');
      return val;
    });
    for (let k = 0; k < 3; k++) pushVarint(bytes, zig(q[k]! - prev[k]!));
    prev = q;
  }
  return `k=${VERSION}.${toBase64Url(bytes)}`;
}

/** Decode a fragment (with or without the leading '#'). Never throws. */
export function decodeKnot(fragment: string): DecodeResult {
  if (fragment.length > MAX_FRAGMENT) return { ok: false, error: `the link is too long (over ${MAX_FRAGMENT} characters)` };
  const f = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const m = /^k=(\d{1,3})\.([A-Za-z0-9_-]+)$/.exec(f);
  if (!m) return { ok: false, error: 'the link is not in the knot format' };
  if (Number(m[1]) !== VERSION) return { ok: false, error: `the link uses format version ${m[1]}, which this page does not read` };
  const bytes = fromBase64Url(m[2]!);
  if (!bytes) return { ok: false, error: 'the link is damaged (bad characters or length)' };
  if (bytes.length > MAX_BYTES) return { ok: false, error: 'the link carries too much data' };
  let pos = 0;
  const readVarint = (): number | null => {
    let u = 0, mult = 1;
    for (let k = 0; k < 4; k++) {
      if (pos >= bytes.length) return null;
      const b = bytes[pos++]!;
      u += (b & 0x7f) * mult;
      if ((b & 0x80) === 0) return u;
      mult *= 128;
    }
    return null; // longer than 4 bytes: far bigger than any legal value
  };
  if (bytes[pos++] !== VERSION) return { ok: false, error: 'the link is damaged (version byte)' };
  const n = readVarint();
  if (n === null || n < MIN_POINTS || n > MAX_POINTS) return { ok: false, error: `the rope must have ${MIN_POINTS}–${MAX_POINTS} points` };
  const qi: number[] = [];
  for (let k = 0; k < 4; k++) {
    const u = readVarint();
    if (u === null || u > 4000) return { ok: false, error: 'the link is damaged (view)' };
    qi.push(unzig(u));
  }
  const rotation = quatFromInts([qi[0]!, qi[1]!, qi[2]!, qi[3]!]);
  if (!rotation) return { ok: false, error: 'the link is damaged (view)' };
  const limit = Math.round(MAX_COORD / QUANTUM);
  const curve = new Float64Array(n * 3);
  const prev = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const u = readVarint();
      if (u === null) return { ok: false, error: 'the link is cut short' };
      const q = prev[k]! + unzig(u);
      if (Math.abs(q) > limit) return { ok: false, error: 'the rope in the link is too large' };
      prev[k] = q;
      curve[3 * i + k] = q * QUANTUM;
    }
  }
  if (pos !== bytes.length) return { ok: false, error: 'the link has extra data at the end' };
  if (!(minEdgeLength(curve) > 0)) return { ok: false, error: 'the rope in the link has repeated points' };
  if (minGap(curve).gap < MIN_SHARED_GAP) return { ok: false, error: 'the rope in the link passes through itself' };
  return { ok: true, knot: { curve, rotation } };
}
