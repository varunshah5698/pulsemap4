import { Billboard, Stars } from "@react-three/drei";
import {
  Canvas,
  useFrame,
  useThree,
  type RootState,
  type ThreeEvent,
} from "@react-three/fiber";
import {
  Component,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import * as THREE from "three";
import {
  BASE_DISTANCE,
  GLOBE_RADIUS,
  MAX_DISTANCE,
  MAX_TILT,
  MIN_DISTANCE,
  easeInOutCubic,
  easeOutBack,
  latLngToVector3,
  markerZoomScale,
  rotationToFace,
  shortestAngle,
  vector3ToLatLng,
  viewRadiusKm,
} from "./geo";
import {
  ATMOSPHERE_FRAGMENT,
  ATMOSPHERE_VERTEX,
  CLOUD_FRAGMENT,
  CLOUD_VERTEX,
  EARTH_FRAGMENT,
  EARTH_VERTEX,
} from "./shaders";
import { getGlowTexture, getLocationTexture } from "./textures";
import { Markers, type GlobePin, type MarkerHandle } from "./Markers";
import {
  LABEL_HEIGHT,
  LABEL_WIDTH,
  PlaceMarkers,
  PLACE_SPRITE,
  type GlobePlace,
} from "./PlaceMarkers";
import { RouteLine, type RoutePoint } from "./RouteLine";
import { AUTO_RESUME_MS, useGlobeControls } from "./use-globe-controls";

export type { RoutePoint };

/* ------------------------------------------------------------------ *
 * Remote textures. Same public three.js texture set, pinned by tag so
 * the URLs cannot drift underneath us.
 * ------------------------------------------------------------------ */

const TEXTURE_BASE = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/textures/planets";
const TEXTURES = {
  day: `${TEXTURE_BASE}/earth_atmos_2048.jpg`,
  night: `${TEXTURE_BASE}/earth_lights_2048.png`,
  clouds: `${TEXTURE_BASE}/earth_clouds_1024.png`,
};

const SUN_DIRECTION = new THREE.Vector3(0.92, 0.34, 0.62).normalize();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const IDLE_SPEED = 0.032; // radians a second: one slow turn every ~3 minutes
const IDLE_RAMP = 0.18;
const TRAVEL_SECONDS = 1.9;
const RESUME_DELAY = 0.8;
const GROWTH_SECONDS = 1.15;
/** Where the globe rests and resets to. */
const IDLE_TILT = 0.24;
const IDLE_SPIN = -0.9;
/** How often the camera's position is published for the UI to read. */
const VIEW_WRITE_MS = 180;
const DOUBLE_TAP_MS = 340;
const DOUBLE_TAP_PX = 26;
/** A single tap waits this long, so a double tap can zoom instead of pinning. */
const PICK_DELAY_MS = 240;
/** Only advertise the camera as "close" once it is genuinely near the ground. */
/**
 * Below this height the globe stops turning on its own.
 *
 * The slow drift belongs to the view from space. Once someone has descended
 * into a country or a city, ground that slides away by itself is the opposite
 * of what they want — and it also means the camera finally stands still long
 * enough to ask Google about the real places in front of them.
 */
const IDLE_MIN_DISTANCE = 1.32;

const LOCAL_DISTANCE = 1.5;

/** What the frame loop must do next. Nonces make replays idempotent. */
export type GlobeCommand =
  | { kind: "focus"; lat: number; lng: number; distance?: number; nonce: number }
  | { kind: "zoom"; factor: number; nonce: number }
  | { kind: "reset"; nonce: number }
  /** Jump without the travel animation — used when returning from the 2D map. */
  | { kind: "centre"; lat: number; lng: number; distance?: number; nonce: number };

/** Written a few times a second for the UI; never read by the frame loop. */
export type GlobeView = {
  lat: number;
  lng: number;
  distance: number;
  /** Angular radius of the patch on screen, in kilometres. */
  spanKm: number;
  /** True when the camera is low enough to bother Google about places. */
  local: boolean;
  /**
   * True while the camera is genuinely on the move — a drag, a flick, a zoom
   * or the idle drift. Asking Google for places mid-motion wastes requests on
   * ground nobody is looking at, so the UI waits for a still camera.
   */
  moving: boolean;
};

export type CurrentLocation = { lat: number; lng: number } | null;

export type GlobeFocusRequest = { id: string; lat: number; lng: number; nonce: number };

/** Written every frame for the focused memory, read by the connector line. */
export type GlobeScreenSignal = { x: number; y: number; visible: boolean };

/** Written every frame for the marker under the cursor, read by the hover card. */
export type GlobeHoverSignal = { id: string | null; x: number; y: number };

export type EarthGlobeProps = {
  pins: GlobePin[];
  places: GlobePlace[];
  labelIds: string[];
  /** Real places that sit where the person already has a memory. */
  promotedPlaceIds: string[];
  activeId: string | null;
  activePlaceId: string | null;
  justAddedId: string | null;
  command: GlobeCommand | null;
  currentLocation: CurrentLocation;
  autoSpin: boolean;
  /** True while the flat map is on screen and this scene is only being kept warm. */
  paused?: boolean;
  screenRef?: RefObject<GlobeScreenSignal>;
  hoverRef?: RefObject<GlobeHoverSignal>;
  viewRef?: RefObject<GlobeView>;
  /** A trip's stops, drawn as an arc between them. Empty when there is none. */
  route?: RoutePoint[];
  /** Called once if the frame loop throws, so the page can say so. */
  onError?: (message: string) => void;
  onFocusArrived: () => void;
  onOpenMemory: (id: string) => void;
  onOpenPlace: (id: string) => void;
  onPickLocation: (coords: { lat: number; lng: number }) => void;
};

/* ------------------------------------------------------------------ *
 * Textures, loaded once and handed to the shader through uniforms.
 * ------------------------------------------------------------------ */

function placeholderTexture(red: number, green: number, blue: number) {
  const texture = new THREE.DataTexture(
    new Uint8Array([red, green, blue, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  texture.needsUpdate = true;
  return texture;
}

function useEarthTextures() {
  const gl = useThree((state) => state.gl);
  const textures = useRef<{
    day?: THREE.Texture;
    night?: THREE.Texture;
    clouds?: THREE.Texture;
  }>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());

    const load = (url: string, key: "day" | "night" | "clouds") =>
      new Promise<void>((resolve) => {
        loader.load(
          url,
          (texture) => {
            texture.anisotropy = anisotropy;
            texture.wrapS = THREE.RepeatWrapping;
            textures.current[key] = texture;
            resolve();
          },
          undefined,
          () => resolve(),
        );
      });

    Promise.all([
      load(TEXTURES.day, "day"),
      load(TEXTURES.night, "night"),
      load(TEXTURES.clouds, "clouds"),
    ]).then(() => {
      if (!cancelled) setReady(true);
    });

    const store = textures.current;
    return () => {
      cancelled = true;
      Object.values(store).forEach((texture) => texture?.dispose());
      textures.current = {};
    };
  }, [gl]);

  return { textures, ready };
}

/* ------------------------------------------------------------------ *
 * The scene.
 * ------------------------------------------------------------------ */

function GlobeScene({
  pins,
  places,
  labelIds,
  promotedPlaceIds,
  activeId,
  activePlaceId,
  justAddedId,
  command,
  currentLocation,
  autoSpin,
  route,
  screenRef,
  viewRef,
  onFocusArrived,
  onOpenMemory,
  onOpenPlace,
  onPickLocation,
  hoverRef,
  onError,
}: EarthGlobeProps) {
  /**
   * Every signal this loop writes to is normalised to a ref that definitely
   * exists. These arrive as props, and a missing or stale one (a hot reload
   * mid-session, a caller that forgot one) would otherwise crash the frame loop
   * on its first `.current` read — an uncaught error, with no recovery.
   */
  const localScreenRef = useRef<GlobeScreenSignal>({ x: 0, y: 0, visible: false });
  const localHoverRef = useRef<GlobeHoverSignal>({ id: null, x: 0, y: 0 });
  const localViewRef = useRef<GlobeView>({
    lat: 18,
    lng: 8,
    distance: BASE_DISTANCE,
    spanKm: 3400,
    local: false,
    moving: false,
  });
  const screenSignal = screenRef ?? localScreenRef;
  const hoverSignal = hoverRef ?? localHoverRef;
  const viewSignal = viewRef ?? localViewRef;

  /** Set once the frame loop has failed; the page shows its own notice. */
  const broken = useRef(false);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const controls = useGlobeControls(gl.domElement);

  const group = useRef<THREE.Group>(null);
  const clouds = useRef<THREE.Mesh>(null);
  const cloudMaterial = useRef<THREE.ShaderMaterial>(null);
  const regionGlow = useRef<THREE.Group>(null);
  const regionGlowMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const atmosphereMaterial = useRef<THREE.ShaderMaterial>(null);
  const locationSprite = useRef<THREE.Sprite>(null);
  const locationMaterial = useRef<THREE.SpriteMaterial>(null);
  const registry = useRef<Map<string, MarkerHandle>>(new Map());
  const placeRegistry = useRef<Map<string, THREE.Sprite>>(new Map());
  const placeLabelRegistry = useRef<Map<string, THREE.Sprite>>(new Map());

  const [clusterLevel, setClusterLevel] = useState(2);
  const levelRef = useRef(2);

  const lowPower = useMemo(() => {
    const cores =
      typeof navigator === "undefined" ? 8 : (navigator.hardwareConcurrency ?? 8);
    const small = typeof window !== "undefined" && window.innerWidth < 900;
    return cores <= 4 || small;
  }, []);

  const { textures, ready } = useEarthTextures();

  const earthUniforms = useMemo(
    () => ({
      uDayMap: { value: placeholderTexture(6, 10, 22) as THREE.Texture },
      uNightMap: { value: placeholderTexture(2, 3, 8) as THREE.Texture },
      uSunDirection: { value: SUN_DIRECTION.clone() },
      uPointerStrength: { value: 0.4 },
      uReveal: { value: 0.08 },
    }),
    [],
  );

  const earthMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: EARTH_VERTEX,
        fragmentShader: EARTH_FRAGMENT,
        uniforms: earthUniforms,
      }),
    [earthUniforms],
  );

  const atmosphereUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color("#3f7bff") },
      uHighlight: { value: new THREE.Color("#a9d4ff") },
      uIntensity: { value: 0.42 },
      uPower: { value: 2.7 },
    }),
    [],
  );

  const cloudUniforms = useMemo(
    () => ({
      uMap: { value: placeholderTexture(0, 0, 0) as THREE.Texture },
      uSunDirection: { value: SUN_DIRECTION.clone() },
      uOpacity: { value: 0 },
    }),
    [],
  );

  const glowTexture = useMemo(() => getGlowTexture(), []);
  const locationTexture = useMemo(() => getLocationTexture(), []);
  const temps = useMemo(
    () => ({
      world: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      view: new THREE.Vector3(),
      ndc: new THREE.Vector3(),
      target: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
    }),
    [],
  );

  const revealRef = useRef(0.08);
  const clockRef = useRef(0);
  /** Cursor-driven offset, damped every frame on top of the idle rotation. */
  const tilt = useRef({ x: 0, y: 0 });
  const sunRef = useRef(SUN_DIRECTION.clone());
  const lastNonce = useRef<number | null>(null);
  const lastViewWrite = useRef(0);
  const resumeAt = useRef(0);
  const pickTimer = useRef<number | null>(null);
  const lastClick = useRef<{ at: number; x: number; y: number } | null>(null);
  const arrivedRef = useRef(onFocusArrived);
  const openRef = useRef(onOpenMemory);
  const openPlaceRef = useRef(onOpenPlace);
  const pickRef = useRef(onPickLocation);

  useEffect(() => {
    arrivedRef.current = onFocusArrived;
    openRef.current = onOpenMemory;
    openPlaceRef.current = onOpenPlace;
    pickRef.current = onPickLocation;
  }, [onFocusArrived, onOpenMemory, onOpenPlace, onPickLocation]);

  // Materials are ours to own: release them when the page unmounts.
  useEffect(
    () => () => {
      earthMaterial.dispose();
      (earthUniforms.uDayMap.value as THREE.Texture)?.dispose();
      (earthUniforms.uNightMap.value as THREE.Texture)?.dispose();
      (cloudUniforms.uMap.value as THREE.Texture)?.dispose();
      if (pickTimer.current) window.clearTimeout(pickTimer.current);
    },
    [earthMaterial, earthUniforms, cloudUniforms],
  );

  const localPoint = useMemo(
    () =>
      currentLocation
        ? latLngToVector3(currentLocation.lat, currentLocation.lng, GLOBE_RADIUS)
        : null,
    [currentLocation],
  );

  /** Aim the globe at a coordinate and ease the camera in. */
  const beginTravel = (lat: number, lng: number, distance: number) => {
    const c = controls.current;
    latLngToVector3(lat, lng, GLOBE_RADIUS, temps.target);
    const aim = rotationToFace(temps.target);
    c.travel = {
      fromX: c.spin.x,
      fromY: c.spin.y,
      toX: aim.x,
      toY: shortestAngle(c.spin.y, aim.y),
      startedAt: clockRef.current,
      duration: TRAVEL_SECONDS,
    };
    c.spin.idle = 0;
    c.spin.velocityY = 0;
    c.spin.velocityX = 0;
    // Arriving somewhere on purpose counts as an interaction, so the globe
    // does not start sliding away the moment it gets there.
    c.interactionAt = performance.now();
    c.targetDistance = THREE.MathUtils.clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
    c.glow = 1;
    regionGlow.current?.position.copy(temps.target);
  };

  /**
   * One tap pins a point — but a second tap in the same spot is a double
   * click, which dives toward that place instead. Google-Earth behaviour.
   */
  const handleSurfaceClick = (event: ThreeEvent<MouseEvent>) => {
    const c = controls.current;
    if (c.dragged) return;
    // While the globe is still coasting, a tap is far more likely to be someone
    // stopping it than dropping a pin — so it must not open the pin dialog.
    if (Math.abs(c.spin.velocityY) > 0.08 || Math.abs(c.spin.velocityX) > 0.08) return;
    event.stopPropagation();

    const node = group.current;
    const point = node ? node.worldToLocal(event.point.clone()) : event.point.clone();
    const { lat, lng } = vector3ToLatLng(point);

    const previous = lastClick.current;
    const at = performance.now();
    const isDouble =
      previous !== null &&
      at - previous.at < DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < DOUBLE_TAP_PX;

    if (pickTimer.current) {
      window.clearTimeout(pickTimer.current);
      pickTimer.current = null;
    }

    if (isDouble) {
      lastClick.current = null;
      beginTravel(lat, lng, Math.max(MIN_DISTANCE, c.distance * 0.5));
      return;
    }

    lastClick.current = { at, x: event.clientX, y: event.clientY };
    pickTimer.current = window.setTimeout(() => {
      pickTimer.current = null;
      pickRef.current({ lat, lng });
    }, PICK_DELAY_MS);
  };

  /**
   * The whole per-frame update.
   *
   * Written as a named function so the loop can guard it: a throw from inside
   * requestAnimationFrame is not something a React error boundary can catch, so
   * without this it escapes as an uncaught error and the render loop dies.
   */
  const renderFrame = (state: RootState, delta: number) => {
    const node = group.current;
    const cameraNode = camera;
    if (!node || document.hidden) return;

    const c = controls.current;
    const d = Math.min(delta, 1 / 24);
    const time = state.clock.elapsedTime;
    const nowMs = performance.now();
    clockRef.current = time;

    /* Textures arrive asynchronously; the uniforms are swapped exactly once. */
    if (ready) {
      if (textures.current.day && earthUniforms.uDayMap.value !== textures.current.day) {
        earthUniforms.uDayMap.value = textures.current.day;
      }
      if (textures.current.night && earthUniforms.uNightMap.value !== textures.current.night) {
        earthUniforms.uNightMap.value = textures.current.night;
      }
      if (cloudMaterial.current && textures.current.clouds) {
        if (cloudMaterial.current.uniforms.uMap.value !== textures.current.clouds) {
          cloudMaterial.current.uniforms.uMap.value = textures.current.clouds;
        }
      }
    }

    /* --- commands from the UI: focus, zoom buttons, reset -------------- */
    if (command && command.nonce !== lastNonce.current) {
      lastNonce.current = command.nonce;
      if (command.kind === "focus") {
        beginTravel(command.lat, command.lng, command.distance ?? 2.35);
      } else if (command.kind === "centre") {
        // Hand-back from the 2D map: land exactly where the map was, at once.
        latLngToVector3(command.lat, command.lng, GLOBE_RADIUS, temps.target);
        const aim = rotationToFace(temps.target);
        c.spin.x = aim.x;
        c.spin.y = aim.y;
        c.spin.velocityX = 0;
        c.spin.velocityY = 0;
        c.spin.idle = 0;
        c.travel = null;
        if (typeof command.distance === "number") {
          c.targetDistance = THREE.MathUtils.clamp(
            command.distance,
            MIN_DISTANCE,
            MAX_DISTANCE,
          );
        }
        c.interactionAt = nowMs;
      } else if (command.kind === "zoom") {
        c.targetDistance = THREE.MathUtils.clamp(
          c.targetDistance * command.factor,
          MIN_DISTANCE,
          MAX_DISTANCE,
        );
        c.travel = null;
        c.interactionAt = nowMs;
        c.spin.idle = 0;
      } else {
        c.travel = {
          fromX: c.spin.x,
          fromY: c.spin.y,
          toX: IDLE_TILT,
          toY: shortestAngle(c.spin.y, IDLE_SPIN),
          startedAt: time,
          duration: 1.4,
        };
        c.spin.velocityX = 0;
        c.spin.velocityY = 0;
        c.spin.idle = 0;
        c.targetDistance = BASE_DISTANCE;
      }
    }

    /* --- travel, flick momentum, then idle drift ---------------------- */
    if (c.travel) {
      const progress = (time - c.travel.startedAt) / c.travel.duration;
      const eased = easeInOutCubic(progress);
      c.spin.x = c.travel.fromX + (c.travel.toX - c.travel.fromX) * eased;
      c.spin.y = c.travel.fromY + (c.travel.toY - c.travel.fromY) * eased;
      if (progress >= 1) {
        c.travel = null;
        resumeAt.current = time + RESUME_DELAY;
        arrivedRef.current();
      }
    } else if (
      Math.abs(c.spin.velocityY) > 0.0004 ||
      Math.abs(c.spin.velocityX) > 0.0004
    ) {
      // Flick momentum, decaying into the idle drift.
      c.spin.y += c.spin.velocityY * d;
      c.spin.x += c.spin.velocityX * d;
      const decay = Math.exp(-4.2 * d);
      c.spin.velocityY *= decay;
      c.spin.velocityX *= decay;
    } else if (!c.dragging && !c.pinching && time > resumeAt.current) {
      // Auto-rotation only ever happens when nobody is holding the globe.
      const settled =
        autoSpin &&
        c.distance > IDLE_MIN_DISTANCE &&
        nowMs - c.interactionAt > AUTO_RESUME_MS;
      if (settled) {
        c.spin.idle = Math.min(1, c.spin.idle + d * IDLE_RAMP);
        c.spin.y += IDLE_SPEED * c.spin.idle * d;
      } else {
        c.spin.idle = 0;
      }
    }
    c.spin.x = THREE.MathUtils.clamp(c.spin.x, -MAX_TILT, MAX_TILT);

    /* --- cursor parallax and tilt ------------------------------------ */
    const px = c.pointerInside ? c.pointer.x : 0;
    const py = c.pointerInside ? c.pointer.y : 0;
    const calm = c.travel || c.dragging ? 0.3 : 1;
    tilt.current.x = THREE.MathUtils.damp(tilt.current.x, py * 0.024 * calm, 2.2, d);
    tilt.current.y = THREE.MathUtils.damp(tilt.current.y, px * 0.032 * calm, 2.2, d);

    node.rotation.set(c.spin.x + tilt.current.x, c.spin.y + tilt.current.y, 0);
    node.updateMatrixWorld();

    /* --- camera: damped zoom plus a small parallax -------------------- */
    c.distance = THREE.MathUtils.damp(c.distance, c.targetDistance, 4.5, d);
    const parallax = 0.055 * c.distance * calm;
    cameraNode.position.set(px * parallax, py * parallax * 0.6, c.distance);
    cameraNode.lookAt(0, 0, 0);
    cameraNode.updateMatrixWorld();
    cameraNode.matrixWorldInverse.copy(cameraNode.matrixWorld).invert();

    /* --- as we descend, the sky shells get out of the way ------------- */
    const closeness = THREE.MathUtils.clamp(
      (c.distance - MIN_DISTANCE) / (LOCAL_DISTANCE - MIN_DISTANCE),
      0,
      1,
    );
    const shellFade = 0.25 + 0.75 * closeness;

    if (clouds.current) clouds.current.rotation.y += d * 0.012;
    if (cloudMaterial.current) {
      cloudMaterial.current.uniforms.uOpacity.value = THREE.MathUtils.damp(
        cloudMaterial.current.uniforms.uOpacity.value,
        lowPower ? 0 : 0.34 * shellFade,
        1.2,
        d,
      );
      cloudMaterial.current.uniforms.uSunDirection.value.copy(
        earthUniforms.uSunDirection.value,
      );
    }

    /* --- atmosphere responds to the cursor, zoom and new memories ------ */
    if (atmosphereMaterial.current) {
      const uniforms = atmosphereMaterial.current.uniforms;
      const target =
        (0.42 + Math.max(0, px) * 0.1 + Math.max(0, py) * 0.05 + c.glow * 0.3) * shellFade;
      uniforms.uIntensity.value = THREE.MathUtils.damp(
        uniforms.uIntensity.value,
        target,
        2,
        d,
      );
    }
    if (regionGlow.current && regionGlowMaterial.current) {
      regionGlowMaterial.current.opacity = Math.min(1, c.glow) * 0.85;
      regionGlow.current.visible = c.glow > 0.02;
      regionGlow.current.scale.setScalar(1 + Math.sin(time * 2.6) * 0.06);
    }
    c.glow = Math.max(0, c.glow - d * 0.32);

    /* --- earth shader ------------------------------------------------- */
    revealRef.current = Math.min(1, revealRef.current + d / 1.6);
    earthUniforms.uReveal.value = revealRef.current;
    earthUniforms.uPointerStrength.value = THREE.MathUtils.damp(
      earthUniforms.uPointerStrength.value,
      0.35 + Math.abs(px) * 0.3 + Math.abs(py) * 0.2,
      2,
      d,
    );
    sunRef.current.applyAxisAngle(Y_AXIS, d * 0.004);
    earthUniforms.uSunDirection.value.copy(sunRef.current);

    /* --- what the camera is looking at, for the UI -------------------- */
    if (nowMs - lastViewWrite.current > VIEW_WRITE_MS) {
      lastViewWrite.current = nowMs;
      temps.forward.set(0, 0, 1).applyQuaternion(temps.quat.copy(node.quaternion).invert());
      const centre = vector3ToLatLng(temps.forward);
      const spanKm = viewRadiusKm(c.distance);
      viewSignal.current.lat = centre.lat;
      viewSignal.current.lng = centre.lng;
      viewSignal.current.distance = c.distance;
      viewSignal.current.spanKm = spanKm;
      viewSignal.current.local = c.distance <= LOCAL_DISTANCE;
      viewSignal.current.moving =
        c.dragging ||
        c.pinching ||
        c.travel !== null ||
        c.spin.idle > 0.05 ||
        Math.abs(c.spin.velocityY) > 0.02 ||
        Math.abs(c.spin.velocityX) > 0.02 ||
        Math.abs(c.distance - c.targetDistance) > 0.01;
    }

    /* --- markers: occlusion, growth, hover, screen signal ------------- */
    const camPos = cameraNode.position;
    const zoomScale = markerZoomScale(c.distance);
    let hoveredId: string | null = null;
    let hoveredX = 0;
    let hoveredY = 0;
    for (const handle of registry.current.values()) {
      const object = handle.group;
      object.getWorldPosition(temps.world);
      temps.normal.copy(temps.world).normalize();
      temps.view.copy(camPos).sub(temps.world).normalize();

      const facing = temps.normal.dot(temps.view);
      if (facing < 0.06) {
        object.visible = false;
        // The connector must not keep pointing at a point that has turned away.
        if (handle.id === activeId) screenSignal.current.visible = false;
        continue;
      }
      object.visible = true;
      const edge = THREE.MathUtils.smoothstep(facing, 0.06, 0.45);
      const isActive = handle.id === activeId;

      // Grow out of the surface the first time a memory lands: a point, then a
      // ring, and only then the settled marker.
      let scale = 1;
      if (handle.justAdded) {
        if (handle.growthStart < 0) handle.growthStart = time;
        const growth = (time - handle.growthStart) / GROWTH_SECONDS;
        scale = growth >= 1 ? 1 : Math.max(0.001, easeOutBack(growth));
        const ringFlash = Math.max(0, 1 - growth);
        handle.ringMaterial.opacity = edge * (0.75 * (1 - ringFlash) + 0.9 * ringFlash);
      }

      const ndc = temps.ndc.copy(temps.world).project(cameraNode);
      const nearPointer =
        c.pointerInside && Math.hypot(ndc.x - c.pointer.x, ndc.y - c.pointer.y) < 0.1;

      if (nearPointer || handle.hovered) scale *= 1.2;
      // A finger on a touch screen has no hover, so markers need to look
      // tappable up close whether or not anything is pointing at them.
      if (isActive) scale *= 1.15;
      // Constant on screen: descending into a city must not turn pins into
      // continents, and zooming out must not lose them.
      object.scale.setScalar(scale * zoomScale);

      if (!handle.justAdded) {
        handle.ringMaterial.opacity = edge * (isActive ? 0.45 : 0.75);
      }
      handle.haloMaterial.opacity = edge * (nearPointer || handle.hovered ? 0.75 : 0.45);
      if (isActive) {
        handle.ring.scale.setScalar(1 + (0.5 + 0.5 * Math.sin(time * 3.2)) * 0.5);
      } else if (handle.ring.scale.x !== 1) {
        handle.ring.scale.setScalar(1);
      }

      if (handle.thumbMaterial) {
        const wanted = isActive || nearPointer || handle.hovered ? 1 : handle.thumbTarget;
        const floor = handle.justAdded
          ? Math.min(
              1,
              Math.max(0, ((time - handle.growthStart) / GROWTH_SECONDS - 0.3) / 0.5),
            )
          : 0;
        handle.thumbMaterial.opacity = THREE.MathUtils.damp(
          handle.thumbMaterial.opacity,
          Math.max(wanted, floor) * edge,
          6,
          d,
        );
      }

      const screenX = (ndc.x * 0.5 + 0.5) * size.width;
      const screenY = (-ndc.y * 0.5 + 0.5) * size.height;
      if (isActive) {
        screenSignal.current.x = screenX;
        screenSignal.current.y = screenY;
        screenSignal.current.visible = true;
      }
      // Publish the marker under the cursor; the page draws its card in DOM.
      if (handle.hovered) {
        hoveredId = handle.id;
        hoveredX = screenX;
        hoveredY = screenY;
      }
    }
    if (activeId && !registry.current.has(activeId) && !c.travel) {
      screenSignal.current.visible = false;
    }
    hoverSignal.current.id = hoveredId;
    hoverSignal.current.x = hoveredX;
    hoverSignal.current.y = hoveredY;

    /* --- real places: same occlusion, quieter than a memory ----------- */
    for (const [id, sprite] of placeRegistry.current) {
      sprite.getWorldPosition(temps.world);
      temps.normal.copy(temps.world).normalize();
      temps.view.copy(camPos).sub(temps.world).normalize();
      const facing = temps.normal.dot(temps.view);
      if (facing < 0.1) {
        sprite.visible = false;
        continue;
      }
      sprite.visible = true;
      const isActive = id === activePlaceId;
      const edge = THREE.MathUtils.smoothstep(facing, 0.1, 0.5);
      const pulse = isActive ? 1.18 + 0.08 * Math.sin(time * 3.4) : 1;
      sprite.scale.setScalar(PLACE_SPRITE * zoomScale * pulse);
      const material = sprite.material as THREE.SpriteMaterial;
      material.opacity = edge * (isActive ? 1 : 0.9);
      material.depthTest = true;

      // The name plate is a sprite too, so it has to be held at a constant size
      // on screen by the same zoom scale — otherwise it would swell to cover
      // the planet the moment someone descended into a city.
      const plate = placeLabelRegistry.current.get(id);
      if (plate) {
        plate.scale.set(LABEL_WIDTH * zoomScale * pulse, LABEL_HEIGHT * zoomScale * pulse, 1);
        (plate.material as THREE.SpriteMaterial).opacity = edge;
      }
    }

    /* --- where the person actually is --------------------------------- */
    if (locationSprite.current && locationMaterial.current) {
      locationSprite.current.getWorldPosition(temps.world);
      temps.normal.copy(temps.world).normalize();
      temps.view.copy(camPos).sub(temps.world).normalize();
      const facing = temps.normal.dot(temps.view);
      locationSprite.current.visible = facing > 0.05;
      if (facing > 0.05) {
        const pulse = 1 + 0.12 * Math.sin(time * 2.4);
        locationSprite.current.scale.setScalar(0.05 * zoomScale * pulse);
        locationMaterial.current.opacity = THREE.MathUtils.smoothstep(facing, 0.05, 0.4);
      }
    }

    /* --- clustering follows the zoom level ---------------------------- */
    const level = c.targetDistance > 3.3 ? 0 : c.targetDistance > 2.3 ? 1 : 2;
    if (level !== levelRef.current) {
      levelRef.current = level;
      setClusterLevel(level);
    }
  };

  useFrame((state, delta) => {
    try {
      if (broken.current) return;
      renderFrame(state, delta);
    } catch (error) {
      /*
       * The guard lives inside the `try` on purpose: it is the one line that runs
       * before `renderFrame`, so if this module is ever served mid-write with a
       * binding missing, the throw lands here instead of escaping.
       *
       * A throw from inside requestAnimationFrame is not something a React error
       * boundary can catch — it reaches the top of the frame loop and kills the
       * render loop for the rest of the session.
       *
       * Recovery is therefore best-effort: latching reads the same refs that may
       * be the missing ones, so that part gets its own guard. Failing to latch
       * only means the loop keeps trying, and the page keeps its 2D map.
       */
      try {
        broken.current = true;
        onErrorRef.current?.(
          error instanceof Error ? error.message : "The 3D view stopped unexpectedly.",
        );
      } catch {
        /* nothing left to latch with; the page keeps its 2D map */
      }
      console.error("Pulsemap globe frame failed:", error);
    }
  });

  return (
    <>
      {/* Inside the camera's far plane, or the starfield would simply vanish. */}
      <Stars
        radius={84}
        depth={36}
        count={lowPower ? 2600 : 5200}
        factor={5}
        saturation={0}
        fade
        speed={0.25}
      />

      <group ref={group} rotation-order="XYZ">
        <mesh onClick={handleSurfaceClick}>
          <sphereGeometry args={[GLOBE_RADIUS, lowPower ? 96 : 132, lowPower ? 64 : 84]} />
          <primitive object={earthMaterial} attach="material" />
        </mesh>

        <mesh ref={clouds}>
          <sphereGeometry args={[GLOBE_RADIUS * 1.006, 96, 64]} />
          <shaderMaterial
            ref={cloudMaterial}
            vertexShader={CLOUD_VERTEX}
            fragmentShader={CLOUD_FRAGMENT}
            uniforms={cloudUniforms}
            transparent
            depthWrite={false}
          />
        </mesh>

        <group
          ref={(node) => {
            regionGlow.current = node;
            if (node) node.rotation.order = "YXZ";
          }}
          visible={false}
        >
          <Billboard>
            <mesh>
              <planeGeometry args={[0.55, 0.55]} />
              <meshBasicMaterial
                ref={regionGlowMaterial}
                map={glowTexture}
                color="#ff8a4d"
                transparent
                opacity={0}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
          </Billboard>
        </group>

        <Markers
          pins={pins}
          activeId={activeId}
          justAddedId={justAddedId}
          clusterLevel={clusterLevel}
          onOpen={onOpenMemory}
          onCluster={(cluster) => beginTravel(cluster.lat, cluster.lng, 2.05)}
          registry={registry}
        />

        <PlaceMarkers
          places={places}
          labelIds={labelIds}
          promotedIds={promotedPlaceIds}
          activeId={activePlaceId}
          onOpen={onOpenPlace}
          registry={placeRegistry}
          labelRegistry={placeLabelRegistry}
        />

        {/* A planned trip, shown where it actually goes. */}
        {route && route.length > 1 ? <RouteLine points={route} /> : null}

        {localPoint ? (
          <sprite ref={locationSprite} position={localPoint} scale={0.05}>
            <spriteMaterial
              ref={locationMaterial}
              map={locationTexture}
              transparent
              opacity={0.95}
              depthWrite={false}
              toneMapped={false}
            />
          </sprite>
        ) : null}
      </group>

      <mesh scale={1.035}>
        <sphereGeometry args={[GLOBE_RADIUS, 96, 64]} />
        <shaderMaterial
          ref={atmosphereMaterial}
          vertexShader={ATMOSPHERE_VERTEX}
          fragmentShader={ATMOSPHERE_FRAGMENT}
          uniforms={atmosphereUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Boundary: if WebGL or the textures fail, the page still reads well.
 * ------------------------------------------------------------------ */

class GlobeBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.warn("[Pulsemap] globe disabled:", error.message);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export const EarthGlobe = memo(function EarthGlobe(props: EarthGlobeProps) {
  const lowPower = useMemo(
    () =>
      typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4,
    [],
  );

  return (
    <GlobeBoundary
      fallback={
        <div className="grid h-full w-full place-items-center bg-[#05060b] px-8 text-center">
          <div>
            <p className="text-sm font-semibold text-white">The globe needs WebGL</p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-white/50">
              Your browser could not start the 3D view. Every memory is still listed in
              the panel beside it, and each one opens its own page.
            </p>
          </div>
        </div>
      }
    >
      <Canvas
        className="h-full w-full cursor-grab active:cursor-grabbing"
        // The globe owns its own drag, pinch and wheel gestures.
        style={{ touchAction: "none" }}
        dpr={[1, lowPower ? 1.4 : 1.85]}
        camera={{ fov: 32, position: [0, 0, BASE_DISTANCE], near: 0.005, far: 220 }}
        gl={{
          antialias: !lowPower,
          powerPreference: "high-performance",
          alpha: true,
        }}
        flat
        // "never" stops drawing without tearing the scene down, so the camera,
        // the loaded textures and the memories survive a trip to the flat map.
        frameloop={props.paused ? "never" : "always"}
        onCreated={({ gl }) => {
          gl.setClearAlpha(0);
        }}
      >
        <GlobeScene {...props} />
      </Canvas>
    </GlobeBoundary>
  );
});
