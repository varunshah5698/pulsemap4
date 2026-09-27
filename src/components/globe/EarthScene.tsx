import { Billboard, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
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
  GLOBE_RADIUS,
  MAX_TILT,
  easeInOutCubic,
  easeOutBack,
  latLngToVector3,
  rotationToFace,
  shortestAngle,
  vector3ToLatLng,
} from "./geo";
import { ATMOSPHERE_FRAGMENT, ATMOSPHERE_VERTEX, CLOUD_FRAGMENT, CLOUD_VERTEX, EARTH_FRAGMENT, EARTH_VERTEX } from "./shaders";
import { getGlowTexture } from "./textures";
import { Markers, type GlobePin, type MarkerHandle } from "./Markers";
import { useGlobeControls } from "./use-globe-controls";

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

export type GlobeFocusRequest = {
  id: string;
  lat: number;
  lng: number;
  /** Bump to start a new cinematic move, even to the same memory. */
  nonce: number;
};

/** Written every frame for the focused memory, read by the connector line. */
export type GlobeScreenSignal = { x: number; y: number; visible: boolean };

export type EarthGlobeProps = {
  pins: GlobePin[];
  activeId: string | null;
  justAddedId: string | null;
  focus: GlobeFocusRequest | null;
  screenRef: RefObject<GlobeScreenSignal>;
  onFocusArrived: () => void;
  onOpenMemory: (id: string) => void;
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
  activeId,
  justAddedId,
  focus,
  screenRef,
  onFocusArrived,
  onOpenMemory,
  onPickLocation,
}: EarthGlobeProps) {
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
  const registry = useRef<Map<string, MarkerHandle>>(new Map());

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
  const temps = useMemo(
    () => ({
      world: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      view: new THREE.Vector3(),
      ndc: new THREE.Vector3(),
      target: new THREE.Vector3(),
    }),
    [],
  );

  const revealRef = useRef(0.08);
  const clockRef = useRef(0);
  /** Cursor-driven offset, damped every frame on top of the idle rotation. */
  const tilt = useRef({ x: 0, y: 0 });
  const sunRef = useRef(SUN_DIRECTION.clone());
  const lastNonce = useRef<number | null>(null);
  const resumeAt = useRef(0);
  const arrivedRef = useRef(onFocusArrived);
  const openRef = useRef(onOpenMemory);
  const pickRef = useRef(onPickLocation);

  useEffect(() => {
    arrivedRef.current = onFocusArrived;
    openRef.current = onOpenMemory;
    pickRef.current = onPickLocation;
  }, [onFocusArrived, onOpenMemory, onPickLocation]);

  // Materials are ours to own: release them when the page unmounts.
  useEffect(
    () => () => {
      earthMaterial.dispose();
      (earthUniforms.uDayMap.value as THREE.Texture)?.dispose();
      (earthUniforms.uNightMap.value as THREE.Texture)?.dispose();
      (cloudUniforms.uMap.value as THREE.Texture)?.dispose();
    },
    [earthMaterial, earthUniforms, cloudUniforms],
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
    c.targetDistance = Math.min(c.targetDistance, distance);
    c.glow = 1;
    regionGlow.current?.position.copy(temps.target);
  };

  const handleSurfaceClick = (event: ThreeEvent<MouseEvent>) => {
    // Ignore the click that ends a drag.
    if (controls.current.dragged) return;
    event.stopPropagation();
    const node = group.current;
    const point = node ? node.worldToLocal(event.point.clone()) : event.point.clone();
    const { lat, lng } = vector3ToLatLng(point);
    pickRef.current({ lat, lng });
  };

  useFrame((state, delta) => {
    const node = group.current;
    const cameraNode = camera;
    if (!node || document.hidden) return;

    const c = controls.current;
    const d = Math.min(delta, 1 / 24);
    const time = state.clock.elapsedTime;
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
      if (cloudMaterial.current) {
        cloudMaterial.current.uniforms.uOpacity.value = THREE.MathUtils.damp(
          cloudMaterial.current.uniforms.uOpacity.value,
          lowPower ? 0 : 0.34,
          1.2,
          d,
        );
        cloudMaterial.current.uniforms.uSunDirection.value.copy(
          earthUniforms.uSunDirection.value,
        );
      }
    }

    /* --- a new memory: pause, aim, travel ---------------------------- */
    if (focus && focus.nonce !== lastNonce.current) {
      lastNonce.current = focus.nonce;
      beginTravel(focus.lat, focus.lng, 2.4);
    }

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
    } else if (!c.dragging && time > resumeAt.current) {
      c.spin.idle = Math.min(1, c.spin.idle + d * IDLE_RAMP);
      c.spin.y += IDLE_SPEED * c.spin.idle * d;
    }
    c.spin.x = THREE.MathUtils.clamp(c.spin.x, -MAX_TILT, MAX_TILT);

    /* --- cursor parallax and tilt ------------------------------------ */
    const px = c.pointerInside ? c.pointer.x : 0;
    const py = c.pointerInside ? c.pointer.y : 0;
    const calm = c.travel ? 0.3 : 1;
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

    /* --- clouds drift independently ---------------------------------- */
    if (clouds.current) clouds.current.rotation.y += d * 0.012;

    /* --- atmosphere responds to the cursor and to new memories -------- */
    if (atmosphereMaterial.current) {
      const uniforms = atmosphereMaterial.current.uniforms;
      const target =
        0.42 + Math.max(0, px) * 0.1 + Math.max(0, py) * 0.05 + c.glow * 0.3;
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

    /* --- earth shader ------------------------------------------------ */
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

    /* --- markers: occlusion, growth, hover response, screen signal ---- */
    const camPos = cameraNode.position;
    for (const handle of registry.current.values()) {
      const object = handle.group;
      object.getWorldPosition(temps.world);
      temps.normal.copy(temps.world).normalize();
      temps.view.copy(camPos).sub(temps.world).normalize();

      const facing = temps.normal.dot(temps.view);
      if (facing < 0.06) {
        object.visible = false;
        // The connector must not keep pointing at a point that has turned away.
        if (handle.id === activeId) screenRef.current.visible = false;
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
      if (isActive) scale *= 1.15;
      object.scale.setScalar(scale);

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
          ? Math.min(1, Math.max(0, ((time - handle.growthStart) / GROWTH_SECONDS - 0.3) / 0.5))
          : 0;
        handle.thumbMaterial.opacity = THREE.MathUtils.damp(
          handle.thumbMaterial.opacity,
          Math.max(wanted, floor) * edge,
          6,
          d,
        );
      }

      if (isActive) {
        screenRef.current.x = (ndc.x * 0.5 + 0.5) * size.width;
        screenRef.current.y = (-ndc.y * 0.5 + 0.5) * size.height;
        screenRef.current.visible = true;
      }
    }
    if (activeId && !registry.current.has(activeId) && !c.travel) {
      screenRef.current.visible = false;
    }

    /* --- clustering follows the zoom level ---------------------------- */
    const level = c.targetDistance > 3.3 ? 0 : c.targetDistance > 2.3 ? 1 : 2;
    if (level !== levelRef.current) {
      levelRef.current = level;
      setClusterLevel(level);
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
        camera={{ fov: 32, position: [0, 0, 3.1], near: 0.05, far: 220 }}
        gl={{
          antialias: !lowPower,
          powerPreference: "high-performance",
          alpha: true,
        }}
        flat
        onCreated={({ gl }) => {
          gl.setClearAlpha(0);
        }}
      >
        <GlobeScene {...props} />
      </Canvas>
    </GlobeBoundary>
  );
});
