// Adapted from ryanhaygood/content/shaders/noise/drift.glsl
// title: drift — slow wandering field of warm value noise
export const driftShader = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec2 uResolution;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  uv.x *= uResolution.x / uResolution.y;

  float t = uTime * 0.06;
  vec2 p = uv * 3.0 + vec2(t, t * 0.6);
  float n = noise(p) * 0.6 + noise(p * 2.3) * 0.3 + noise(p * 5.1) * 0.1;

  vec3 cool = vec3(0.04, 0.03, 0.02);
  vec3 warm = vec3(1.0, 0.70, 0.28);
  vec3 col = mix(cool, warm, smoothstep(0.35, 0.85, n));

  // gentle vignette so chrome stays readable
  vec2 cv = gl_FragCoord.xy / uResolution.xy - 0.5;
  float vig = smoothstep(0.85, 0.2, length(cv));
  col *= mix(0.55, 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}
`;
