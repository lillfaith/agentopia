import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Instanced, type Inst } from "./instancing";
import { FEATURES, pierStart, seeded } from "./layout";
import { ginghamTexture, radialTexture, woodTexture } from "./textures";

type V3 = [number, number, number];
const BULB_COLORS = ["#fff4c9", "#ffd6e6", "#ffe9a8", "#d9f2ff"];
const BUNTING = ["#ff9fc4", "#ffd86b", "#9fe0ff", "#c9b4ff", "#a8e6b0"];

/** Points along a sagging wire between a and b. */
export function catenary(a: V3, b: V3, sag: number, n: number): V3[] {
  const out: V3[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

/** Fairy lights: bulbs on sagging wires. Brightness follows the day cycle's `glow`. */
export function StringLights({ spans, glow, perSpan = 7 }: { spans: [V3, V3][]; glow: number; perSpan?: number }) {
  const bulbs = useMemo<Inst[]>(() => spans.flatMap(([a, b], s) => catenary(a, b, 0.22, perSpan + 1).map(([x, y, z], i) => ({ x, y, z, s: 1, color: BULB_COLORS[(i + s) % BULB_COLORS.length] }))), [spans, perSpan]);
  const wire = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (const [a, b] of spans) {
      const line = [a, ...catenary(a, b, 0.22, 16), b];
      for (let i = 1; i < line.length; i++) pts.push(new THREE.Vector3(...line[i - 1]), new THREE.Vector3(...line[i]));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [spans]);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.emissiveIntensity = 0.35 + glow * (2.2 + Math.sin(clock.elapsedTime * 2) * 0.2);
  });
  return (
    <group>
      <lineSegments geometry={wire}>
        <lineBasicMaterial color="#6f6480" />
      </lineSegments>
      <Instanced items={bulbs}>
        <sphereGeometry args={[0.06, 8, 6]} />
        <meshStandardMaterial ref={mat} emissive="#ffe7a8" emissiveIntensity={0.4} roughness={0.4} />
      </Instanced>
    </group>
  );
}

function Bunting({ a, b }: { a: V3; b: V3 }) {
  const flags = useMemo<Inst[]>(() => {
    const pts = catenary(a, b, 0.3, 12);
    const ry = Math.atan2(b[0] - a[0], b[2] - a[2]) + Math.PI / 2;
    return pts.map(([x, y, z], i) => ({ x, y: y - 0.13, z, ry, rz: Math.PI, color: BUNTING[i % BUNTING.length] }));
  }, [a, b]);
  return (
    <Instanced items={flags}>
      <circleGeometry args={[0.16, 3]} />
      <meshStandardMaterial side={THREE.DoubleSide} roughness={0.8} />
    </Instanced>
  );
}

// ───────────── the pier ─────────────

