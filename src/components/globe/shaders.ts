/**
 * GLSL for the globe. Written in GLSL1 so three.js keeps working on WebGL1
 * fallbacks; three rewrites `varying`/`texture2D`/`gl_FragColor` for WebGL2.
 */

export const EARTH_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewDirection;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDirection = normalize(cameraPosition - worldPosition.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

/**
 * Day texture lit by the sun, night texture surfacing city lights, and a cool
 * rim so the limb reads as atmosphere rather than a hard edge.
 */
export const EARTH_FRAGMENT = /* glsl */ `
  uniform sampler2D uDayMap;
  uniform sampler2D uNightMap;
  uniform vec3 uSunDirection;
  uniform float uPointerStrength;
  uniform float uReveal;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewDirection;

  void main() {
    vec3 day = texture2D(uDayMap, vUv).rgb;
    vec3 night = texture2D(uNightMap, vUv).rgb;

    float lambert = dot(vWorldNormal, normalize(uSunDirection));
    float daylight = smoothstep(-0.16, 0.24, lambert);

    vec3 lit = day * (0.14 + 0.98 * clamp(lambert, 0.0, 1.0));
    vec3 dark = night * (1.02 + uPointerStrength * 0.16) + day * 0.03;
    vec3 color = mix(dark, lit, daylight);

    float rim = pow(1.0 - clamp(dot(vWorldNormal, vViewDirection), 0.0, 1.0), 2.6);
    color += vec3(0.14, 0.34, 0.78) * rim * (0.34 + 0.22 * daylight);

    gl_FragColor = vec4(color * uReveal, 1.0);
  }
`;

export const CLOUD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

/**
 * Clouds ride on their own slightly larger shell and fade out over the night
 * side, so the dark half of the Earth never looks overcast.
 *
 * The coverage is read as alpha times red, which holds whether the source PNG
 * carries its shape in the alpha channel or in greyscale.
 */
export const CLOUD_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunDirection;
  uniform float uOpacity;

  varying vec2 vUv;
  varying vec3 vWorldNormal;

  void main() {
    vec4 sample_ = texture2D(uMap, vUv);
    float coverage = clamp(sample_.a * sample_.r * 1.4, 0.0, 1.0);

    float lambert = dot(vWorldNormal, normalize(uSunDirection));
    float daylight = smoothstep(-0.22, 0.34, lambert);

    gl_FragColor = vec4(vec3(0.93, 0.96, 1.0), coverage * uOpacity * daylight);
  }
`;

export const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vViewDirection;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDirection = normalize(cameraPosition - worldPosition.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

/** A fresnel shell: bright at the limb, invisible across the middle. */
export const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHighlight;
  uniform float uIntensity;
  uniform float uPower;

  varying vec3 vWorldNormal;
  varying vec3 vViewDirection;

  void main() {
    float facing = clamp(dot(vWorldNormal, vViewDirection), 0.0, 1.0);
    float rim = pow(1.0 - facing, uPower);
    vec3 color = mix(uColor, uHighlight, 0.35 + 0.65 * pow(facing, 3.0));
    gl_FragColor = vec4(color, rim * uIntensity);
  }
`;
