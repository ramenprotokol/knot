// A flat SVG fallback for browsers without WebGL 2 (or with ?flat in the URL): the same
// orthographic plate camera, drawn like a printed knot diagram — the whole rope once, then at
// each crossing a short piece of the over-strand again on top, with a paper halo that breaks
// the strand underneath.

import { planarHits } from '../topology/crossings.ts';
import { type Quat, pointCount, totalLength } from '../topology/geometry.ts';
import { ROPE_RADIUS, type Palette, type SceneApi } from './scene.ts';

function rotate(q: Quat, p: readonly [number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const n = Math.hypot(x, y, z, w) || 1;
  const qx = x / n, qy = y / n, qz = z / n, qw = w / n;
  // v' = v + 2w(q×v) + 2 q×(q×v)
  const cx = qy * p[2] - qz * p[1], cy = qz * p[0] - qx * p[2], cz = qx * p[1] - qy * p[0];
  const dx = qy * cz - qz * cy, dy = qz * cx - qx * cz, dz = qx * cy - qy * cx;
  return [p[0] + 2 * (qw * cx + dx), p[1] + 2 * (qw * cy + dy), p[2] + 2 * (qw * cz + dz)];
}

const hex = (c: readonly [number, number, number]) =>
  `#${c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;

export function createFlatScene(host: HTMLElement, layer: SVGSVGElement): SceneApi {
  let curve = new Float64Array(0);
  let q: Quat = [0, 0, 0, 1];
  let radius = 5;
  let width = 1, height = 1, hw = 5, hh = 5;
  let palette: Palette = { paper: [1, 1, 1], rope: [1, 1, 1], ink: [0, 0, 0] };
  let frameCb: (() => void) | null = null;
  let pending = false;

  const layout = (): void => {
    const r = host.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    const pad = radius * 1.16 + ROPE_RADIUS * 2;
    const aspect = width / height;
    hw = aspect >= 1 ? pad * aspect : pad;
    hh = aspect >= 1 ? pad : pad / aspect;
  };

  const toScreen = (p: readonly [number, number, number]): [number, number] => [
    ((p[0] + hw) / (2 * hw)) * width,
    ((hh - p[1]) / (2 * hh)) * height,
  ];

  const draw = (): void => {
    pending = false;
    const n = pointCount(curve);
    if (n < 3) {
      layer.innerHTML = '';
      frameCb?.();
      return;
    }
    const rot = new Float64Array(3 * n);
    const scr: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const p = rotate(q, [curve[3 * i]!, curve[3 * i + 1]!, curve[3 * i + 2]!]);
      rot.set(p, 3 * i);
      scr.push(toScreen(p));
    }
    const upp = (2 * hw) / width;
    const wHalo = (2 * (ROPE_RADIUS + 0.17)) / upp, wInk = (2 * (ROPE_RADIUS + 0.05)) / upp, wRope = (2 * ROPE_RADIUS) / upp;
    const pts = (idx: number[]) => idx.map((i) => `${scr[i]![0].toFixed(1)},${scr[i]![1].toFixed(1)}`).join(' ');
    const stroke = (points: string, color: string, w: number, closed: boolean, cap: string) =>
      `<${closed ? 'polygon' : 'polyline'} points="${points}" fill="none" stroke="${color}" stroke-width="${w.toFixed(1)}" stroke-linejoin="round" stroke-linecap="${cap}"/>`;
    const all = pts(Array.from({ length: n }, (_, i) => i));
    const parts = [stroke(all, hex(palette.ink), wInk, true, 'round'), stroke(all, hex(palette.rope), wRope, true, 'round')];
    // Redraw a short stretch of the over-strand at every crossing, halo first.
    let hits = planarHits(rot, 3, 400);
    if (!hits.ok && hits.reason === 'degenerate') {
      // A corner sits exactly on another strand from this angle: look a hair to one side.
      const tilt: Quat = [Math.sin(5e-5), Math.sin(3e-5), 0, 1];
      const nudged = new Float64Array(rot.length);
      for (let i = 0; i < n; i++) nudged.set(rotate(tilt, [rot[3 * i]!, rot[3 * i + 1]!, rot[3 * i + 2]!]), 3 * i);
      hits = planarHits(nudged, 3, 400);
    }
    if (hits.ok) {
      // Enough rope either side of the crossing to clear the strand underneath and its halo.
      const reach = Math.max(2, Math.ceil((ROPE_RADIUS + 0.6) / Math.max(1e-6, totalLength(curve) / n)));
      for (const h of hits.hits) {
        const zi = rot[3 * h.i + 2]! + (rot[3 * ((h.i + 1) % n) + 2]! - rot[3 * h.i + 2]!) * h.s;
        const zj = rot[3 * h.j + 2]! + (rot[3 * ((h.j + 1) % n) + 2]! - rot[3 * h.j + 2]!) * h.t;
        const seg = zi > zj ? h.i : h.j;
        const idx: number[] = [];
        for (let k = -reach; k <= reach + 1; k++) idx.push((((seg + k) % n) + n) % n);
        const piece = pts(idx);
        parts.push(stroke(piece, hex(palette.paper), wHalo, false, 'butt'));
        parts.push(stroke(piece, hex(palette.ink), wInk, false, 'butt'));
        parts.push(stroke(piece, hex(palette.rope), wRope, false, 'butt'));
      }
    }
    layer.innerHTML = parts.join('');
    frameCb?.();
  };

  const invalidate = (): void => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(draw);
  };

  new ResizeObserver(() => {
    layout();
    invalidate();
  }).observe(host);
  layout();

  return {
    ok: true,
    setCurve(c) {
      curve = Float64Array.from(c);
      invalidate();
    },
    setRotation(r) {
      q = [r[0], r[1], r[2], r[3]];
      invalidate();
    },
    getRotation: () => q,
    setSway() {
      /* no idle motion in the fallback */
    },
    isSwaying: () => false,
    setVisible(on) {
      layer.style.display = on ? '' : 'none';
    },
    fit(r) {
      radius = Math.max(2, r);
      layout();
      invalidate();
    },
    setPalette(p) {
      palette = p;
      invalidate();
    },
    project(p) {
      return toScreen(rotate(q, p));
    },
    toPlane(x, y) {
      return [(x / width) * 2 * hw - hw, hh - (y / height) * 2 * hh];
    },
    unitsPerPixel: () => (2 * hw) / width,
    size: () => [width, height],
    invalidate,
    onFrame(cb) {
      frameCb = cb;
    },
    probe: () => ({ webgl2: false, inkPixels: 0, width, height, ropeAt: [] }),
  };
}
