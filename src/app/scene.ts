// The three.js side: an orthographic "plate camera", the rope as a TubeGeometry with a
// hatch shader, and two back-face hulls (ink outline, paper halo). Nothing here decides
// anything about the knot; it only draws what the topology code hands it.

import {
  BackSide,
  BufferAttribute,
  CatmullRomCurve3,
  FrontSide,
  Group,
  Mesh,
  OrthographicCamera,
  Quaternion,
  Scene,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { type Quat, pointCount, totalLength } from '../topology/geometry.ts';
import { hullFragment, hullVertex, ropeFragment, ropeVertex } from './shaders.ts';

export const ROPE_RADIUS = 0.2;

/** Longest straight stretch the tube is built from (world units). */
const RENDER_STEP = 0.25;
const MAX_RENDER_POINTS = 2400;

/**
 * The analysed rope is a polygon. A smooth spline through only its corners can wander off
 * it when the corners are far apart (a sparse shared rope, say), and then the crossing dots
 * would not sit on the drawn crossings. So the tube is built through extra points laid along
 * each straight segment: the drawing follows the polygon, with only its corners rounded.
 */
export function renderPoints(curve: Float64Array): Vector3[] {
  const n = pointCount(curve);
  let step = RENDER_STEP;
  const total = totalLength(curve);
  if (total / step + n > MAX_RENDER_POINTS) step = total / Math.max(1, MAX_RENDER_POINTS - n);
  const pts: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = curve[3 * i]!, ay = curve[3 * i + 1]!, az = curve[3 * i + 2]!;
    const bx = curve[3 * j]!, by = curve[3 * j + 1]!, bz = curve[3 * j + 2]!;
    const pieces = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) / step));
    for (let k = 0; k < pieces; k++) {
      const t = k / pieces;
      pts.push(new Vector3(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t));
    }
  }
  return pts;
}

export interface Palette {
  readonly paper: [number, number, number];
  readonly rope: [number, number, number];
  readonly ink: [number, number, number];
}

export interface SceneApi {
  readonly ok: true;
  setCurve(curve: Float64Array): void;
  /** The knot's rotation (display). */
  setRotation(q: Quat): void;
  getRotation(): Quat;
  /** Gentle idle sway about the vertical axis (off under reduced motion). */
  setSway(on: boolean): void;
  isSwaying(): boolean;
  setVisible(on: boolean): void;
  /** Frame the view so a sphere of this radius fits. */
  fit(radius: number): void;
  setPalette(p: Palette): void;
  /** Knot-space point → CSS pixels within the figure, using the displayed rotation. */
  project(p: readonly [number, number, number]): [number, number];
  /** CSS pixels → world x, y on the z = 0 plane (for drawing; rotation must be identity). */
  toPlane(x: number, y: number): [number, number];
  /** World units per CSS pixel. */
  unitsPerPixel(): number;
  size(): [number, number];
  invalidate(): void;
  onFrame(cb: () => void): void;
  /**
   * For the tests: render now and count ink-coloured pixels. With `at` (CSS pixels in the
   * figure), also say for each point whether rope (not paper, not empty) is drawn within 2 px.
   */
  probe(at?: readonly [number, number][]): { webgl2: boolean; inkPixels: number; width: number; height: number; ropeAt: boolean[] };
}

export type SceneResult = SceneApi | { readonly ok: false; readonly error: string };

function vec(c: readonly [number, number, number]): Vector3 {
  return new Vector3(c[0], c[1], c[2]);
}

