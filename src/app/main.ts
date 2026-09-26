// The page: wires the topology pipeline to the figure, the panel and the controls.

import '../styles.css';
import { type Analysis, type ViewSearch, analyse, simplestView } from '../topology/analyse.ts';
import {
  type Quat,
  type Vec3,
  boundingRadius,
  centroid,
  frameFromQuaternion,
  pointCount,
} from '../topology/geometry.ts';
import { MAX_STROKE_POINTS, flipCrossing, liftDrawing, prepareStroke } from '../topology/lift.ts';
import { PRESETS, type Preset } from '../topology/presets.ts';
import { format } from '../topology/poly.ts';
import { formatPD } from '../topology/pd.ts';
import { DEFAULT_RELAX, type RelaxStats, createRelaxer } from '../topology/relax.ts';
import { canQuantiseSafely, decodeKnot, encodeKnot, quantise, quantiseRotation } from '../topology/share.ts';
import { createFlatScene } from './flat.ts';
import { type Palette, type SceneApi, createScene } from './scene.ts';
import { esc, renderWorking } from './working.ts';

// ---------- small helpers ----------

function el<T extends Element>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as unknown as T;
}

const SVG = 'http://www.w3.org/2000/svg';
const IDENTITY: Quat = [0, 0, 0, 1];
const PLATES = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const CALLOUT_LIMIT = 60;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function qMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function qNorm(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

function qAxis(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

function qSlerp(a: Quat, b: Quat, t: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb: Quat = b;
  if (d < 0) {
    d = -d;
    bb = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (d > 0.9995) return qNorm([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
  const th = Math.acos(Math.min(1, d));
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
}

/** The rotation that turns unit vector a onto unit vector b (shortest arc). */
function qFromTo(a: Vec3, b: Vec3): Quat {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.999999) {
    const axis: Vec3 = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[2], 0, a[0]];
    const n = Math.hypot(...axis);
    return [axis[0] / n, axis[1] / n, axis[2] / n, 0];
  }
  return qNorm([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0], 1 + d]);
}

function rotateVec(q: Quat, p: Vec3): Vec3 {
  const f = frameFromQuaternion(q);
  // Rows of R are e1, e2, v, so R·p = (e1·p, e2·p, v·p).
  return [f.e1[0] * p[0] + f.e1[1] * p[1] + f.e1[2] * p[2], f.e2[0] * p[0] + f.e2[1] * p[1] + f.e2[2] * p[2], f.v[0] * p[0] + f.v[1] * p[1] + f.v[2] * p[2]];
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the choice just won't be remembered */
  }
}

/** Escape, then set Unicode subscript digits (knot names like 4₁) as real <sub> text. */
function rich(text: string): string {
  const SUBS = '₀₁₂₃₄₅₆₇₈₉';
  return esc(text).replace(/[₀-₉]+/g, (m) => `<sub>${[...m].map((c) => SUBS.indexOf(c)).join('')}</sub>`);
}

const minus = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

function cssColor(name: string): [number, number, number] {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) return [0.5, 0.5, 0.5];
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ---------- DOM ----------

const figure = el<HTMLDivElement>('figure');
const canvas = el<HTMLCanvasElement>('scene');
const overlay = el<SVGSVGElement>('overlay');
const note = el<HTMLParagraphElement>('figure-note');
const figNum = el<HTMLSpanElement>('fig-num');
const figTitle = el<HTMLSpanElement>('fig-title');
const figMeta = el<HTMLParagraphElement>('fig-meta');
const presetsBox = el<HTMLDivElement>('presets');
const btnDraw = el<HTMLButtonElement>('btn-draw');
const btnRelax = el<HTMLButtonElement>('btn-relax');
const btnSimplest = el<HTMLButtonElement>('btn-simplest');
const btnTop = el<HTMLButtonElement>('btn-top');
const btnShare = el<HTMLButtonElement>('btn-share');
const shareOut = el<HTMLParagraphElement>('share-out');
const shareUrl = el<HTMLInputElement>('share-url');
const shareStatus = el<HTMLSpanElement>('share-status');
const verdictHead = el<HTMLHeadingElement>('verdict-head');
const verdictDetail = el<HTMLParagraphElement>('verdict-detail');
const facts = el<HTMLDListElement>('facts');
const crossingList = el<HTMLOListElement>('crossing-list');
const crossingHint = el<HTMLParagraphElement>('crossing-hint');
const workingBody = el<HTMLDivElement>('working-body');
const themeToggle = el<HTMLButtonElement>('theme-toggle');

// ---------- renderer ----------

const forceFlat = new URLSearchParams(location.search).has('flat');
let scene: SceneApi;
let rendererNote = '';
{
  const made = forceFlat ? ({ ok: false, error: 'flat view requested' } as const) : createScene(canvas, figure);
  if (made.ok) {
    scene = made;
  } else {
    canvas.remove();
    const layer = document.createElementNS(SVG, 'svg') as SVGSVGElement;
    layer.setAttribute('class', 'overlay');
    layer.setAttribute('aria-hidden', 'true');
    figure.insertBefore(layer, overlay);
    scene = createFlatScene(figure, layer);
    rendererNote = forceFlat ? '' : `3D drawing is unavailable here (${made.error}), so this is a flat drawing. The maths is unaffected.`;
  }
}

// ---------- state ----------

interface Meta {
  title: string;
  plate: string;
  presetId: string | null;
}

interface State {
  curve: Float64Array;
  rotation: Quat;
  analysis: Analysis | null;
  ms: number;
  selected: number | null;
  meta: Meta;
  shareable: boolean;
  relax: RelaxStats | null;
  view: ViewSearch | null;
  busy: boolean;
  mode: 'look' | 'draw';
  swayAllowed: boolean;
  centre: Vec3;
}

const state: State = {
  curve: new Float64Array(0),
  rotation: IDENTITY,
  analysis: null,
  ms: 0,
  selected: null,
  meta: { title: '', plate: '', presetId: null },
  shareable: true,
  relax: null,
  view: null,
  busy: false,
  mode: 'look',
  swayAllowed: !reduceMotion.matches,
  centre: [0, 0, 0],
};

function showNote(html: string, kind: 'info' | 'error' = 'info'): void {
  note.innerHTML = html;
  note.classList.toggle('is-error', kind === 'error');
  note.hidden = false;
}

function hideNote(): void {
  note.hidden = true;
}

function updateSway(): void {
  scene.setSway(state.swayAllowed && !reduceMotion.matches && state.mode === 'look' && !state.busy);
}

function setBusy(b: boolean): void {
  state.busy = b;
  for (const btn of [btnRelax, btnSimplest, btnTop, btnShare, btnDraw]) btn.disabled = b;
  for (const btn of presetsBox.querySelectorAll('button')) btn.disabled = b;
  updateSway();
}

/** Install a new rope. Snaps it (and the view) to the share grid when that is provably safe. */
function setKnot(curve: Float64Array, rotation: Quat, meta: Meta, extra: { relax?: RelaxStats | null; view?: ViewSearch | null; keepSelection?: boolean } = {}): void {
  const safe = canQuantiseSafely(curve);
  state.curve = safe ? quantise(curve) : Float64Array.from(curve);
  state.shareable = safe;
  state.rotation = quantiseRotation(rotation);
  state.meta = meta;
  state.relax = extra.relax ?? null;
  state.view = extra.view ?? null;
  if (!extra.keepSelection) state.selected = null;
  state.centre = centroid(state.curve);
  scene.setCurve(state.curve);
  scene.setRotation(state.rotation);
  scene.fit(boundingRadius(state.curve, [0, 0, 0]));
  scene.setVisible(true);
  for (const b of presetsBox.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.id === meta.presetId));
  analyseNow();
}