export function Pier({ glow }: { glow: number }) {
  const ps = pierStart();
  const L = FEATURES.pier.length;
  const deckY = 0.3;
  const wood = useMemo(() => {
    const t = woodTexture().clone();
    t.repeat.set(0.5, 0.5);
    t.needsUpdate = true;
    return t;
  }, []);
  const planks = useMemo<Inst[]>(() => {
    const rand = seeded(303);
    const out: Inst[] = [];
    for (let z = -0.6; z < L; z += 0.3) out.push({ x: (rand() - 0.5) * 0.04, y: deckY, z, ry: (rand() - 0.5) * 0.02, color: ["#e8c9ad", "#dfbd9f", "#ecd2b8"][Math.floor(rand() * 3)] });
    // wider landing at the end
    for (let z = L; z < L + 2.6; z += 0.3) out.push({ x: 0, y: deckY, z, sx: 1.6, color: "#e3c3a6" });
    return out;
  }, [L]);
  const postZ = useMemo(() => {
    const zs: number[] = [];
    for (let z = 0; z <= L + 2.4; z += 1.9) zs.push(z);
    return zs;
  }, [L]);
  const posts = useMemo<Inst[]>(
    () =>
      postZ.flatMap((z) => {
        const half = z > L ? 1.65 : 1.05;
        return [-half, half].map((x) => ({ x, y: -0.9, z, color: "#c49a7c" }));
      }),
    [postZ, L],
  );
  const spans = useMemo<[V3, V3][]>(() => {
    const out: [V3, V3][] = [];
    for (const side of [-1, 1]) {
      for (let i = 1; i < postZ.length; i++) {
        const z0 = postZ[i - 1];
        const z1 = postZ[i];
        const h0 = z0 > L ? 1.65 : 1.05;
        const h1 = z1 > L ? 1.65 : 1.05;
        out.push([
          [side * h0, 1.45, z0],
          [side * h1, 1.45, z1],
        ]);
      }
    }
    return out;
  }, [postZ, L]);
  const lantern = useRef<THREE.MeshStandardMaterial>(null);
  const reflection = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((_, dt) => {
    const k = Math.min(1, dt * 2);
    if (lantern.current) lantern.current.emissiveIntensity += (0.3 + glow * 2.6 - lantern.current.emissiveIntensity) * k;
    if (reflection.current) reflection.current.opacity += (glow * 0.3 - reflection.current.opacity) * k;
  });
  const rot = Math.atan2(ps.dx, ps.dz);
  return (
    <group position={[ps.x, 0, ps.z]} rotation={[0, rot, 0]}>
      <Instanced items={planks} castShadow receiveShadow>
        <boxGeometry args={[2.1, 0.08, 0.27]} />
        <meshStandardMaterial map={wood} roughness={0.85} />
      </Instanced>
      <Instanced items={posts} castShadow>
        <cylinderGeometry args={[0.09, 0.1, 4.6, 8]} />
        <meshStandardMaterial roughness={0.85} />
      </Instanced>
      {/* rails */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh castShadow position={[side * 1.05, 0.95, L / 2 - 0.1]}>
            <boxGeometry args={[0.07, 0.07, L + 0.2]} />
            <meshStandardMaterial color="#c49a7c" roughness={0.8} />
          </mesh>
          <mesh castShadow position={[side * 1.65, 0.95, L + 1.2]}>
            <boxGeometry args={[0.07, 0.07, 2.4]} />
            <meshStandardMaterial color="#c49a7c" roughness={0.8} />
          </mesh>
        </group>
      ))}
      <mesh castShadow position={[0, 0.95, L + 2.4]}>
        <boxGeometry args={[3.3, 0.07, 0.07]} />
        <meshStandardMaterial color="#c49a7c" roughness={0.8} />
      </mesh>
      <StringLights spans={spans} glow={glow} />
      {/* entrance arch with bunting */}
      {[-1.15, 1.15].map((x) => (
        <mesh key={x} castShadow position={[x, 1.25, -0.4]}>
          <cylinderGeometry args={[0.07, 0.08, 2.5, 8]} />
          <meshStandardMaterial color="#f2c7d6" roughness={0.6} />
        </mesh>
      ))}
      <Bunting a={[-1.15, 2.35, -0.4]} b={[1.15, 2.35, -0.4]} />
      {/* lantern at the end of the pier, and its reflection on the water */}
      <group position={[1.3, 0, L + 2.0]}>
        <mesh castShadow position={[0, 1.3, 0]}>
          <cylinderGeometry args={[0.05, 0.07, 2.0, 8]} />
          <meshStandardMaterial color="#6f6480" metalness={0.4} roughness={0.45} />
        </mesh>
        <mesh position={[0, 2.45, 0]}>
          <boxGeometry args={[0.34, 0.44, 0.34]} />
          <meshStandardMaterial ref={lantern} color="#fff6dc" emissive="#ffd27a" emissiveIntensity={0.3} />
        </mesh>
        <mesh position={[0, 2.78, 0]} rotation={[0, Math.PI / 4, 0]}>
          <coneGeometry args={[0.32, 0.26, 4]} />
          <meshStandardMaterial color="#6f6480" />
        </mesh>
      </group>
      <mesh position={[1.3, -1.2, L + 2.6]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.6, 3.6, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial ref={reflection} map={radialTexture()} color="#ffc76b" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* steps down to the sand */}
      <mesh receiveShadow position={[0, 0.12, -0.95]}>
        <boxGeometry args={[1.9, 0.12, 0.5]} />
        <meshStandardMaterial map={wood} color="#e3c3a6" roughness={0.9} />
      </mesh>
      <Rowboat position={[-2.7, -1.22, L - 1.5]} />
    </group>
  );
}

