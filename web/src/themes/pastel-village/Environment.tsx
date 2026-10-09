import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { EnvironmentProps, LightingPreset } from "../../theme-engine/types";
import { composeTown } from "./composition";
import { Flora } from "./flora";
import { pierStart, seeded } from "./layout";
import { TOKENS } from "./palette";
import { Flowers, Plaza } from "./plaza";
import { Picnic, Pier } from "./shore";
import { Terrain } from "./terrain";

// ───────────────────────── sky & light ─────────────────────────

function Sky({ lighting }: { lighting: LightingPreset }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
        vertexShader: `varying vec3 vPos; void main(){ vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vPos;
          void main(){ float h = smoothstep(-0.15, 0.7, vPos.y); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }`,
      }),
    [],
  );
  const target = useMemo(() => ({ top: new THREE.Color(), bottom: new THREE.Color() }), []);
  useFrame((_, dt) => {
    target.top.set(lighting.skyTop);
    target.bottom.set(lighting.skyBottom);
    material.uniforms.top.value.lerp(target.top, Math.min(1, dt * 2));
    material.uniforms.bottom.value.lerp(target.bottom, Math.min(1, dt * 2));
  });
  return (
    <mesh material={material} renderOrder={-1}>
      <sphereGeometry args={[220, 32, 16]} />
    </mesh>
  );
}

/** Smoothly animates lights and fog towards the active time-of-day preset. */
function Lights({ lighting }: { lighting: LightingPreset }) {
  const ambient = useRef<THREE.AmbientLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const tmp = useMemo(() => ({ c: new THREE.Color(), v: new THREE.Vector3() }), []);
  useFrame(({ scene }, dt) => {
    const k = Math.min(1, dt * 2);
    if (ambient.current) {
      ambient.current.color.lerp(tmp.c.set(lighting.ambient.color), k);
      ambient.current.intensity += (lighting.ambient.intensity - ambient.current.intensity) * k;
    }
    if (sun.current) {
      sun.current.color.lerp(tmp.c.set(lighting.sun.color), k);
      sun.current.intensity += (lighting.sun.intensity - sun.current.intensity) * k;
      sun.current.position.lerp(tmp.v.set(...lighting.sun.position), k);
    }
    if (hemi.current) {
      hemi.current.color.lerp(tmp.c.set(lighting.hemi.sky), k);
      hemi.current.groundColor.lerp(tmp.c.set(lighting.hemi.ground), k);
      hemi.current.intensity += (lighting.hemi.intensity - hemi.current.intensity) * k;
    }
    if (scene.fog instanceof THREE.Fog) scene.fog.color.lerp(tmp.c.set(lighting.fog), k);
  });
  return (
    <>
      <ambientLight ref={ambient} />
      <hemisphereLight ref={hemi} />
      <directionalLight
        ref={sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-34}
        shadow-camera-right={34}
        shadow-camera-top={34}
        shadow-camera-bottom={-34}
        shadow-camera-far={130}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
      />
    </>
  );
}

function Cloud({ seed }: { seed: number }) {
  const ref = useRef<THREE.Group>(null);
  const rand = useMemo(() => seeded(seed), [seed]);
  const cfg = useMemo(
    () => ({ r: 40 + rand() * 25, y: 22 + rand() * 8, a: rand() * Math.PI * 2, speed: 0.008 + rand() * 0.01, s: 1.4 + rand() * 1.2 }),
    [rand],
  );
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const a = cfg.a + clock.elapsedTime * cfg.speed;
    ref.current.position.set(Math.cos(a) * cfg.r, cfg.y, Math.sin(a) * cfg.r);
  });
  return (
    <group ref={ref} scale={cfg.s}>
      {[
        [0, 0, 0, 1.6],
        [1.5, -0.2, 0.2, 1.2],
        [-1.4, -0.3, -0.1, 1.1],
        [0.4, 0.6, -0.3, 1.0],
      ].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]}>
          <sphereGeometry args={[r, 16, 12]} />
          <meshStandardMaterial color={TOKENS.cloud} roughness={1} transparent opacity={0.92} />
        </mesh>
      ))}
    </group>
  );
}

/** Star field on the upper sky; fades in with the lighting's `stars` amount. */
function Stars({ amount }: { amount: number }) {
  const ref = useRef<THREE.Points>(null);
  const geom = useMemo(() => {
    const rand = seeded(42);
    const pos: number[] = [];
    for (let i = 0; i < 520; i++) {
      const u = rand() * Math.PI * 2;
      const v = 0.12 + rand() * 0.85; // stay above the horizon
      const r = 200;
      pos.push(Math.cos(u) * Math.cos(v * Math.PI * 0.5) * r, Math.sin(v * Math.PI * 0.5) * r, Math.sin(u) * Math.cos(v * Math.PI * 0.5) * r);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, []);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.elapsedTime * 0.004;
    const m = ref.current.material as THREE.PointsMaterial;
    m.opacity = amount * (0.8 + Math.sin(clock.elapsedTime * 1.3) * 0.1);
    ref.current.visible = amount > 0.02;
  });
  return (
    <points ref={ref} geometry={geom} renderOrder={0}>
      <pointsMaterial color="#fffbe6" size={2.2} sizeAttenuation={false} transparent depthWrite={false} fog={false} />
    </points>
  );
}

export function PastelEnvironment({ env, slots }: EnvironmentProps) {
  const lighting = env.lighting;
  const composition = useMemo(() => composeTown(slots), [slots]);
  const ps = pierStart();
  return (
    <group>
      <Sky lighting={lighting} />
      <Stars amount={lighting.stars} />
      <Lights lighting={lighting} />
      <Terrain lighting={lighting} />
      <Plaza composition={composition} glow={lighting.glow} />
      <Flowers flowers={composition.flowers} />
      <Flora composition={composition} />
      <Pier glow={lighting.glow} />
      {composition.picnic && <Picnic {...composition.picnic} glow={lighting.glow} />}
      {[1, 3, 5].map((s) => (
        <Cloud key={s} seed={s * 31} />
      ))}
    </group>
  );
}