function analyseNow(live = false): void {
  const t0 = performance.now();
  state.analysis = analyse(state.curve, frameFromQuaternion(state.rotation));
  state.ms = performance.now() - t0;
  if (state.selected !== null && !state.analysis.diagram?.crossings.some((c) => c.id === state.selected)) state.selected = null;
  renderPanel(live);
  buildCallouts();
}

// ---------- panel ----------

function renderPanel(live: boolean): void {
  const a = state.analysis;
  if (!a) return;
  verdictHead.innerHTML = rich(a.wording.headline);
  verdictDetail.innerHTML = rich(a.wording.detail);
  const n = a.diagram ? a.diagram.crossings.length : null;
  const rows: string[] = [];
  rows.push(
    `<dt>Crossings</dt><dd>${n ?? '—'} in this view${n !== null && n >= 3 ? '<small>A diagram only bounds the crossing number from above: the knot may need fewer.</small>' : ''}</dd>`,
  );
  const delta = a.alexander?.delta;
  rows.push(`<dt>Δ(t)</dt><dd class="math">${delta ? esc(format(delta)) : '—'}</dd>`);
  if (a.alexander?.knotDeterminant != null) rows.push(`<dt>Determinant</dt><dd>${a.alexander.knotDeterminant} <small>|Δ(−1)|</small></dd>`);
  if (a.diagram) rows.push(`<dt>Writhe</dt><dd>${minus(a.diagram.writhe)}</dd>`);
  const v = a.verdict;
  const tableText =
    v.kind === 'match'
      ? v.candidates.map((k) => k.label).join(' or ')
      : v.kind === 'trivial-diagram'
        ? '0₁ (certain)'
        : v.kind === 'no-match'
          ? 'none up to 7 crossings'
          : '—';
  rows.push(`<dt>Table</dt><dd>${rich(tableText)}</dd>`);
  facts.innerHTML = rows.join('');

  const cs = a.diagram?.crossings ?? [];
  crossingList.innerHTML = cs
    .map((c) => {
      const over = c.sign > 0 ? `${c.pd.d}→${c.pd.b}` : `${c.pd.b}→${c.pd.d}`;
      return (
        `<li data-id="${c.id}" class="${c.id === state.selected ? 'is-current' : ''}">` +
        `<span class="num" aria-hidden="true">${c.id}</span>` +
        `<span class="desc">${c.sign > 0 ? '+' : '−'} over ${over}, under ${c.pd.a}→${c.pd.c}</span>` +
        `<button type="button" class="flip" data-id="${c.id}" aria-label="Flip crossing ${c.id} (${c.sign > 0 ? 'positive' : 'negative'})">Flip</button></li>`
      );
    })
    .join('');
  crossingHint.textContent =
    cs.length === 0
      ? 'No crossings from this angle. Draw a knot, pick a plate, or turn the figure.'
      : cs.length > CALLOUT_LIMIT
        ? `${cs.length} crossings: too many to label on the figure. Relax the rope or try Fewest crossings.`
        : 'Flip swaps which strand goes over. On the figure, tap a numbered callout.';

  if (!live || (document.getElementById('working') as HTMLDetailsElement).open) {
    workingBody.innerHTML = renderWorking(a, {
      selected: state.selected,
      frame: a.diagram?.frame ?? frameFromQuaternion(state.rotation),
      points: pointCount(state.curve),
      ms: state.ms,
      relax: state.relax,
      view: state.view,
    });
  }

  figTitle.textContent = state.meta.title;
  figNum.textContent = state.meta.plate;
  const writhe = a.diagram ? ` · writhe ${minus(a.diagram.writhe)}` : '';
  figMeta.textContent = `${pointCount(state.curve)} points · ${n ?? '?'} crossings${writhe}`;
  figure.setAttribute(
    'aria-label',
    `${state.meta.title}: ${n ?? 'unknown'} crossings in this view. ${a.wording.headline}. Drag, or use the arrow keys, to turn it.`,
  );
  document.documentElement.dataset.verdict = a.verdict.kind;
}

