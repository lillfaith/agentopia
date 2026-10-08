import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import * as THREE from "three";
import type { EnvironmentProps, LightingPreset, SlotLayout } from "../../theme-engine/types";
import { ISLAND_RADIUS, PASTELS, RING_RADIUS, buildNav, seeded } from "./layout";

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
        shadow-camera-left={-32}
        shadow-camera-right={32}
        shadow-camera-top={32}
        shadow-camera-bottom={-32}
        shadow-camera-far={120}
        shadow-bias={-0.0004}
      />
    </>
  );
}

// ───────────────────────── terrain ─────────────────────────

function Island() {
  return (
    <group>
      <mesh receiveShadow position={[0, -0.15, 0]}>
        <cylinderGeometry args={[ISLAND_RADIUS, ISLAND_RADIUS, 0.3, 96]} />
        <meshStandardMaterial color="#b8e8a8" roughness={0.95} />
      </mesh>
      {/* soft grass rim */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[ISLAND_RADIUS - 1.2, ISLAND_RADIUS + 0.02, 96]} />
        <meshStandardMaterial color="#a5dd98" roughness={1} />
      </mesh>
      <mesh position={[0, -1.9, 0]}>
        <cylinderGeometry args={[ISLAND_RADIUS - 0.05, ISLAND_RADIUS - 2.4, 3.5, 96]} />
        <meshStandardMaterial color="#f3cfb3" roughness={1} />
      </mesh>
      <mesh position={[0, -3.8, 0]}>
        <cylinderGeometry args={[ISLAND_RADIUS - 2.4, ISLAND_RADIUS - 6, 1.2, 96]} />
        <meshStandardMaterial color="#e8b9a0" roughness={1} />
      </mesh>
    </group>
  );
}

function Water() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = -1.25 + Math.sin(clock.elapsedTime * 0.6) * 0.06;
  });
  return (
    <group>
      <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[180, 64]} />
        <meshStandardMaterial color="#a8dcf0" roughness={0.35} metalness={0.05} transparent opacity={0.95} />
      </mesh>
      <Sparkles count={70} scale={[70, 0.4, 70]} position={[0, -1.0, 0]} size={3} speed={0.25} color="#ffffff" opacity={0.7} />
    </group>
  );
}

// ───────────────────────── plaza ─────────────────────────