function Rowboat({ position }: { position: V3 }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.y = position[1] + Math.sin(clock.elapsedTime * 1.1) * 0.05;
    ref.current.rotation.z = Math.sin(clock.elapsedTime * 0.9) * 0.04;
  });
  return (
    <group ref={ref} position={position} rotation={[0, 0.15, 0]}>
      <mesh castShadow scale={[0.75, 0.42, 1.7]}>
        <sphereGeometry args={[1, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
        <meshStandardMaterial color="#ff9fb8" roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.68, 1.6, 1]}>
        <circleGeometry args={[1, 18]} />
        <meshStandardMaterial color="#f3dcc5" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.06, 0.2]}>
        <boxGeometry args={[1.3, 0.06, 0.3]} />
        <meshStandardMaterial color="#e3c3a6" />
      </mesh>
    </group>
  );
}

// ───────────── picnic corner ─────────────

export function Picnic({ x, z, rot, glow }: { x: number; z: number; rot: number; glow: number }) {
  const blanket = useMemo(() => {
    const t = ginghamTexture().clone();
    t.repeat.set(2, 1.6);
    t.needsUpdate = true;
    return t;
  }, []);
  const cushion = useMemo(() => new RoundedBoxGeometry(0.6, 0.18, 0.6, 2, 0.08), []);
  const spans = useMemo<[V3, V3][]>(
    () => [
      [
        [-1.9, 2.1, -1.3],
        [1.9, 2.1, -1.3],
      ],
    ],
    [],
  );
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <mesh receiveShadow position={[0, 0.03, 0]} rotation={[0, 0.1, 0]}>
        <boxGeometry args={[2.4, 0.03, 1.8]} />
        <meshStandardMaterial map={blanket} roughness={0.95} />
      </mesh>
      <mesh castShadow position={[-0.75, 0.12, -0.45]} geometry={cushion}>
        <meshStandardMaterial color="#ffc2d8" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0.85, 0.12, 0.45]} rotation={[0, 0.5, 0]} geometry={cushion}>
        <meshStandardMaterial color="#d8c8ff" roughness={0.9} />
      </mesh>
      {/* cake on a stand */}
      <group position={[0.05, 0.05, -0.05]}>
        <mesh castShadow position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.04, 0.12, 0.22, 10]} />
          <meshStandardMaterial color="#ffffff" roughness={0.4} />
        </mesh>
        <mesh castShadow position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.36, 0.36, 0.04, 20]} />
          <meshStandardMaterial color="#ffffff" roughness={0.4} />
        </mesh>
        <mesh castShadow position={[0, 0.38, 0]}>
          <cylinderGeometry args={[0.28, 0.28, 0.22, 20]} />
          <meshStandardMaterial color="#ffd6e4" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.29, 0.29, 0.04, 20]} />
          <meshStandardMaterial color="#fffaf3" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.56, 0]}>
          <sphereGeometry args={[0.05, 10, 8]} />
          <meshStandardMaterial color="#ff5f7e" roughness={0.3} />
        </mesh>
      </group>
      {/* teapot and cups */}
      <group position={[0.65, 0.05, -0.35]}>
        <mesh castShadow position={[0, 0.13, 0]} scale={[1, 0.85, 1]}>
          <sphereGeometry args={[0.15, 14, 10]} />
          <meshStandardMaterial color="#9fd8ff" roughness={0.35} />
        </mesh>
        <mesh position={[0.17, 0.15, 0]} rotation={[0, 0, -0.8]}>
          <cylinderGeometry args={[0.02, 0.035, 0.14, 6]} />
          <meshStandardMaterial color="#9fd8ff" roughness={0.35} />
        </mesh>
        {[
          [-0.35, 0.2],
          [-0.15, 0.4],
        ].map(([cx, cz], i) => (
          <mesh key={i} castShadow position={[cx, 0.05, cz]}>
            <cylinderGeometry args={[0.055, 0.045, 0.08, 10]} />
            <meshStandardMaterial color="#ffffff" roughness={0.4} />
          </mesh>
        ))}
      </group>
      {/* wicker basket */}
      <group position={[-0.7, 0.03, 0.45]} rotation={[0, 0.4, 0]}>
        <mesh castShadow position={[0, 0.15, 0]}>
          <boxGeometry args={[0.5, 0.3, 0.34]} />
          <meshStandardMaterial color="#d9a774" roughness={1} />
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <torusGeometry args={[0.2, 0.025, 6, 16, Math.PI]} />
          <meshStandardMaterial color="#c08d5c" />
        </mesh>
      </group>
      {/* log seat */}
      <mesh castShadow position={[0, 0.2, 1.35]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.2, 0.22, 1.6, 10]} />
        <meshStandardMaterial color="#b58a6c" roughness={1} />
      </mesh>
      <Bicycle position={[2.0, 0, 0.6]} rotation={-1.0} />
      {/* poles with bunting and fairy lights over the blanket */}
      {[-1.9, 1.9].map((px) => (
        <mesh key={px} castShadow position={[px, 1.1, -1.3]}>
          <cylinderGeometry args={[0.05, 0.06, 2.2, 8]} />
          <meshStandardMaterial color="#f2c7d6" roughness={0.6} />
        </mesh>
      ))}
      <Bunting a={[-1.9, 2.15, -1.3]} b={[1.9, 2.15, -1.3]} />
      <StringLights spans={spans} glow={glow} perSpan={9} />
    </group>
  );
}

