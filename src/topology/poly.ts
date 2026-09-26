// Exact polynomials in one variable t with integer (BigInt) coefficients.
// Stored dense, lowest degree first: [1n, -1n, 1n] is 1 - t + t².
// Everything here is exact: no floating point ever touches a coefficient.

export type Poly = readonly bigint[];

export const ZERO: Poly = [];
export const ONE: Poly = [1n];

/** Drop trailing zero coefficients so every polynomial has one canonical form. */
export function trim(p: readonly bigint[]): Poly {
  let n = p.length;
  while (n > 0 && p[n - 1] === 0n) n--;
  return n === p.length ? p : p.slice(0, n);
}

export function fromNumbers(cs: readonly number[]): Poly {
  return trim(
    cs.map((c) => {
      if (!Number.isSafeInteger(c)) throw new RangeError(`not a safe integer coefficient: ${c}`);
      return BigInt(c);
    }),
  );
}

export function toNumbers(p: Poly): number[] {
  return p.map((c) => Number(c));
}

export function isZero(p: Poly): boolean {
  return p.length === 0;
}

/** Degree of p; the zero polynomial has degree -1. */
export function degree(p: Poly): number {
  return p.length - 1;
}

export function equals(a: Poly, b: Poly): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function add(a: Poly, b: Poly): Poly {
  const n = Math.max(a.length, b.length);
  const out = new Array<bigint>(n);
  for (let i = 0; i < n; i++) out[i] = (a[i] ?? 0n) + (b[i] ?? 0n);
  return trim(out);
}

export function neg(a: Poly): Poly {
  return a.map((c) => -c);
}

export function sub(a: Poly, b: Poly): Poly {
  return add(a, neg(b));
}

export function scale(a: Poly, k: bigint): Poly {
  if (k === 0n) return ZERO;
  return a.map((c) => c * k);
}

export function mul(a: Poly, b: Poly): Poly {
  if (a.length === 0 || b.length === 0) return ZERO;
  const out = new Array<bigint>(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    if (ai === 0n) continue;
    for (let j = 0; j < b.length; j++) out[i + j]! += ai * b[j]!;
  }
  return trim(out);
}

/**
 * a / b when the division is known to be exact in Z[t] (as it is at every step of
 * Bareiss elimination). Throws if it is not, which would mean a bug upstream.
 */
export function exactDiv(a: Poly, b: Poly): Poly {
  if (b.length === 0) throw new RangeError('division by the zero polynomial');
  if (a.length === 0) return ZERO;
  const db = b.length - 1;
  const lead = b[db]!;
  if (a.length - 1 < db) throw new RangeError('inexact polynomial division (degree)');
  const r = a.slice();
  const q = new Array<bigint>(a.length - db).fill(0n);
  for (let i = r.length - 1; i >= db; i--) {
    const c = r[i]!;
    if (c === 0n) continue;
    if (c % lead !== 0n) throw new RangeError('inexact polynomial division (coefficient)');
    const f = c / lead;
    q[i - db] = f;
    for (let j = 0; j <= db; j++) r[i - db + j]! -= f * b[j]!;
  }
  for (let i = 0; i < db; i++) if (r[i] !== 0n) throw new RangeError('inexact polynomial division (remainder)');
  return trim(q);
}

export function evaluate(p: Poly, t: bigint): bigint {
  let acc = 0n;
  for (let i = p.length - 1; i >= 0; i--) acc = acc * t + p[i]!;
  return acc;
}

/** Index of the lowest non-zero coefficient (the power of t that divides p). -1 for zero. */
export function lowestDegree(p: Poly): number {
  for (let i = 0; i < p.length; i++) if (p[i] !== 0n) return i;
  return -1;
}

export function isPalindromic(p: Poly): boolean {
  for (let i = 0, j = p.length - 1; i < j; i++, j--) if (p[i] !== p[j]) return false;
  return true;
}

export interface Term {
  readonly coef: bigint;
  readonly exp: number;
}

/** Non-zero terms, highest power first, with an optional power offset (for Laurent forms). */
export function terms(p: Poly, offset = 0): Term[] {
  const out: Term[] = [];
  for (let i = p.length - 1; i >= 0; i--) if (p[i] !== 0n) out.push({ coef: p[i]!, exp: i + offset });
  return out;
}

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};

function sup(n: number): string {
  return String(n)
    .split('')
    .map((ch) => SUP[ch] ?? ch)
    .join('');
}

/**
 * Plain-text form with Unicode superscripts and a real minus sign, e.g. "t² − t + 1".
 * `offset` shifts every power, so a symmetric Laurent form reads "t − 1 + t⁻¹".
 */
export function format(p: Poly, offset = 0, variable = 't'): string {
  const ts = terms(p, offset);
  if (ts.length === 0) return '0';
  let s = '';
  ts.forEach((term, k) => {
    const negative = term.coef < 0n;
    const abs = negative ? -term.coef : term.coef;
    const body =
      term.exp === 0
        ? abs.toString()
        : `${abs === 1n ? '' : abs.toString()}${variable}${term.exp === 1 ? '' : sup(term.exp)}`;
    if (k === 0) s += negative ? `−${body}` : body;
    else s += negative ? ` − ${body}` : ` + ${body}`;
  });
  return s;
}

/** ASCII form for logs and tests, e.g. "t^2 - t + 1". */
export function formatAscii(p: Poly, offset = 0): string {
  return format(p, offset)
    .replace(/−/g, '-')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => `^${m.split('').map((c) => Object.keys(SUP).find((k) => SUP[k] === c) ?? c).join('')}`);
}