function Fountain({ glow }: { glow: number }) {
  const water = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (water.current) water.current.scale.y = 1 + Math.sin(clock.elapsedTime * 3) * 0.08;
  });
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.25, 0]}>
        <cylinderGeometry args={[2.0, 2.2, 0.5, 40]} />
        <meshStandardMaterial color="#fff4fa" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.48, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.75, 40]} />
        <meshStandardMaterial color="#9fe3ff" emissive="#7fd3ff" emissiveIntensity={0.25 + glow * 0.6} roughness={0.2} />
      </mesh>
      <mesh castShadow position={[0, 1.0, 0]}>
        <cylinderGeometry args={[0.35, 0.5, 1.2, 20]} />
        <meshStandardMaterial color="#ffd9ec" roughness={0.6} />
      </mesh>
      <mesh castShadow position={[0, 1.65, 0]}>
        <cylinderGeometry args={[1.0, 0.7, 0.25, 32]} />
        <meshStandardMaterial color="#fff4fa" roughness={0.6} />
      </mesh>
      <mesh ref={water} position={[0, 2.05, 0]}>
        <sphereGeometry args={[0.38, 20, 16]} />
        <meshStandardMaterial color="#b5ecff" emissive="#9fe3ff" emissiveIntensity={0.4 + glow} transparent opacity={0.85} />
      </mesh>
      <Sparkles count={30} scale={[2.6, 2.2, 2.6]} position={[0, 1.6, 0]} size={4} speed={0.8} color="#d6f6ff" />
      {/* benches */}
      {[0.6, 2.7, 4.8].map((a, i) => (
        <group key={i} position={[Math.cos(a) * 3.8, 0, Math.sin(a) * 3.8]} rotation={[0, -a + Math.PI / 2, 0]}>
          <mesh castShadow position={[0, 0.42, 0]}>
            <boxGeometry args={[1.4, 0.12, 0.45]} />
            <meshStandardMaterial color="#f7c6d9" />
          </mesh>
          <mesh castShadow position={[0, 0.7, -0.2]}>
            <boxGeometry args={[1.4, 0.45, 0.08]} />
            <meshStandardMaterial color="#f7c6d9" />
          </mesh>
          {[-0.55, 0.55].map((x) => (
            <mesh key={x} position={[x, 0.2, 0]}>
              <boxGeometry args={[0.1, 0.4, 0.4]} />
              <meshStandardMaterial color="#d9a3bd" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function Plaza() {
  return (
    <group>
      <mesh receiveShadow position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[5.2, 64]} />
        <meshStandardMaterial color="#fde8f1" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[4.9, 5.2, 64]} />
        <meshStandardMaterial color="#f5c6da" roughness={0.9} />
      </mesh>
    </group>
  );
}

// ───────────────────────── rainbow path ─────────────────────────

interface TilePlacement {
  x: number;
  z: number;
  rot: number;
  color: string;
}

function pathTiles(slots: Record<string, SlotLayout>): TilePlacement[] {
  const NAV = buildNav(slots);
  const tiles: TilePlacement[] = [];
  const ringCount = 46;
  for (let i = 0; i < ringCount; i++) {
    const a = (i / ringCount) * Math.PI * 2;
    tiles.push({ x: Math.cos(a) * RING_RADIUS, z: Math.sin(a) * RING_RADIUS, rot: -a, color: PASTELS[i % PASTELS.length] });
  }
  for (const slot of Object.keys(slots)) {
    const edge = NAV.edges.find(([a]) => a === `door:${slot}`);
    if (!edge) continue;
    const [dx, dz] = NAV.nodes[edge[0]];
    const [rx, rz] = NAV.nodes[edge[1]];
    const len = Math.hypot(dx - rx, dz - rz);
    const steps = Math.max(1, Math.round(len / 1.0));
    const rot = Math.atan2(dx - rx, dz - rz);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      tiles.push({ x: rx + (dx - rx) * t, z: rz + (dz - rz) * t, rot, color: PASTELS[(s + 3) % PASTELS.length] });
    }
  }
  return tiles;
}

function PathTiles({ slots }: { slots: Record<string, SlotLayout> }) {
  const tiles = useMemo(() => pathTiles(slots), [slots]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    tiles.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      m.compose(new THREE.Vector3(t.x, 0.04, t.z), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(t.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [tiles]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, tiles.length]} receiveShadow>
      <boxGeometry args={[0.9, 0.08, 0.9]} />
      <meshStandardMaterial roughness={0.8} />
    </instancedMesh>
  );
}

// ───────────────────────── decorations ─────────────────────────

function LollipopTree({ color, scale }: { color: string; scale: number }) {
  return (
    <group scale={scale}>
      <mesh castShadow position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.12, 0.16, 1.2, 8]} />
        <meshStandardMaterial color="#c99a7a" />
      </mesh>
      <mesh castShadow position={[0, 1.65, 0]}>
        <sphereGeometry args={[0.85, 20, 16]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      <mesh castShadow position={[0.45, 1.35, 0.3]}>
        <sphereGeometry args={[0.5, 16, 12]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
    </group>
  );
}

function MushroomTree({ cap, scale }: { cap: string; scale: number }) {
  const dots = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return [Math.cos(a) * 0.62, 1.82 + (i % 2) * 0.12, Math.sin(a) * 0.62] as [number, number, number];
      }),
    [],
  );
  return (
    <group scale={scale}>
      <mesh castShadow position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.22, 0.3, 1.4, 12]} />
        <meshStandardMaterial color="#fff6ea" />
      </mesh>
      <mesh castShadow position={[0, 1.55, 0]} scale={[1, 0.62, 1]}>
        <sphereGeometry args={[0.95, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={cap} roughness={0.6} />
      </mesh>
      {dots.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
      ))}
    </group>
  );
}

