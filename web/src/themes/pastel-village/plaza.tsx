import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Composition, Placement } from "./composition";
import { PLAZA_RADIUS } from "./composition";
import { Instanced, type Inst } from "./instancing";
import { RING_RADIUS, seeded, type TownPath } from "./layout";
import { grassTexture, radialTexture, stoneTexture, woodTexture } from "./textures";

const STONES = ["#f4ebe2", "#efe3d8", "#f7efe8", "#eaded4", "#f3e5e8", "#ece2d9"];
const COBBLES = ["#e9ddd0", "#ddd1c5", "#f0e6db", "#e8d6d1", "#d9cec6", "#e4dad0"];
const MORTAR = "#d3c7bc";

// ───────────── plaza floor ─────────────

function Flagstones() {
  const items = useMemo<Inst[]>(() => {
    const rand = seeded(101);
    const out: Inst[] = [];
    let ring = 0;
    for (let r = 2.75; r < PLAZA_RADIUS - 0.1; r += 0.43, ring++) {
      const n = Math.round((2 * Math.PI * r) / 0.6);
      const off = rand() * 6;
      const band = ring % 3 === 1; // a rosy band every third ring, as in a laid plaza
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        const arc = ((2 * Math.PI * r) / n) * (0.86 + rand() * 0.06);
        out.push({
          x: Math.cos(a) * r,
          y: 0.055 + rand() * 0.012,
          z: Math.sin(a) * r,
          ry: -a + Math.PI / 2,
          sx: arc,
          sy: 1,
          sz: 0.36 + rand() * 0.03,
          color: band ? (rand() < 0.5 ? "#f1d9de" : "#ecd1d8") : STONES[Math.floor(rand() * STONES.length)],
        });
      }
    }
    return out;
  }, []);
  const geom = useMemo(() => new RoundedBoxGeometry(1, 0.08, 1, 1, 0.03), []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
        <circleGeometry args={[PLAZA_RADIUS + 0.05, 72]} />
        <meshStandardMaterial color={MORTAR} roughness={1} />
      </mesh>
      <Instanced items={items} receiveShadow>
        <primitive object={geom} attach="geometry" />
        <meshStandardMaterial roughness={0.85} />
      </Instanced>
      {/* curb between plaza and cobble ring */}
      <mesh position={[0, 0.07, 0]} receiveShadow>
        <cylinderGeometry args={[PLAZA_RADIUS + 0.32, PLAZA_RADIUS + 0.32, 0.1, 72, 1, true]} />
        <meshStandardMaterial color="#d8ccc2" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.115, 0]} receiveShadow>
        <ringGeometry args={[PLAZA_RADIUS + 0.05, PLAZA_RADIUS + 0.32, 72]} />
        <meshStandardMaterial color="#e9dfd6" roughness={0.9} />
      </mesh>
    </group>
  );
}

function starShape(points: number, outer: number, inner: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

/** Engraved stone medallion with a compass star, as in a classic town square. */
function Medallion() {
  const star = useMemo(() => starShape(8, 2.3, 0.95), []);
  const star2 = useMemo(() => starShape(8, 1.55, 0.7), []);
  const stoneMap = useMemo(() => {
    const t = stoneTexture().clone();
    t.repeat.set(0.6, 0.6);
    t.needsUpdate = true;
    return t;
  }, []);
  return (
    <group>
      <mesh position={[0, 0.07, 0]} receiveShadow>
        <cylinderGeometry args={[2.62, 2.66, 0.08, 64]} />
        <meshStandardMaterial color="#f6eee6" roughness={0.8} />
      </mesh>
      {[2.5, 2.05].map((r) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.112, 0]}>
          <ringGeometry args={[r - 0.05, r, 72]} />
          <meshStandardMaterial color="#c9b3c9" roughness={0.9} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 8]} position={[0, 0.113, 0]}>
        <shapeGeometry args={[star]} />
        <meshStandardMaterial color="#e9dcf3" roughness={0.7} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.116, 0]}>
        <shapeGeometry args={[star2]} />
        <meshStandardMaterial color="#f7d9e4" roughness={0.7} />
      </mesh>
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 2.28, 0.118, Math.sin(a) * 2.28]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[i % 2 ? 0.05 : 0.08, 12]} />
            <meshStandardMaterial color="#c9b3c9" />
          </mesh>
        );
      })}
      <Fountain stoneMap={stoneMap} />
    </group>
  );
}

