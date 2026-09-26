// Planar diagram (PD) codes, in the KnotTheory / Knot Atlas convention:
// the 2n edges of a diagram with n crossings are labelled 1..2n along the knot's
// direction, and each crossing is X[a, b, c, d] where a is the incoming under-edge
// and b, c, d follow counter-clockwise. The under-strand runs a → c (c = a + 1).
// The crossing is positive (right-handed) when b = d + 1 (mod 2n), negative when d = b + 1.

export interface PDCrossing {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

export type PDCode = readonly PDCrossing[];

export function x(a: number, b: number, c: number, d: number): PDCrossing {
  return { a, b, c, d };
}

/** Next label round the knot: 1..2n with 2n followed by 1. */
export function nextLabel(e: number, edges: number): number {
  return e === edges ? 1 : e + 1;
}

/**
 * +1 for a positive crossing, -1 for a negative one, read from the labels.
 * With a single crossing (two edges) both readings agree; we call it +1 — it
 * does not matter, because a one-crossing diagram's Alexander minor is empty.
 */
export function signFromLabels(p: PDCrossing, edges: number): 1 | -1 {
  if (p.b === nextLabel(p.d, edges)) return 1;
  if (p.d === nextLabel(p.b, edges)) return -1;
  throw new RangeError(`crossing X[${p.a},${p.b},${p.c},${p.d}] has over-edges that are not consecutive`);
}

export type Validation = { ok: true } | { ok: false; error: string };

/** Structural checks: every label 1..2n used exactly twice, under-edges and over-edges consecutive. */
export function validatePD(pd: PDCode): Validation {
  const n = pd.length;
  const edges = 2 * n;
  const count = new Array<number>(edges + 1).fill(0);
  for (const p of pd) {
    for (const e of [p.a, p.b, p.c, p.d]) {
      if (!Number.isInteger(e) || e < 1 || e > edges) return { ok: false, error: `label ${e} is outside 1..${edges}` };
      count[e]!++;
    }
    if (p.c !== nextLabel(p.a, edges)) return { ok: false, error: `under-strand ${p.a} → ${p.c} is not consecutive` };
    if (p.b !== nextLabel(p.d, edges) && p.d !== nextLabel(p.b, edges)) {
      return { ok: false, error: `over-strand ${p.b}, ${p.d} is not consecutive` };
    }
  }
  for (let e = 1; e <= edges; e++) if (count[e] !== 2) return { ok: false, error: `label ${e} appears ${count[e]} times` };
  return { ok: true };
}

export function formatPD(pd: PDCode): string {
  if (pd.length === 0) return 'PD[] (no crossings)';
  return pd.map((p) => `X[${p.a},${p.b},${p.c},${p.d}]`).join(' ');
}

/**
 * Parse "X[1,4,2,5] X[3,6,4,1]" or the Knot Atlas compact form "X1425 X3641"
 * (labels above 9 separated by commas, e.g. "X5,10,6,1"). Used by tests.
 */
export function parsePD(text: string): PDCode {
  const out: PDCrossing[] = [];
  const re = /X\[?([0-9,\s]+)\]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[1]!.trim();
    const parts = body.includes(',') ? body.split(',').map((s) => s.trim()).filter((s) => s.length > 0) : body.split('');
    if (parts.length !== 4) throw new SyntaxError(`cannot read crossing "${m[0]}"`);
    const [a, b, c, d] = parts.map(Number) as [number, number, number, number];
    out.push({ a, b, c, d });
  }
  return out;
}

export function writheOf(pd: PDCode): number {
  const edges = 2 * pd.length;
  return pd.reduce((w, p) => w + signFromLabels(p, edges), 0);
}