function Bicycle({ position, rotation }: { position: V3; rotation: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[-0.42, 0.42].map((zz) => (
        <mesh key={zz} castShadow position={[0, 0.3, zz]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.28, 0.03, 6, 20]} />
          <meshStandardMaterial color="#5b5f7a" roughness={0.5} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 0.48, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.85, 6]} />
        <meshStandardMaterial color="#9fd8c4" metalness={0.3} roughness={0.4} />
      </mesh>
      <mesh castShadow position={[0, 0.66, 0.38]}>
        <cylinderGeometry args={[0.02, 0.02, 0.4, 6]} />
        <meshStandardMaterial color="#9fd8c4" />
      </mesh>
      <mesh castShadow position={[0, 0.66, -0.3]}>
        <boxGeometry args={[0.12, 0.04, 0.22]} />
        <meshStandardMaterial color="#8a6a5c" />
      </mesh>
      <mesh castShadow position={[0, 0.86, 0.38]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.02, 0.02, 0.4, 6]} />
        <meshStandardMaterial color="#5b5f7a" />
      </mesh>
      <group position={[0, 0.82, 0.52]}>
        <mesh castShadow>
          <boxGeometry args={[0.3, 0.16, 0.22]} />
          <meshStandardMaterial color="#d9a774" roughness={1} />
        </mesh>
        {["#ff9fc4", "#fff1a8", "#c9b4ff"].map((c, i) => (
          <mesh key={c} position={[-0.08 + i * 0.08, 0.12, 0]}>
            <icosahedronGeometry args={[0.06, 0]} />
            <meshStandardMaterial color={c} flatShading />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** A striped camp tent on the beach. */
export function Tent({ position, rotation }: { position: V3; rotation: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow position={[0, 0.75, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[1.2, 1.5, 4, 1, true]} />
        <meshStandardMaterial color="#ffd6e4" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.5, 0.86]} rotation={[0.48, 0, 0]}>
        <planeGeometry args={[0.5, 1.0]} />
        <meshStandardMaterial color="#ff9fbf" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.4, 6]} />
        <meshStandardMaterial color="#6f6480" />
      </mesh>
      <mesh position={[0.12, 1.72, 0]}>
        <planeGeometry args={[0.24, 0.14]} />
        <meshStandardMaterial color="#ffd86b" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