function select(id: number | null): void {
  if (state.selected === id) return;
  state.selected = id;
  for (const li of crossingList.querySelectorAll<HTMLLIElement>('li')) li.classList.toggle('is-current', Number(li.dataset.id) === id);
  for (const g of overlay.querySelectorAll<SVGGElement>('.callout')) g.classList.toggle('is-current', Number(g.dataset.id) === id);
  const rows = workingBody.querySelectorAll('tbody tr');
  // Crossing and matrix rows are labelled by crossing number in their first cell.
  for (const tr of rows) {
    const th = tr.querySelector('th');
    if (th) tr.classList.toggle('is-current', th.textContent === String(id));
  }
  scene.invalidate();
}

crossingList.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button.flip');
  if (b) flip(Number(b.dataset.id));
});
crossingList.addEventListener('pointerover', (e) => {
  const li = (e.target as Element).closest<HTMLLIElement>('li');
  if (li) select(Number(li.dataset.id));
});
crossingList.addEventListener('focusin', (e) => {
  const li = (e.target as Element).closest<HTMLLIElement>('li');
  if (li) select(Number(li.dataset.id));
});
el<HTMLDetailsElement>('working').addEventListener('toggle', () => renderPanel(false));

// ---------- callouts ----------

interface CalloutEls {
  id: number;
  point: Vec3;
  g: SVGGElement;
  line: SVGLineElement;
  dot: SVGCircleElement;
  ring: SVGCircleElement;
  badge: SVGCircleElement;
  hit: SVGCircleElement;
  text: SVGTextElement;
}

