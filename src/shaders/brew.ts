// Adapted from ryanhaygood/content/shaders/noise/brew.glsl
// title: brew — low-res brew folding hazy milk, eerie violet bloom
export const brewShader = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform float uTime;
uniform vec2 uResolution;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(73.31, 197.5))) * 19483.7163);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.55;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.07 + vec2(5.2, 1.3);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;

  float cellsY = 165.0;
  vec2 cells = vec2(floor(cellsY * uResolution.x / uResolution.y), cellsY);
  vec2 puv = floor(uv * cells) / cells;
  vec2 p = puv;
  p.x *= uResolution.x / uResolution.y;

  float t = uTime * 0.11;

  vec2 q = vec2(
    fbm(p * 1.7 + vec2(0.0, t)),
    fbm(p * 1.7 + vec2(5.2, -t * 0.7))
  );
  vec2 r = vec2(
    fbm(p * 2.1 + q * 2.3 + vec2(1.7, 9.2) + sin(t * 1.3) * 0.4),
    fbm(p * 2.1 + q * 2.3 + vec2(-8.3, 2.8) - cos(t * 0.9) * 0.4)
  );
  float f = fbm(p * 3.0 + r * 1.9 - vec2(0.0, t * 0.4));

  vec3 bean   = vec3(0.04, 0.02, 0.03);
  vec3 brew   = vec3(0.30, 0.13, 0.07);
  vec3 crema  = vec3(0.78, 0.46, 0.20);
  vec3 milk   = vec3(0.94, 0.88, 0.78);
  vec3 violet = vec3(0.42, 0.18, 0.55);
  vec3 ghost  = vec3(0.18, 0.55, 0.62);

  vec3 col = mix(bean, brew, smoothstep(0.20, 0.55, f));
  col = mix(col, crema, smoothstep(0.55, 0.72, f));
  col = mix(col, milk, smoothstep(0.74, 0.88, f));

  float bloom = smoothstep(0.55, 0.85, length(r - 0.5) * (0.8 + 0.4 * sin(t * 1.7)));
  col = mix(col, violet, bloom * 0.45);
  col = mix(col, ghost, smoothstep(0.62, 0.92, q.x) * 0.22);

  float steps = 9.0;
  col = floor(col * steps) / (steps - 1.0);

  gl_FragColor = vec4(col, 1.0);
}
`;