function Fountain({ stoneMap }: { stoneMap: THREE.Texture }) {
  const water = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (water.current) water.current.scale.y = 1 + Math.sin(clock.elapsedTime * 3) * 0.08;
  });
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.32, 0]}>
        <cylinderGeometry args={[1.25, 1.36, 0.42, 40]} />
        <meshStandardMaterial map={stoneMap} color="#fbf3ee" roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.54, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.25, 0.07, 8, 40]} />
        <meshStandardMaterial color="#f8efe8" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.2, 40]} />
        <meshStandardMaterial color="#8fdcf5" roughness={0.1} metalness={0.1} />
      </mesh>
      <mesh castShadow position={[0, 1.0, 0]}>
        <cylinderGeometry args={[0.2, 0.32, 1.0, 16]} />
        <meshStandardMaterial color="#f3dde6" roughness={0.6} />
      </mesh>
      <mesh castShadow position={[0, 1.52, 0]}>
        <cylinderGeometry args={[0.62, 0.36, 0.2, 28]} />
        <meshStandardMaterial color="#fbf3ee" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.63, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.55, 28]} />
        <meshStandardMaterial color="#9fe3ff" roughness={0.1} />
      </mesh>
      <mesh ref={water} position={[0, 1.88, 0]}>
        <sphereGeometry args={[0.22, 16, 12]} />
        <meshStandardMaterial color="#c6f1ff" emissive="#9fe3ff" emissiveIntensity={0.35} transparent opacity={0.85} />
      </mesh>
      <Sparkles count={24} scale={[2.2, 1.8, 2.2]} position={[0, 1.3, 0]} size={4} speed={0.8} color="#d6f6ff" />
    </group>
  );
}

// ───────────── cobbles ─────────────

function cobblesAlong(paths: TownPath[]): Inst[] {
  const rand = seeded(202);
  const out: Inst[] = [];
  const add = (x: number, z: number, edge: boolean) =>
    out.push({
      x,
      y: 0.045,
      z,
      ry: rand() * 3,
      s: edge ? 1.15 : 0.9 + rand() * 0.25,
      sx: 1 + rand() * 0.3,
      color: edge ? (rand() < 0.5 ? "#d6c9bd" : "#cfc2b6") : COBBLES[Math.floor(rand() * COBBLES.length)],
    });
  // the plaza ring
  for (let r = RING_RADIUS - 0.72; r <= RING_RADIUS + 0.75; r += 0.29) {
    const edge = r < RING_RADIUS - 0.6 || r > RING_RADIUS + 0.6;
    const n = Math.round((2 * Math.PI * r) / 0.31);
    const off = rand();
    for (let i = 0; i < n; i++) {
      const a = ((i + off) / n) * Math.PI * 2 + (rand() - 0.5) * 0.01;
      add(Math.cos(a) * r, Math.sin(a) * r, edge);
    }
  }
  // winding paths
  for (const p of paths) {
    const pts = p.points;
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1];
      const [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / (len || 1);
      const nz = (bx - ax) / (len || 1);
      for (let d = carry; d < len; d += 0.29) {
        const t = d / len;
        const cx = ax + (bx - ax) * t;
        const cz = az + (bz - az) * t;
        if (Math.hypot(cx, cz) < RING_RADIUS + 0.6) continue; // merges into the ring
        for (let k = -2; k <= 2; k++) {
          const o = k * 0.27 + (rand() - 0.5) * 0.06;
          add(cx + nx * o, cz + nz * o, false);
        }
        for (const side of [-1, 1]) add(cx + nx * side * 0.7, cz + nz * side * 0.7, true);
      }
      carry = (carry + 0.29 - (len % 0.29)) % 0.29;
    }
  }
  return out;
}

