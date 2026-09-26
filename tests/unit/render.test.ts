import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatmullRomCurve3, Vector3 } from 'three';
import { renderPoints } from '../../src/app/scene.ts';
import { extractDiagram } from '../../src/topology/crossings.ts';
import { TOP_FRAME, pointCount, resampleClosed } from '../../src/topology/geometry.ts';
import { trefoilCurve } from '../../src/topology/presets.ts';
import { quantise } from '../../src/topology/share.ts';

/** Distance from p to the closed polygon c. */
function toPolygon(c: Float64Array, p: Vector3): number {
  const n = pointCount(c);
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = new Vector3(c[3 * i], c[3 * i + 1], c[3 * i + 2]);
    const b = new Vector3(c[3 * j], c[3 * j + 1], c[3 * j + 2]);
    const ab = b.clone().sub(a);
    const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
    best = Math.min(best, a.add(ab.multiplyScalar(t)).distanceTo(p));
  }
  return best;
}

test('the drawn tube follows the analysed polygon, even for a sparse 8-point shared rope', () => {
  // An 8-corner trefoil, as a share link can carry it: long straight segments.
  const sparse = quantise(resampleClosed(trefoilCurve(300), 3, 8));
  const d = extractDiagram(sparse, TOP_FRAME);
  assert.ok(d.ok);
  assert.equal(d.diagram.crossings.length, 3);
  const pts = renderPoints(sparse);
  assert.ok(pts.length > 100, `${pts.length} points along the polygon`);
  for (const p of pts) assert.ok(toPolygon(sparse, p) < 1e-9, 'every render point lies on the polygon');
  // The spline through them stays within a hair of the polygon (corners are rounded a little)…
  const path = new CatmullRomCurve3(pts, true, 'centripetal');
  let worst = 0;
  for (let k = 0; k < 2000; k++) worst = Math.max(worst, toPolygon(sparse, path.getPoint(k / 2000)));
  assert.ok(worst < 0.12, `spline strays ${worst.toFixed(3)} from the polygon`);
  // …so each crossing's centre-line point (where its dot is drawn) is on the drawn rope.
  const samples = path.getSpacedPoints(4000);
  for (const c of d.diagram.crossings) {
    for (const q of [c.over.point, c.under.point]) {
      const at = new Vector3(q[0], q[1], q[2]);
      const near = Math.min(...samples.map((s) => s.distanceTo(at)));
      assert.ok(near < 0.05, `crossing ${c.id}: drawn rope is ${near.toFixed(3)} away`);
    }
  }
});

test('dense ropes are left alone, and huge ones are capped', () => {
  const dense = trefoilCurve(300);
  assert.ok(renderPoints(dense).length <= 2 * 300);
  const huge = new Float64Array(480 * 3);
  for (let i = 0; i < 480; i++) {
    const t = (2 * Math.PI * i) / 480;
    huge.set([90 * Math.cos(t), 90 * Math.sin(t), 0], 3 * i);
  }
  assert.ok(renderPoints(huge).length <= 2400);
});