let callouts: CalloutEls[] = [];

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function buildCallouts(): void {
  overlay.querySelectorAll('.callout').forEach((g) => g.remove());
  callouts = [];
  const cs = state.analysis?.diagram?.crossings ?? [];
  if (state.mode !== 'look' || state.busy || cs.length > CALLOUT_LIMIT) return;
  for (const c of cs) {
    const g = svgEl('g', { class: `callout${c.id === state.selected ? ' is-current' : ''}`, 'data-id': String(c.id) });
    const line = svgEl('line');
    const dot = svgEl('circle', { r: '2.6', class: 'dot' });
    const ring = svgEl('circle', { r: '13', class: 'ring' });
    const hit = svgEl('circle', { r: '19', class: 'hit' });
    const badge = svgEl('circle', { r: '11.5', class: 'badge' });
    const text = svgEl('text');
    text.textContent = String(c.id);
    g.append(line, ring, dot, hit, badge, text);
    g.addEventListener('pointerdown', (e) => e.stopPropagation());
    g.addEventListener('click', () => flip(c.id));
    g.addEventListener('pointerenter', () => select(c.id));
    overlay.append(g);
    callouts.push({ id: c.id, point: c.over.point, g, line, dot, ring, badge, hit, text });
  }
  positionCallouts();
}