/** Mortar ribbon under a path's cobbles. */
function ribbon(paths: TownPath[], width: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const p of paths) {
    const pts = p.points;
    const base = pos.length / 3;
    pts.forEach(([x, z], i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / len;
      const nz = (b[0] - a[0]) / len;
      pos.push(x + nx * width, 0.02, z + nz * width, x - nx * width, 0.02, z - nz * width);
      if (i > 0) {
        const k = base + i * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function Cobbles({ paths }: { paths: TownPath[] }) {
  const items = useMemo(() => cobblesAlong(paths), [paths]);
  const mortar = useMemo(() => ribbon(paths, 0.82), [paths]);
  const geom = useMemo(() => {
    const g = new THREE.SphereGeometry(0.15, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, 0.38, 0.9);
    return g;
  }, []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 0]} receiveShadow>
        <ringGeometry args={[RING_RADIUS - 0.85, RING_RADIUS + 0.88, 96]} />
        <meshStandardMaterial color={MORTAR} roughness={1} />
      </mesh>
      <mesh geometry={mortar} receiveShadow>
        <meshStandardMaterial color={MORTAR} roughness={1} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <Instanced items={items} receiveShadow>
        <primitive object={geom} attach="geometry" />
        <meshStandardMaterial roughness={0.8} />
      </Instanced>
    </group>
  );
}

// ───────────── hedges, flowers, benches, lamps ─────────────

export function Hedges({ hedges }: { hedges: Placement[] }) {
  const items = useMemo<Inst[]>(() => hedges.map((h) => ({ x: h.x, y: 0.28, z: h.z, ry: h.rot, sx: h.s, color: h.color })), [hedges]);
  const geom = useMemo(() => new RoundedBoxGeometry(1, 0.56, 0.6, 2, 0.2), []);
  const map = useMemo(() => {
    const t = grassTexture().clone();
    t.repeat.set(1.5, 1.5);
    t.needsUpdate = true;
    return t;
  }, []);
  return (
    <Instanced items={items} castShadow receiveShadow>
      <primitive object={geom} attach="geometry" />
      <meshStandardMaterial map={map} roughness={0.95} />
    </Instanced>
  );
}

export function Flowers({ flowers }: { flowers: Placement[] }) {
  const blooms = useMemo<Inst[]>(() => flowers.map((f) => ({ x: f.x, y: 0.26 * f.s, z: f.z, ry: f.rot, s: f.s, color: f.color })), [flowers]);
  const leaves = useMemo<Inst[]>(() => flowers.map((f) => ({ x: f.x, y: 0.07, z: f.z, ry: f.rot, s: f.s, color: "#7cc47f" })), [flowers]);
  const bloomGeom = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(0.1, 0);
    g.scale(1, 0.6, 1);
    return g;
  }, []);
  return (
    <group>
      <Instanced items={leaves}>
        <coneGeometry args={[0.1, 0.22, 5]} />
        <meshStandardMaterial roughness={0.9} flatShading />
      </Instanced>
      <Instanced items={blooms}>
        <primitive object={bloomGeom} attach="geometry" />
        <meshStandardMaterial roughness={0.7} flatShading />
      </Instanced>
    </group>
  );
}

