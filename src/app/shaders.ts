// GLSL for the manual-illustration look: a toon/hatch shader for the rope, and a flat
// "hull" shader for the ink outline and the paper halo that breaks the strand passing under.

export const ropeVertex = /* glsl */ `
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ropeFragment = /* glsl */ `
uniform vec3 uFill;
uniform vec3 uInk;
uniform float uPixelRatio;
uniform float uTwist;
uniform float uHatch;
varying vec3 vNormal;
varying vec2 vUv;

// Distance (in CSS pixels) from p to the nearest of a family of parallel lines.
float lineDist(vec2 p, vec2 dir, float spacing) {
  float u = dot(p, dir) / spacing;
  return abs(fract(u) - 0.5) * spacing;
}

float stroke(float d, float halfWidth) {
  return 1.0 - smoothstep(halfWidth - 0.6, halfWidth + 0.6, d);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 light = normalize(vec3(-0.5, 0.7, 0.55));
  float diffuse = max(dot(n, light), 0.0);
  float rim = 1.0 - clamp(n.z, 0.0, 1.0);
  float tone = clamp((1.0 - diffuse) * 0.95 + rim * 0.2, 0.0, 1.0);

  vec2 p = gl_FragCoord.xy / uPixelRatio;
  float spacing = uHatch;
  // First hatch at 45°, thickening with shade; cross-hatch at −45° in deep shade.
  float w1 = mix(0.0, 1.25, smoothstep(0.42, 0.95, tone));
  float w2 = mix(0.0, 1.0, smoothstep(0.72, 1.0, tone));
  float h = 0.0;
  if (w1 > 0.05) h = max(h, stroke(lineDist(p, vec2(0.7071, 0.7071), spacing), w1));
  if (w2 > 0.05) h = max(h, stroke(lineDist(p, vec2(0.7071, -0.7071), spacing), w2));

  // Rope lay: three strands spiralling along the rope.
  float s = vUv.x * uTwist + vUv.y * 3.0;
  float fs = fwidth(s);
  float ds = abs(fract(s) - 0.5);
  float lay = smoothstep(0.5 - fs * 1.4, 0.5 - fs * 0.3, ds);
  lay *= mix(0.55, 1.0, tone);

  float ink = max(h, lay);
  gl_FragColor = vec4(mix(uFill, uInk, ink), 1.0);
}
`;

export const hullVertex = /* glsl */ `
uniform float uExtrude;
uniform float uLift;
uniform float uForeshorten;
attribute vec3 aTangent;
void main() {
  // How much the rope here lies across the picture (1) rather than running towards the viewer
  // (0). Where it tilts towards the viewer, one stretch of rope sits in front of the next, and
  // a full halo (it reaches 0.37 out and 0.3 forward) would cut gaps into the strand itself
  // once the tilt passes about 25°; so the halo shrinks with the tilt.
  vec3 t = normalMatrix * aTangent;
  float across = length(t.xy) / max(length(t), 1e-6);
  float k = mix(1.0, 0.1 + 0.9 * smoothstep(0.8, 0.97, across), uForeshorten);
  vec4 mv = modelViewMatrix * vec4(position + normal * uExtrude * k, 1.0);
  // Pull the hull towards the viewer so it covers strands just behind it (never its own rope).
  mv.z += uLift * k;
  gl_Position = projectionMatrix * mv;
}
`;

export const hullFragment = /* glsl */ `
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
}
`;