function positionCallouts(): void {
  if (callouts.length === 0) return;
  const [w, h] = scene.size();
  const [cx, cy] = scene.project(state.centre);
  const anchors = callouts.map((c) => scene.project(c.point));
  // The rope's shadow on screen, so labels can sit on clear paper beside it.
  const n = pointCount(state.curve);
  const rope: [number, number][] = [];
  for (let i = 0; i < n; i++) rope.push(scene.project([state.curve[3 * i]!, state.curve[3 * i + 1]!, state.curve[3 * i + 2]!]));
  const ropePx = 0.37 / scene.unitsPerPixel() + 12;
  const placed: [number, number][] = [];
  const R = w < 480 ? 28 : 34;
  const margin = 16;
  callouts.forEach((c, k) => {
    const [ax, ay] = anchors[k]!;
    let base = Math.atan2(ay - cy, ax - cx);
    if (!Number.isFinite(base) || Math.hypot(ax - cx, ay - cy) < 1) base = -Math.PI / 2;
    let best: [number, number] | null = null;
    let bestScore = -Infinity;
    for (const off of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.7, -1.7, 2.3, -2.3, Math.PI]) {
      for (const rr of [R, R * 1.45, R * 1.9, R * 2.4]) {
        const x = ax + rr * Math.cos(base + off);
        const y = ay + rr * Math.sin(base + off);
        if (x < margin || x > w - margin || y < margin || y > h - margin) continue;
        let clear = Infinity;
        for (const p of placed) clear = Math.min(clear, Math.hypot(p[0] - x, p[1] - y) - 27);
        anchors.forEach((a, j) => {
          if (j !== k) clear = Math.min(clear, Math.hypot(a[0] - x, a[1] - y) - 18);
        });
        for (const p of rope) clear = Math.min(clear, Math.hypot(p[0] - x, p[1] - y) - ropePx);
        const score = Math.min(clear, 12) - Math.abs(off) * 3 - (rr / R - 1) * 6;
        if (score > bestScore) {
          bestScore = score;
          best = [x, y];
        }
      }
    }
    const [lx, ly] = best ?? [Math.min(w - margin, Math.max(margin, ax)), Math.min(h - margin, Math.max(margin, ay - R))];
    placed.push([lx, ly]);
    const dx = lx - ax, dy = ly - ay;
    const len = Math.hypot(dx, dy) || 1;
    c.line.setAttribute('x1', (ax + (dx / len) * 4).toFixed(1));
    c.line.setAttribute('y1', (ay + (dy / len) * 4).toFixed(1));
    c.line.setAttribute('x2', (lx - (dx / len) * 11.5).toFixed(1));
    c.line.setAttribute('y2', (ly - (dy / len) * 11.5).toFixed(1));
    for (const e of [c.dot, c.ring]) {
      e.setAttribute('cx', ax.toFixed(1));
      e.setAttribute('cy', ay.toFixed(1));
    }
    for (const e of [c.badge, c.hit]) {
      e.setAttribute('cx', lx.toFixed(1));
      e.setAttribute('cy', ly.toFixed(1));
    }
    c.text.setAttribute('x', lx.toFixed(1));
    c.text.setAttribute('y', (ly + 0.5).toFixed(1));
  });
}

scene.onFrame(positionCallouts);

// ---------- actions ----------

function clearLinkHash(): void {
  if (location.hash.startsWith('#k=')) history.replaceState(null, '', location.pathname + location.search);
}

function flip(id: number): void {
  if (state.busy || state.mode !== 'look') return;
  const d = state.analysis?.diagram;
  if (!d) return;
  const r = flipCrossing(state.curve, d, id);
  if (!r.ok) {
    showNote(`Could not flip that crossing: ${esc(r.error)}.`, 'error');
    return;
  }
  state.selected = id;
  const title = state.meta.title.endsWith(', edited') ? state.meta.title : `${state.meta.title}, edited`;
  clearLinkHash();
  hideNote();
  setKnot(r.value, state.rotation, { title, plate: 'Edited', presetId: null }, { keepSelection: true });
}

function loadPreset(p: Preset, index: number): void {
  if (state.busy) return;
  if (state.mode === 'draw') endDraw(false);
  clearLinkHash();
  hideNote();
  shareOut.hidden = true;
  setKnot(p.build(), IDENTITY, { title: p.title, plate: `Plate ${PLATES[index] ?? index + 1}`, presetId: p.id });
}

PRESETS.forEach((p, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'preset';
  b.dataset.id = p.id;
  b.setAttribute('aria-pressed', 'false');
  const code = p.expected === '0_1' && p.id === 'tangled' ? '?' : p.expected.replace('_', '').replace(/(\d)(\d)$/, (_, a: string, c: string) => `${a}${'₀₁₂₃₄₅₆₇₈₉'[Number(c)]}`);
  b.innerHTML = `<b>${esc(code)}</b>${esc(p.id === 'tangled' ? 'Tangled?' : p.title)}`;
  b.title = p.blurb;
  b.addEventListener('click', () => loadPreset(p, i));
  presetsBox.append(b);
});

function animateRotation(to: Quat, done: () => void): void {
  const from = scene.getRotation();
  const dot = Math.abs(from[0] * to[0] + from[1] * to[1] + from[2] * to[2] + from[3] * to[3]);
  if (reduceMotion.matches || dot > 0.99999) {
    scene.setRotation(to);
    done();
    return;
  }
  const start = performance.now();
  const dur = 650;
  const step = (): void => {
    const t = Math.min(1, (performance.now() - start) / dur);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    scene.setRotation(qSlerp(from, to, e));
    if (t < 1) requestAnimationFrame(step);
    else done();
  };
  requestAnimationFrame(step);
}