export function Benches({ benches }: { benches: Placement[] }) {
  const wood = useMemo(() => {
    const t = woodTexture().clone();
    t.repeat.set(1, 0.4);
    t.needsUpdate = true;
    return t;
  }, []);
  return (
    <group>
      {benches.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]} rotation={[0, b.rot, 0]}>
          {[0, 1, 2].map((k) => (
            <mesh key={k} castShadow receiveShadow position={[0, 0.44, -0.14 + k * 0.15]}>
              <boxGeometry args={[1.5, 0.06, 0.12]} />
              <meshStandardMaterial map={wood} color={b.color} roughness={0.8} />
            </mesh>
          ))}
          {[0, 1].map((k) => (
            <mesh key={k} castShadow position={[0, 0.66 + k * 0.17, -0.25]} rotation={[-0.15, 0, 0]}>
              <boxGeometry args={[1.5, 0.11, 0.05]} />
              <meshStandardMaterial map={wood} color={b.color} roughness={0.8} />
            </mesh>
          ))}
          {[-0.66, 0.66].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <mesh castShadow position={[0, 0.22, 0]}>
                <boxGeometry args={[0.07, 0.44, 0.42]} />
                <meshStandardMaterial color="#6f6480" roughness={0.5} metalness={0.4} />
              </mesh>
              <mesh castShadow position={[0, 0.62, -0.25]} rotation={[-0.15, 0, 0]}>
                <boxGeometry args={[0.06, 0.45, 0.05]} />
                <meshStandardMaterial color="#6f6480" roughness={0.5} metalness={0.4} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Lantern posts (instanced), with soft light pools on the ground that fade in at dusk. */
export function Lamps({ lamps, glow }: { lamps: Placement[]; glow: number }) {
  const post = useMemo<Inst[]>(() => lamps.map((l) => ({ x: l.x, y: 0.95, z: l.z })), [lamps]);
  const base = useMemo<Inst[]>(() => lamps.map((l) => ({ x: l.x, y: 0.12, z: l.z })), [lamps]);
  const glass = useMemo<Inst[]>(() => lamps.map((l) => ({ x: l.x, y: 2.0, z: l.z, ry: l.rot })), [lamps]);
  const cap = useMemo<Inst[]>(() => lamps.map((l) => ({ x: l.x, y: 2.33, z: l.z, ry: l.rot + Math.PI / 4 })), [lamps]);
  const pools = useMemo<Inst[]>(() => lamps.map((l) => ({ x: l.x, y: 0.06, z: l.z, rx: -Math.PI / 2, s: 4.2 })), [lamps]);
  const glassMat = useRef<THREE.MeshStandardMaterial>(null);
  const poolMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((_, dt) => {
    const k = Math.min(1, dt * 2);
    if (glassMat.current) glassMat.current.emissiveIntensity += (0.25 + glow * 2.4 - glassMat.current.emissiveIntensity) * k;
    if (poolMat.current) {
      poolMat.current.opacity += (glow * 0.5 - poolMat.current.opacity) * k;
      poolMat.current.visible = poolMat.current.opacity > 0.01;
    }
  });
  return (
    <group>
      <Instanced items={base} castShadow>
        <cylinderGeometry args={[0.16, 0.2, 0.24, 8]} />
        <meshStandardMaterial color="#6f6480" roughness={0.45} metalness={0.45} />
      </Instanced>
      <Instanced items={post} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 1.9, 8]} />
        <meshStandardMaterial color="#6f6480" roughness={0.45} metalness={0.45} />
      </Instanced>
      <Instanced items={glass}>
        <boxGeometry args={[0.32, 0.42, 0.32]} />
        <meshStandardMaterial ref={glassMat} color="#fff6dc" emissive="#ffd27a" emissiveIntensity={0.3} roughness={0.3} />
      </Instanced>
      <Instanced items={cap} castShadow>
        <coneGeometry args={[0.3, 0.26, 4]} />
        <meshStandardMaterial color="#6f6480" roughness={0.45} metalness={0.45} />
      </Instanced>
      <Instanced items={pools} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial ref={poolMat} map={radialTexture()} color="#ffcf7a" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </Instanced>
    </group>
  );
}

export function Plaza({ composition, glow }: { composition: Composition; glow: number }) {
  return (
    <group>
      <Flagstones />
      <Medallion />
      <Cobbles paths={composition.paths} />
      <Hedges hedges={composition.hedges} />
      <Benches benches={composition.benches} />
      <Lamps lamps={composition.lamps} glow={glow} />
      {/* two real lights over the plaza at night; everything else uses glow pools */}
      {glow > 0.25 && (
        <>
          <pointLight position={[4.5, 2.6, 4.5]} color="#ffd98a" intensity={glow * 9} distance={11} decay={2} />
          <pointLight position={[-4.5, 2.6, -4.5]} color="#ffd98a" intensity={glow * 9} distance={11} decay={2} />
        </>
      )}
    </group>
  );
}