export function createScene(canvas: HTMLCanvasElement, host: HTMLElement): SceneResult {
  let renderer: WebGLRenderer;
  try {
    const probe = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!probe) return { ok: false, error: 'this browser has WebGL 2 turned off or unavailable' };
    renderer = new WebGLRenderer({ canvas, context: probe, antialias: true, alpha: true });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'WebGL could not start' };
  }
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 200);
  camera.position.set(0, 0, 60);
  camera.lookAt(0, 0, 0);
  const group = new Group();
  scene.add(group);

  const ropeMat = new ShaderMaterial({
    vertexShader: ropeVertex,
    fragmentShader: ropeFragment,
    side: FrontSide,
    uniforms: {
      uFill: { value: new Vector3(1, 1, 1) },
      uInk: { value: new Vector3(0, 0, 0) },
      uPixelRatio: { value: 1 },
      uTwist: { value: 40 },
      uHatch: { value: 4.6 },
    },
  });
  const inkMat = new ShaderMaterial({
    vertexShader: hullVertex,
    fragmentShader: hullFragment,
    side: BackSide,
    // Lift ≤ √((r+e)² − r²) keeps each hull behind its own rope's rim (no inward ink creep).
    uniforms: { uExtrude: { value: 0.05 }, uLift: { value: 0.14 }, uForeshorten: { value: 0 }, uColor: { value: new Vector3(0, 0, 0) } },
  });
  const haloMat = new ShaderMaterial({
    vertexShader: hullVertex,
    fragmentShader: hullFragment,
    side: BackSide,
    // The halo shrinks where the rope runs towards the viewer, so a steep strand doesn't
    // cut gaps into itself (see hullVertex).
    uniforms: { uExtrude: { value: 0.17 }, uLift: { value: 0.3 }, uForeshorten: { value: 1 }, uColor: { value: new Vector3(1, 1, 1) } },
  });

  let geometry: TubeGeometry | null = null;
  const rope = new Mesh(undefined, ropeMat);
  const ink = new Mesh(undefined, inkMat);
  const halo = new Mesh(undefined, haloMat);
  group.add(halo, ink, rope);

  let radius = 5;
  let width = 1, height = 1;
  const base = new Quaternion();
  const display = new Quaternion();
  const sway = new Quaternion();
  const up = new Vector3(0, 1, 0);
  let swayOn = false;
  let swayStart = performance.now();
  let frameCb: (() => void) | null = null;
  let pending = false;

  const layout = (): void => {
    const r = host.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    ropeMat.uniforms.uPixelRatio!.value = dpr;
    const aspect = width / height;
    const pad = radius * 1.16 + ROPE_RADIUS * 2;
    let hw = pad, hh = pad;
    if (aspect >= 1) hw = pad * aspect;
    else hh = pad / aspect;
    camera.left = -hw;
    camera.right = hw;
    camera.top = hh;
    camera.bottom = -hh;
    camera.updateProjectionMatrix();
  };

  const draw = (): void => {
    pending = false;
    if (swayOn) {
      const t = (performance.now() - swayStart) / 1000;
      sway.setFromAxisAngle(up, 0.09 * Math.sin((2 * Math.PI * t) / 11));
      display.multiplyQuaternions(sway, base);
    } else {
      display.copy(base);
    }
    group.quaternion.copy(display);
    renderer.render(scene, camera);
    frameCb?.();
    if (swayOn) invalidate();
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

  const tmp = new Vector3();

  return {
    ok: true,
    setCurve(curve: Float64Array): void {
      const pts = renderPoints(curve);
      const m = pts.length;
      const path = new CatmullRomCurve3(pts, true, 'centripetal');
      path.arcLengthDivisions = Math.min(9600, m * 4);
      const tubular = Math.min(2400, Math.max(m * 2, 64));
      const next = new TubeGeometry(path, tubular, ROPE_RADIUS, 12, true);
      // Each ring of the tube gets its centre line's direction, for the halo shader.
      const radial = 12;
      const tan = new Float32Array((tubular + 1) * (radial + 1) * 3);
      for (let i = 0; i <= tubular; i++) {
        const t = next.tangents[i % tubular]!; // the closing ring repeats the first
        for (let j = 0; j <= radial; j++) tan.set([t.x, t.y, t.z], 3 * (i * (radial + 1) + j));
      }
      next.setAttribute('aTangent', new BufferAttribute(tan, 3));
      geometry?.dispose();
      geometry = next;
      rope.geometry = next;
      ink.geometry = next;
      halo.geometry = next;
      // An integer number of lay twists so the pattern closes up seamlessly.
      ropeMat.uniforms.uTwist!.value = Math.max(8, Math.round(totalLength(curve) / 0.95));
      invalidate();
    },
    setRotation(q: Quat): void {
      base.set(q[0], q[1], q[2], q[3]).normalize();
      // Update the displayed rotation now, not at the next frame, so project() (and the label
      // layout that uses it) sees the new view straight away.
      if (swayOn) display.multiplyQuaternions(sway, base);
      else display.copy(base);
      invalidate();
    },
    getRotation(): Quat {
      return [base.x, base.y, base.z, base.w];
    },
    setSway(on: boolean): void {
      if (on && !swayOn) {
        swayStart = performance.now();
        sway.identity();
      }
      swayOn = on;
      if (!on) display.copy(base);
      invalidate();
    },
    isSwaying: () => swayOn,
    setVisible(on: boolean): void {
      group.visible = on;
      invalidate();
    },
    fit(r: number): void {
      radius = Math.max(2, r);
      layout();
      invalidate();
    },
    setPalette(p: Palette): void {
      (ropeMat.uniforms.uFill!.value as Vector3).copy(vec(p.rope));
      (ropeMat.uniforms.uInk!.value as Vector3).copy(vec(p.ink));
      (inkMat.uniforms.uColor!.value as Vector3).copy(vec(p.ink));
      (haloMat.uniforms.uColor!.value as Vector3).copy(vec(p.paper));
      invalidate();
    },
    project(p): [number, number] {
      camera.updateMatrixWorld();
      tmp.set(p[0], p[1], p[2]).applyQuaternion(display).project(camera);
      return [((tmp.x + 1) / 2) * width, ((1 - tmp.y) / 2) * height];
    },
    toPlane(x: number, y: number): [number, number] {
      return [camera.left + (x / width) * (camera.right - camera.left), camera.top - (y / height) * (camera.top - camera.bottom)];
    },
    unitsPerPixel(): number {
      return (camera.right - camera.left) / width;
    },
    size(): [number, number] {
      return [width, height];
    },
    invalidate,
    onFrame(cb: () => void): void {
      frameCb = cb;
    },
    probe(at) {
      group.quaternion.copy(display);
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const inkColor = inkMat.uniforms.uColor!.value as Vector3;
      const paper = haloMat.uniforms.uColor!.value as Vector3;
      let count = 0;
      for (let i = 0; i < px.length; i += 16) {
        if (px[i + 3]! < 200) continue;
        const d = Math.abs(px[i]! / 255 - inkColor.x) + Math.abs(px[i + 1]! / 255 - inkColor.y) + Math.abs(px[i + 2]! / 255 - inkColor.z);
        if (d < 0.25) count++;
      }
      const sx = w / width, sy = h / height;
      const ropeAt = (at ?? []).map(([x, y]) => {
        const cx = Math.round(x * sx), cy = h - 1 - Math.round(y * sy);
        const r = Math.max(1, Math.round(2 * sx));
        for (let yy = cy - r; yy <= cy + r; yy++) {
          for (let xx = cx - r; xx <= cx + r; xx++) {
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const i = 4 * (yy * w + xx);
            if (px[i + 3]! < 200) continue;
            const d = Math.abs(px[i]! / 255 - paper.x) + Math.abs(px[i + 1]! / 255 - paper.y) + Math.abs(px[i + 2]! / 255 - paper.z);
            if (d > 0.05) return true;
          }
        }
        return false;
      });
      return { webgl2: renderer.capabilities.isWebGL2, inkPixels: count, width: w, height: h, ropeAt };
    },
  };
}