function Bush({ color, scale }: { color: string; scale: number }) {
  return (
    <group scale={scale}>
      {[
        [0, 0.35, 0, 0.5],
        [0.4, 0.28, 0.1, 0.38],
        [-0.35, 0.25, -0.05, 0.36],
      ].map(([x, y, z, r], i) => (
        <mesh key={i} castShadow position={[x, y, z]}>
          <sphereGeometry args={[r, 14, 10]} />
          <meshStandardMaterial color={color} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Lamp({ glow }: { glow: number }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.06, 0.08, 1.8, 8]} />
        <meshStandardMaterial color="#e6b8d0" />
      </mesh>
      <mesh position={[0, 1.95, 0]}>
        <sphereGeometry args={[0.24, 16, 12]} />
        <meshStandardMaterial color="#fff7d6" emissive="#ffe08a" emissiveIntensity={0.2 + glow * 2.2} />
      </mesh>
    </group>
  );
}

function Flowers({ positions }: { positions: [number, number][] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    positions.forEach(([x, z], i) => {
      m.makeTranslation(x, 0.12, z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(PASTELS[i % PASTELS.length]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [positions]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, positions.length]}>
      <sphereGeometry args={[0.11, 8, 6]} />
      <meshStandardMaterial roughness={0.7} />
    </instancedMesh>
  );
}

function Cloud({ seed }: { seed: number }) {
  const ref = useRef<THREE.Group>(null);
  const rand = useMemo(() => seeded(seed), [seed]);
  const cfg = useMemo(
    () => ({ r: 22 + rand() * 18, y: 13 + rand() * 6, a: rand() * Math.PI * 2, speed: 0.01 + rand() * 0.015, s: 0.8 + rand() * 0.9 }),
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
          <meshStandardMaterial color="#ffffff" roughness={1} transparent opacity={0.92} />
        </mesh>
      ))}
    </group>
  );
}

type Decor =
  | { kind: "tree"; x: number; z: number; color: string; s: number }
  | { kind: "mushroom"; x: number; z: number; color: string; s: number }
  | { kind: "bush"; x: number; z: number; color: string; s: number }
  | { kind: "rock"; x: number; z: number; s: number };

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

function scatter(slots: Record<string, SlotLayout>): { decor: Decor[]; flowers: [number, number][] } {
  const NAV = buildNav(slots);
  const rand = seeded(7);
  const decor: Decor[] = [];
  const flowers: [number, number][] = [];
  const spokes = Object.keys(slots)
    .map((s) => NAV.edges.find(([a]) => a === `door:${s}`))
    .filter((e): e is [string, string] => !!e)
    .map(([a, b]) => [...NAV.nodes[a], ...NAV.nodes[b]] as [number, number, number, number]);
  const blocked = (x: number, z: number, pad: number) => {
    const r = Math.hypot(x, z);
    if (r < 5.8 + pad || r > ISLAND_RADIUS - 1.2) return true;
    if (Math.abs(r - RING_RADIUS) < 1.1 + pad) return true;
    for (const s of Object.values(slots)) if (Math.hypot(x - s.position[0], z - s.position[2]) < 5.2 + pad) return true;
    for (const [ax, az, bx, bz] of spokes) if (distToSegment(x, z, ax, az, bx, bz) < 1.0 + pad) return true;
    for (const d of decor) if (Math.hypot(x - d.x, z - d.z) < 1.3 + pad) return true;
    return false;
  };
  const treeGreens = ["#9edc8f", "#b4e7a0", "#8fd3a6", "#c3eb9b", "#f9b8d0", "#ffd1a8"];
  const caps = ["#ff8fa3", "#7fb8ff", "#ff9e7a", "#c79bff"];
  for (let i = 0; i < 900 && decor.length < 95; i++) {
    const a = rand() * Math.PI * 2;
    const r = 6 + Math.sqrt(rand()) * (ISLAND_RADIUS - 7);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const roll = rand();
    if (blocked(x, z, roll < 0.6 ? 0.3 : 0)) continue;
    if (roll < 0.45) decor.push({ kind: "tree", x, z, color: treeGreens[Math.floor(rand() * treeGreens.length)], s: 0.8 + rand() * 0.6 });
    else if (roll < 0.62) decor.push({ kind: "mushroom", x, z, color: caps[Math.floor(rand() * caps.length)], s: 0.7 + rand() * 0.7 });
    else if (roll < 0.9) decor.push({ kind: "bush", x, z, color: treeGreens[Math.floor(rand() * 4)], s: 0.7 + rand() * 0.6 });
    else decor.push({ kind: "rock", x, z, s: 0.3 + rand() * 0.4 });
  }
  for (let i = 0; i < 1500 && flowers.length < 220; i++) {
    const a = rand() * Math.PI * 2;
    const r = 5.6 + rand() * (ISLAND_RADIUS - 6.5);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.abs(r - RING_RADIUS) < 0.8) continue;
    let ok = true;
    for (const s of Object.values(slots)) if (Math.hypot(x - s.position[0], z - s.position[2]) < 3.4) ok = false;
    for (const [ax, az, bx, bz] of spokes) if (distToSegment(x, z, ax, az, bx, bz) < 0.7) ok = false;
    if (ok) flowers.push([x, z]);
  }
  return { decor, flowers };
}

export function PastelEnvironment({ lighting, slots }: EnvironmentProps) {
  const { decor, flowers } = useMemo(() => scatter(slots), [slots]);
  const lamps = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        return [Math.cos(a) * (RING_RADIUS + 1.1), Math.sin(a) * (RING_RADIUS + 1.1)] as [number, number];
      }),
    [],
  );
  return (
    <group>
      <Sky lighting={lighting} />
      <Lights lighting={lighting} />
      <Water />
      <Island />
      <Plaza />
      <Fountain glow={lighting.glow} />
      <PathTiles slots={slots} />
      <Flowers positions={flowers} />
      {decor.map((d, i) => (
        <group key={i} position={[d.x, 0, d.z]} rotation={[0, (i * 1.7) % (Math.PI * 2), 0]}>
          {d.kind === "tree" && <LollipopTree color={d.color} scale={d.s} />}
          {d.kind === "mushroom" && <MushroomTree cap={d.color} scale={d.s} />}
          {d.kind === "bush" && <Bush color={d.color} scale={d.s} />}
          {d.kind === "rock" && (
            <mesh castShadow position={[0, d.s * 0.4, 0]} scale={[1.3, 0.8, 1]}>
              <dodecahedronGeometry args={[d.s, 0]} />
              <meshStandardMaterial color="#e3dcef" roughness={1} flatShading />
            </mesh>
          )}
        </group>
      ))}
      {lamps.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <Lamp glow={lighting.glow} />
          {lighting.glow > 0.3 && i % 2 === 0 && <pointLight position={[0, 2, 0]} color="#ffd98a" intensity={lighting.glow * 6} distance={7} decay={2} />}
        </group>
      ))}
      {[1, 2, 3, 4, 5, 6].map((s) => (
        <Cloud key={s} seed={s * 31} />
      ))}
    </group>
  );
}
