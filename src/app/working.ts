// "Show the working": the maths behind the verdict, step by step, as HTML.

import type { Analysis, ViewSearch } from '../topology/analyse.ts';
import type { Frame } from '../topology/geometry.ts';
import { type Poly, format, isZero } from '../topology/poly.ts';
import { formatPD } from '../topology/pd.ts';
import { KNOT_TABLE } from '../topology/table.ts';
import { fromNumbers, equals } from '../topology/poly.ts';
import type { RelaxStats } from '../topology/relax.ts';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const MATRIX_PRINT_LIMIT = 16;

function entry(p: Poly): string {
  return isZero(p) ? '·' : esc(format(p));
}

function num(x: number, digits = 3): string {
  return x.toFixed(digits).replace('-', '−');
}

export interface WorkingContext {
  readonly selected: number | null;
  readonly frame: Frame;
  readonly points: number;
  readonly ms: number;
  readonly relax: RelaxStats | null;
  readonly view: ViewSearch | null;
}

export function renderWorking(a: Analysis, ctx: WorkingContext): string {
  const out: string[] = [];
  const d = a.diagram;
  const n = a.pd.length;
  const v = ctx.frame.v;

  out.push(`<h3>1 · Look <span>projection</span></h3>`);
  out.push(
    `<p>The rope's centre line is a closed polygon of ${ctx.points} points. We look at it along ` +
      `<code>v = (${num(v[0])}, ${num(v[1])}, ${num(v[2])})</code>, flatten it onto the picture plane, ` +
      `and find every place its shadow crosses itself. At each one, the strand nearer to you is <em>over</em>.</p>`,
  );
  if (d?.nudged) {
    out.push(`<p class="note">From exactly this angle a corner of the rope sat on another strand's shadow, so the view was turned by a fraction of a milliradian to read it cleanly.</p>`);
  }
  if (!d) {
    out.push(`<p>${esc(a.wording.detail)}</p>`);
    return out.join('');
  }
  const w = d.writhe > 0 ? `+${d.writhe}` : d.writhe < 0 ? `−${-d.writhe}` : '0';
  out.push(`<p>Crossings found: <strong>${n}</strong>. Writhe (sum of crossing signs): <strong>${w}</strong>.</p>`);

  out.push(`<h3>2 · Crossings <span>numbered along the rope from its start</span></h3>`);
  if (n === 0) {
    out.push(`<p>None. A diagram with no crossings is an untangled loop.</p>`);
  } else {
    out.push(
      `<p>The stretches of rope between crossings are labelled 1 to ${2 * n} in the rope's direction. ` +
        `A crossing is <em>positive</em> (+) when, turning the over-strand anticlockwise, you reach the under-strand's direction first.</p>`,
    );
    out.push('<div class="scroll-x"><table><thead><tr><th>#</th><th>sign</th><th>over</th><th>under</th><th>PD</th></tr></thead><tbody>');
    for (const c of d.crossings) {
      const over = c.sign > 0 ? `${c.pd.d}→${c.pd.b}` : `${c.pd.b}→${c.pd.d}`;
      out.push(
        `<tr class="${c.id === ctx.selected ? 'is-current' : ''}"><th>${c.id}</th><td>${c.sign > 0 ? '+' : '−'}</td>` +
          `<td>${over}</td><td>${c.pd.a}→${c.pd.c}</td><td>X[${c.pd.a},${c.pd.b},${c.pd.c},${c.pd.d}]</td></tr>`,
      );
    }
    out.push('</tbody></table></div>');
  }

  out.push(`<h3>3 · Planar diagram code</h3>`);
  out.push(`<p><code>${esc(formatPD(a.pd))}</code></p>`);
  out.push(
    `<p class="note">Each X[a,b,c,d] lists the four stretches meeting at a crossing, anticlockwise, starting with the one arriving underneath (the KnotTheory / Knot Atlas convention).</p>`,
  );

  const alex = a.alexander;
  if (!alex) {
    out.push(`<h3>4 · Alexander polynomial</h3><p>${esc(a.wording.detail)}</p>`);
    return out.join('');
  }

  out.push(`<h3>4 · Arcs <span>under-passes cut the rope</span></h3>`);
  if (n === 0) {
    out.push(`<p>No crossings, so one unbroken arc and Δ(t) = 1.</p>`);
  } else {
    out.push(`<p>Only passing <em>under</em> breaks the rope, so the ${n} crossings cut it into ${alex.arcs.edgesOfArc.length} arcs:</p>`);
    out.push(
      `<p class="mono">${alex.arcs.edgesOfArc
        .map((edges, k) => `a${k + 1} = ${edges.length === 1 ? `edge ${edges[0]}` : `edges ${edges.join(', ')}`}`)
        .join('; ')}</p>`,
    );

    out.push(`<h3>5 · Alexander matrix <span>${n} × ${n}</span></h3>`);
    out.push(
      `<p>One row per crossing: <code>1 − t</code> in the column of the arc passing over, <code>t</code> for the under-arc on the over-strand's right, ` +
        `<code>−1</code> for the one on its left (entries add when arcs repeat). Every row sums to zero.</p>`,
    );
    if (n <= MATRIX_PRINT_LIMIT) {
      out.push('<div class="scroll-x"><table class="matrix"><thead><tr><th></th>');
      for (let j = 0; j < n; j++) out.push(`<th>a${j + 1}</th>`);
      out.push('</tr></thead><tbody>');
      alex.matrix.forEach((row, i) => {
        const id = d.crossings[i]!.id;
        const cls = [i === n - 1 ? 'dropped' : '', id === ctx.selected ? 'is-current' : ''].join(' ').trim();
        out.push(`<tr class="${cls}"><th>${id}</th>`);
        row.forEach((p, j) => out.push(`<td class="${j === n - 1 ? 'dropped' : ''}">${entry(p)}</td>`));
        out.push('</tr>');
      });
      out.push('</tbody></table></div>');
    } else {
      out.push(`<p class="note">The matrix is ${n} × ${n}, too big to print here; it was built and used in full.</p>`);
    }

    out.push(`<h3>6 · Determinant <span>exact, over the integers</span></h3>`);
    out.push(
      `<p>Strike out the last row and column (any one row and column give the same answer up to ±tᵏ). ` +
        `The determinant of what is left, by fraction-free (Bareiss) elimination with whole-number polynomial arithmetic, is</p>`,
    );
    out.push(`<p><code>det = ${esc(format(alex.det))}</code></p>`);
  }
  const norm = alex.normalisation;
  if (norm && alex.delta) {
    const steps: string[] = [];
    if (norm.shift > 0) steps.push(norm.shift === 1 ? 'divide by t' : `divide by t<sup>${norm.shift}</sup>`);
    if (norm.negated) steps.push('multiply by −1');
    if (n > 0) {
      out.push(
        `<p>${steps.length ? `To normalise, ${steps.join(' and ')}, so that` : 'It is already normalised:'} the lowest power is t⁰ and Δ(1) = 1:</p>`,
      );
    }
    const half = (alex.delta.length - 1) / 2;
    out.push(`<p><code>Δ(t) = ${esc(format(alex.delta))}</code></p>`);
    if (half > 0 && Number.isInteger(half)) out.push(`<p class="note">Symmetric form: <code>${esc(format(alex.delta, -half))}</code></p>`);
    out.push(
      `<p class="note">Checks: Δ(1) = ${alex.atOne} (every knot gives 1) · palindromic: ${alex.symmetric ? 'yes' : 'no'} · ` +
        `knot determinant |Δ(−1)| = ${alex.knotDeterminant}.</p>`,
    );
  }

  out.push(`<h3>7 · Table lookup</h3>`);
  out.push(
    `<p>Compare Δ(t) with every knot of up to 7 crossings (mirror images share a polynomial, so they are not listed twice). ` +
      `A knot needs no more crossings than any diagram of it shows, so rows needing more than ${n} (greyed) are ruled out.</p>`,
  );
  out.push('<div class="scroll-x"><table class="lookup"><thead><tr><th>knot</th><th>c</th><th>Δ(t)</th></tr></thead><tbody>');
  for (const k of KNOT_TABLE) {
    const kd = fromNumbers(k.alexander);
    const match = alex.delta !== null && equals(kd, alex.delta) && k.crossingNumber <= n;
    const ruled = k.crossingNumber > n && n >= 3;
    out.push(
      `<tr class="${match ? 'is-match' : ruled ? 'is-ruled' : ''}"><td>${esc(k.label)}${k.name ? ` ${esc(k.name)}` : ''}</td><td>${k.crossingNumber}</td>` +
        `<td>${esc(format(kd))}</td></tr>`,
    );
  }
  out.push('</tbody></table></div>');
  out.push(
    `<p class="note">Source: D. Rolfsen, <i>Knots and Links</i> (1976), Appendix C, via the Knot Atlas; cross-reference KnotInfo (Livingston &amp; Moore). ` +
      `The unit tests recompute every row from published PD codes.</p>`,
  );

  if (ctx.relax) {
    const r = ctx.relax;
    out.push(`<h3>Relaxation</h3>`);
    out.push(
      `<p>${r.steps} steps${r.done && r.steps < 600 ? ' (settled early)' : ''}. Springs resist stretching, bending smooths the rope, every point repels every other, ` +
        `and strands closer than the rope's thickness are pushed apart. The rope stretched a little as it opened out: ${num(r.lengthStart, 1)} → ${num(r.lengthNow, 1)} units.</p>`,
    );
    out.push(
      `<p>No point ever moved more than 0.45 × the smallest gap between two non-neighbouring stretches of rope (smallest gap during the run: ${num(r.minGapSeen)} units). ` +
        `Moving every point less than half that gap cannot make the rope pass through itself, so the knot cannot have changed.</p>`,
    );
  }
  if (ctx.view) {
    out.push(
      `<p class="note">View search: looked from ${ctx.view.tried} directions; the fewest crossings seen was ${ctx.view.crossings} (it was ${ctx.view.currentCrossings} before). ` +
        `That is only an upper bound on the knot's true crossing number.</p>`,
    );
  }
  out.push(`<p class="note">This analysis took ${ctx.ms.toFixed(1)} ms in your browser (measured just now).</p>`);
  return out.join('');
}
