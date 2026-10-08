import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Composition } from "./composition";
import { Instanced, type Inst } from "./instancing";
import { seeded } from "./layout";
import { PALETTE, TOKENS } from "./palette";
import { woodTexture } from "./textures";

/** A lily pond ringed with stones and reeds. */
export function Pond({ pond }: { pond: NonNullable<Composition["pond"]> }) {
  const { rx, rz } = pond;
  const rim = useMemo<Inst[]>(() => {
    const rand = seeded(404);
    const out: Inst[] = [];
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const k = 1.06 + rand() * 0.05;
      out.push({ x: Math.cos(a) * rx * k, y: 0.06, z: Math.sin(a) * rz * k, ry: rand() * 3, s: 0.2 + rand() * 0.12, sx: 1.4, sy: 0.6, color: TOKENS.stone.rocks[Math.floor(rand() * 3)] });
    }
    return out;
  }, [rx, rz]);
  const pads = useMemo<Inst[]>(() => {
    const rand = seeded(405);
    return Array.from({ length: 7 }, () => {
      const a = rand() * Math.PI * 2;
      const r = 0.25 + rand() * 0.6;
      return { x: Math.cos(a) * rx * r, y: 0.035, z: Math.sin(a) * rz * r, ry: rand() * 6, s: 0.2 + rand() * 0.12, color: rand() < 0.5 ? "#8fd18a" : "#7fc79a" };
    });
  }, [rx, rz]);
  const blooms = useMemo<Inst[]>(() => pads.filter((_, i) => i % 2 === 0).map((p) => ({ x: p.x + 0.05, y: 0.08, z: p.z, s: 0.07, color: i2c(p.x) })), [pads]);
  const reeds = useMemo<Inst[]>(() => {
    const rand = seeded(406);
    const out: Inst[] = [];
    for (let i = 0; i < 18; i++) {
      const a = -0.6 + rand() * 1.8 + (i > 9 ? Math.PI : 0);
      const k = 1.0 + rand() * 0.12;
      out.push({ x: Math.cos(a) * rx * k, y: 0.35, z: Math.sin(a) * rz * k, rz: (rand() - 0.5) * 0.3, s: 0.7 + rand() * 0.5, color: "#7cbf86" });
    }
    return out;
  }, [rx, rz]);
  const ripple = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ripple.current) return;
    const t = (clock.elapsedTime * 0.35) % 1;
    ripple.current.scale.setScalar(0.3 + t * 0.9);
    (ripple.current.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - t);
  });
  return (
    <group position={[pond.x, 0, pond.z]} rotation={[0, pond.rot, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} scale={[rx * 1.12, rz * 1.12, 1]}>
        <circleGeometry args={[1, 40]} />
        <meshStandardMaterial color="#e6cbc6" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} scale={[rx, rz, 1]}>
        <circleGeometry args={[1, 40]} />
        <meshStandardMaterial color={TOKENS.ground.water} roughness={0.12} metalness={0.1} />
      </mesh>
      <mesh ref={ripple} rotation={[-Math.PI / 2, 0, 0]} position={[0.3, 0.04, -0.2]}>
        <ringGeometry args={[0.35, 0.4, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <Instanced items={rim} castShadow receiveShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial roughness={1} flatShading />
      </Instanced>
      <Instanced items={pads.map((p) => ({ ...p, rx: -Math.PI / 2, rz: p.ry, ry: 0 }))}>
        <circleGeometry args={[1, 12, 0.3, Math.PI * 2 - 0.5]} />
        <meshStandardMaterial roughness={0.7} side={THREE.DoubleSide} />
      </Instanced>
      <Instanced items={blooms}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial roughness={0.6} flatShading />
      </Instanced>
      <Instanced items={reeds} castShadow>
        <cylinderGeometry args={[0.02, 0.03, 0.7, 4]} />
        <meshStandardMaterial roughness={0.9} />
      </Instanced>
    </group>
  );
}

function i2c(x: number) {
  return ["#ffd1e3", "#ffffff", "#ffc2d8"][Math.abs(Math.round(x * 10)) % 3];
}

/** A fenced kitchen garden: raised beds in rows, a watering can and a little shed bench. */
export function KitchenGarden({ garden }: { garden: NonNullable<Composition["garden"]> }) {
  const { w, d } = garden;
  const wood = useMemo(() => {
    const t = woodTexture().clone();
    t.repeat.set(1, 0.3);
    t.needsUpdate = true;
    return t;
  }, []);
  const beds = useMemo(() => [-d / 3, 0, d / 3].map((z) => ({ z, len: w - 0.6 })), [w, d]);
  const crops = useMemo<Inst[]>(() => {
    const rand = seeded(505);
    const out: Inst[] = [];
    const kinds = [
      { leaf: "#86c98a", top: "#ff9e6b" }, // carrots
      { leaf: "#9bd69a", top: "#9bd69a" }, // lettuce
      { leaf: "#7fbf86", top: "#ff6f7e" }, // strawberries
    ];
    beds.forEach((b, bi) => {
      for (let x = -b.len / 2 + 0.2; x < b.len / 2; x += 0.3) {
        const k = kinds[bi % kinds.length];
        out.push({ x, y: 0.36, z: b.z + (rand() - 0.5) * 0.06, ry: rand() * 6, s: 0.13 + rand() * 0.03, sy: bi === 1 ? 0.8 : 1.3, color: k.leaf });
        if (bi !== 1) out.push({ x: x + 0.05, y: bi === 0 ? 0.3 : 0.32, z: b.z + 0.08, s: 0.05, color: k.top });
      }
    });
    return out;
  }, [beds, w]);
  const pickets = useMemo<Inst[]>(() => {
    const out: Inst[] = [];
    const hw = w / 2 + 0.25;
    const hd = d / 2 + 0.3;
    for (let x = -hw; x <= hw + 0.01; x += 0.28) {
      out.push({ x, y: 0.25, z: -hd, color: TOKENS.wood.fence });
      if (Math.abs(x) > 0.45) out.push({ x, y: 0.25, z: hd, color: TOKENS.wood.fence });
    }
    for (let z = -hd + 0.28; z < hd; z += 0.28) {
      out.push({ x: -hw, y: 0.25, z, ry: Math.PI / 2, color: TOKENS.wood.fence });
      out.push({ x: hw, y: 0.25, z, ry: Math.PI / 2, color: TOKENS.wood.fence });
    }
    return out;
  }, [w, d]);
  return (
    <group position={[garden.x, 0, garden.z]} rotation={[0, garden.rot, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <planeGeometry args={[w + 0.5, d + 0.6]} />
        <meshStandardMaterial color="#ecd3cb" roughness={1} />
      </mesh>
      {beds.map((b) => (
        <group key={b.z} position={[0, 0, b.z]}>
          <mesh castShadow receiveShadow position={[0, 0.14, 0]}>
            <boxGeometry args={[b.len, 0.28, 0.5]} />
            <meshStandardMaterial map={wood} color={TOKENS.wood.planter} roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.285, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[b.len - 0.1, 0.4]} />
            <meshStandardMaterial color="#8f6a68" roughness={1} />
          </mesh>
        </group>
      ))}
      <Instanced items={crops} castShadow>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial roughness={0.85} flatShading />
      </Instanced>
      <Instanced items={pickets}>
        <boxGeometry args={[0.08, 0.5, 0.04]} />
        <meshStandardMaterial roughness={0.8} />
      </Instanced>
      {/* watering can */}
      <group position={[w / 2 - 0.2, 0, d / 2 + 0.05]} rotation={[0, -0.6, 0]}>
        <mesh castShadow position={[0, 0.13, 0]}>
          <cylinderGeometry args={[0.11, 0.12, 0.24, 12]} />
          <meshStandardMaterial color={PALETTE.babyBlue} metalness={0.3} roughness={0.4} />
        </mesh>
        <mesh position={[0.16, 0.2, 0]} rotation={[0, 0, -0.9]}>
          <cylinderGeometry args={[0.02, 0.03, 0.26, 6]} />
          <meshStandardMaterial color={PALETTE.babyBlue} metalness={0.3} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.28, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.08, 0.015, 6, 12, Math.PI]} />
          <meshStandardMaterial color={PALETTE.babyBlue} />
        </mesh>
      </group>
    </group>
  );
}
