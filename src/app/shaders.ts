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
void main() {
  vec4 mv = modelViewMatrix * vec4(position + normal * uExtrude, 1.0);
  // Pull the hull towards the viewer so it covers strands just behind it (never its own rope).
  mv.z += uLift;
  gl_Position = projectionMatrix * mv;
}
`;

export const hullFragment = /* glsl */ `
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
}
`;