/** A rotation close to `current` that looks along `dir` (knot coordinates). */
function facing(dir: Vec3, current: Quat): Quat {
  const shown = rotateVec(current, dir);
  return qNorm(qMul(qFromTo(shown, [0, 0, 1]), current));
}

function turnTo(target: Quat, meta: Meta, extra: { relax?: RelaxStats | null; view?: ViewSearch | null } = {}, curve = state.curve): void {
  setBusy(true);
  buildCallouts();
  animateRotation(target, () => {
    setBusy(false);
    setKnot(curve, target, meta, extra);
  });
}

function simplestNow(): void {
  if (state.busy || state.mode !== 'look') return;
  const current = frameFromQuaternion(state.rotation).v;
  const vs = simplestView(state.curve, current);
  hideNote();
  turnTo(facing(vs.direction, state.rotation), state.meta, { relax: state.relax, view: vs });
}

function faceOn(): void {
  if (state.busy || state.mode !== 'look') return;
  hideNote();
  turnTo(IDENTITY, state.meta, { relax: state.relax });
}

function relaxNow(): void {
  if (state.busy || state.mode !== 'look') return;
  setBusy(true);
  buildCallouts();
  hideNote();
  clearLinkHash();
  const r = createRelaxer(state.curve);
  const finish = (): void => {
    const stats = r.stats();
    // Recentre (a pure translation cannot change the knot).
    const c = Float64Array.from(r.curve);
    const [mx, my, mz] = centroid(c);
    for (let i = 0; i < c.length; i += 3) {
      c[i]! -= mx;
      c[i + 1]! -= my;
      c[i + 2]! -= mz;
    }
    const vs = simplestView(c, frameFromQuaternion(state.rotation).v);
    const target = facing(vs.direction, state.rotation);
    const title = state.meta.title.replace(/, relaxed$/, '') + ', relaxed';
    scene.setCurve(c);
    scene.fit(boundingRadius(c, [0, 0, 0]));
    animateRotation(target, () => {
      setBusy(false);
      setKnot(c, target, { ...state.meta, title }, { relax: stats, view: vs });
      showNote(
        `<strong>Relaxed in ${stats.steps} steps.</strong> Turned to the view with the fewest crossings found (${vs.crossings}). The knot cannot have changed: no point ever moved more than 0.45 × the smallest gap in the rope.`,
      );
    });
  };
  if (reduceMotion.matches) {
    r.step(DEFAULT_RELAX.maxSteps);
    finish();
    return;
  }
  const tick = (): void => {
    const s = r.step(6);
    scene.setCurve(r.curve);
    showNote(`Relaxing… step ${s.steps}`);
    if (s.done) finish();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------- drawing ----------

let stroke: number[] = [];
let pencil: SVGPolylineElement | null = null;
let pencilPts: string[] = [];
let drawing = false;
let saved: { curve: Float64Array; rotation: Quat; meta: Meta } | null = null;
const DRAW_RADIUS = 5.2;

function startDraw(): void {
  if (state.busy) return;
  saved = { curve: state.curve, rotation: state.rotation, meta: state.meta };
  state.mode = 'draw';
  btnDraw.setAttribute('aria-pressed', 'true');
  btnDraw.textContent = 'Cancel drawing';
  figure.classList.add('is-drawing');
  scene.setRotation(IDENTITY);
  scene.fit(DRAW_RADIUS);
  scene.setVisible(false);
  shareOut.hidden = true;
  updateSway();
  buildCallouts();
  showNote('<strong>Draw one loop that crosses itself.</strong> Keep the pen down; let go and the ends join with a straight line.');
}

function endDraw(restore: boolean): void {
  state.mode = 'look';
  btnDraw.setAttribute('aria-pressed', 'false');
  btnDraw.textContent = 'Draw a knot';
  figure.classList.remove('is-drawing');
  pencil?.remove();
  pencil = null;
  drawing = false;
  if (restore && saved) {
    setKnot(saved.curve, saved.rotation, saved.meta);
  }
  saved = null;
  updateSway();
}

function localXY(e: PointerEvent): [number, number] {
  const r = figure.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function finishStroke(): void {
  drawing = false;
  const prepared = prepareStroke(stroke);
  const fail = (msg: string): void => {
    pencil?.remove();
    pencil = null;
    showNote(`<strong>Try again:</strong> ${esc(msg)}.`, 'error');
  };
  if (!prepared.ok) return fail(prepared.error);
  const lifted = liftDrawing(prepared.value);
  if (!lifted.ok) return fail(lifted.error);
  endDraw(false);
  clearLinkHash();
  setKnot(lifted.value, IDENTITY, { title: 'Your drawing', plate: 'Drawn', presetId: null });
  const n = state.analysis?.diagram?.crossings.length ?? 0;
  showNote(
    n === 0
      ? 'That loop never crosses itself, so it is the unknot. Draw one that crosses over itself to tie something.'
      : `<strong>${n} crossing${n === 1 ? '' : 's'}, set to alternate over and under.</strong> Tap a number to flip one; <em>Relax</em> lets the rope settle.`,
  );
}

// ---------- pointer: draw or turn ----------

let dragging = false;
let last: [number, number] = [0, 0];
let moved = 0;
let liveQueued = false;

figure.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || state.busy) return;
  figure.setPointerCapture(e.pointerId);
  const [x, y] = localXY(e);
  if (state.mode === 'draw') {
    drawing = true;
    hideNote();
    stroke = [...scene.toPlane(x, y)];
    pencilPts = [`${x.toFixed(1)},${y.toFixed(1)}`];
    pencil?.remove();
    pencil = svgEl('polyline', { class: 'pencil', points: pencilPts.join(' ') });
    overlay.append(pencil);
    return;
  }
  dragging = true;
  moved = 0;
  last = [x, y];
  state.swayAllowed = false;
  updateSway();
  figure.classList.add('is-dragging');
});

figure.addEventListener('pointermove', (e) => {
  const [x, y] = localXY(e);
  if (drawing) {
    if (stroke.length / 2 >= MAX_STROKE_POINTS) return;
    const [px, py] = pencilPts[pencilPts.length - 1]!.split(',').map(Number) as [number, number];
    if (Math.hypot(x - px, y - py) < 2) return;
    stroke.push(...scene.toPlane(x, y));
    pencilPts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    pencil?.setAttribute('points', pencilPts.join(' '));
    return;
  }
  if (!dragging) return;
  const dx = x - last[0], dy = y - last[1];
  last = [x, y];
  moved += Math.hypot(dx, dy);
  const k = 0.0085;
  const q = qNorm(qMul(qMul(qAxis([0, 1, 0], dx * k), qAxis([1, 0, 0], dy * k)), scene.getRotation()));
  scene.setRotation(q);
  if (!liveQueued) {
    liveQueued = true;
    requestAnimationFrame(() => {
      liveQueued = false;
      if (!dragging) return;
      // Live: the diagram (and its numbers) change as you turn; the polynomial does not.
      state.rotation = scene.getRotation();
      analyseNow(true);
    });
  }
});

function endPointer(): void {
  if (drawing) {
    finishStroke();
    return;
  }
  if (!dragging) return;
  dragging = false;
  figure.classList.remove('is-dragging');
  if (moved > 2) {
    clearLinkHash();
    state.rotation = quantiseRotation(scene.getRotation());
    scene.setRotation(state.rotation);
    state.view = null;
    analyseNow();
  }
}

figure.addEventListener('pointerup', endPointer);
figure.addEventListener('pointercancel', endPointer);

figure.addEventListener('keydown', (e) => {
  if (state.mode !== 'look' || state.busy) {
    if (e.key === 'Escape' && state.mode === 'draw') endDraw(true);
    return;
  }
  const step = (8 * Math.PI) / 180;
  let q: Quat | null = null;
  if (e.key === 'ArrowLeft') q = qAxis([0, 1, 0], -step);
  if (e.key === 'ArrowRight') q = qAxis([0, 1, 0], step);
  if (e.key === 'ArrowUp') q = qAxis([1, 0, 0], -step);
  if (e.key === 'ArrowDown') q = qAxis([1, 0, 0], step);
  if (!q) return;
  e.preventDefault();
  state.swayAllowed = false;
  clearLinkHash();
  state.rotation = quantiseRotation(qNorm(qMul(q, state.rotation)));
  scene.setRotation(state.rotation);
  state.view = null;
  updateSway();
  analyseNow();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.mode === 'draw') endDraw(true);
});

btnDraw.addEventListener('click', () => (state.mode === 'draw' ? endDraw(true) : startDraw()));
btnRelax.addEventListener('click', relaxNow);
btnSimplest.addEventListener('click', simplestNow);
btnTop.addEventListener('click', faceOn);

// ---------- sharing ----------

btnShare.addEventListener('click', () => {
  if (state.busy) return;
  shareOut.hidden = false;
  if (!state.shareable) {
    shareUrl.value = '';
    shareStatus.textContent = 'This rope has two strands too close together to snap to the link grid safely. Relax it first.';
    return;
  }
  const frag = encodeKnot(state.curve, state.rotation);
  history.replaceState(null, '', `${location.pathname}${location.search}#${frag}`);
  shareUrl.value = location.href;
  shareUrl.select();
  shareStatus.textContent = '';
  navigator.clipboard
    ?.writeText(location.href)
    .then(() => {
      shareStatus.textContent = 'Copied.';
    })
    .catch(() => {
      shareStatus.textContent = 'Select the link and copy it.';
    });
});

function loadFromHash(): boolean {
  const h = location.hash;
  if (!h.startsWith('#k=')) return false;
  const d = decodeKnot(h);
  if (!d.ok) {
    showNote(`<strong>That share link couldn't be read:</strong> ${esc(d.error)}. Showing the trefoil instead.`, 'error');
    return false;
  }
  hideNote();
  setKnot(d.knot.curve, d.knot.rotation, { title: 'Shared knot', plate: 'From a link', presetId: null });
  return true;
}

window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#k=') && !state.busy) {
    if (!loadFromHash()) loadPreset(PRESETS[1]!, 1);
  }
});

// ---------- theme ----------

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent = theme === 'dark' ? 'Cream paper' : 'Dark paper';
  themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
  const palette: Palette = { paper: cssColor('--paper'), rope: cssColor('--rope'), ink: cssColor('--ink') };
  scene.setPalette(palette);
}

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const savedTheme = safeGet('knot-theme');
applyTheme(savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : systemDark.matches ? 'dark' : 'light');
themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  safeSet('knot-theme', next);
  applyTheme(next);
});
systemDark.addEventListener('change', () => {
  const s = safeGet('knot-theme');
  if (s !== 'dark' && s !== 'light') applyTheme(systemDark.matches ? 'dark' : 'light');
});
reduceMotion.addEventListener('change', updateSway);

// ---------- start ----------

if (!loadFromHash()) loadPreset(PRESETS[1]!, 1);
if (rendererNote) showNote(esc(rendererNote), 'error');
updateSway();
document.documentElement.dataset.status = 'ready';

// A small, read-only window for the end-to-end tests.
declare global {
  interface Window {
    __knot?: unknown;
  }
}
window.__knot = {
  summary: () => ({
    headline: state.analysis?.wording.headline ?? '',
    crossings: state.analysis?.diagram?.crossings.length ?? null,
    pd: state.analysis ? formatPD(state.analysis.pd) : '',
    delta: state.analysis?.alexander?.delta ? format(state.analysis.alexander.delta) : null,
    selected: state.selected,
    mode: state.mode,
    busy: state.busy,
    swaying: scene.isSwaying(),
    points: pointCount(state.curve),
    shareable: state.shareable,
    callouts: callouts.length,
  }),
  probe: () => scene.probe(),
};
