import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import * as THREE from "three";
import type { LightingPreset } from "../../theme-engine/types";
import { Instanced, type Inst } from "./instancing";
import { beachWidthAt, islandRadiusAt, seeded } from "./layout";
import { grassTexture, radialTexture, sandTexture, waterTexture } from "./textures";

const N = 200;
const WATER_Y = -1.25;

function angles(): number[] {
  return Array.from({ length: N + 1 }, (_, i) => (i / N) * Math.PI * 2);
}

/** Radius where the shore meets the water at angle `a`. */
function waterline(a: number): number {
  const R = islandRadiusAt(a);
  const w = beachWidthAt(a);
  const cliff = R - 0.54;
  if (w < 0.05) return cliff;
  return Math.max(cliff, R + 0.15 + 0.74 * (0.85 * w - 0.15));
}

/** Builds a strip of quads between rings of (radius(a), y, colour) profiles. */
function ringStrip(rows: { r: (a: number) => number; y: (a: number) => number; color: string; alpha?: number }[], keep?: (a: number) => boolean): THREE.BufferGeometry {
  const as = angles();
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  const withAlpha = rows.some((r) => r.alpha !== undefined);
  as.forEach((a) => {
    for (const row of rows) {
      const r = row.r(a);
      pos.push(Math.cos(a) * r, row.y(a), Math.sin(a) * r);
      c.set(row.color);
      col.push(c.r, c.g, c.b);
      if (withAlpha) col.push(row.alpha ?? 1);
    }
  });
  const R = rows.length;
  for (let i = 0; i < N; i++) {
    if (keep && !keep(as[i]) && !keep(as[i + 1])) continue;
    for (let j = 0; j < R - 1; j++) {
      const a = i * R + j;
      const b = (i + 1) * R + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, withAlpha ? 4 : 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function GrassTop() {
  const geom = useMemo(() => {
    const shape = new THREE.Shape();
    angles().forEach((a, i) => {
      const r = islandRadiusAt(a);
      // Shape lives in XY; rotating -90° about X maps shape y → world -z.
      if (i === 0) shape.moveTo(Math.cos(a) * r, -Math.sin(a) * r);
      else shape.lineTo(Math.cos(a) * r, -Math.sin(a) * r);
    });
    const g = new THREE.ShapeGeometry(shape, 1);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const map = useMemo(() => {
    const t = grassTexture().clone();
    t.repeat.set(0.22, 0.22);
    t.needsUpdate = true;
    return t;
  }, []);
  return (
    <mesh geometry={geom} receiveShadow>
      <meshStandardMaterial map={map} color="#9bcf88" roughness={0.95} />
    </mesh>
  );
}

/** Soft darker/lighter lawn patches so the meadow isn't one flat colour. */
function MeadowPatches() {
  const items = useMemo<Inst[]>(() => {
    const rand = seeded(77);
    const out: Inst[] = [];
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2;
      const r = 10 + rand() * (islandRadiusAt(a) - beachWidthAt(a) - 13);
      out.push({ x: Math.cos(a) * r, y: 0.006, z: Math.sin(a) * r, rx: -Math.PI / 2, rz: rand() * 6, s: 4 + rand() * 5, sy: 0.6 + rand() * 0.5, color: rand() < 0.6 ? "#7fbf74" : "#d7f2b8" });
    }
    return out;
  }, []);
  return (
    <Instanced items={items}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={radialTexture()} transparent opacity={0.3} depthWrite={false} polygonOffset polygonOffsetFactor={-1} />
    </Instanced>
  );
}

function Cliffs() {
  const geom = useMemo(
    () =>
      ringStrip([
        { r: (a) => islandRadiusAt(a), y: () => 0, color: "#9fd48a" },
        { r: (a) => islandRadiusAt(a) + 0.06, y: () => -0.2, color: "#86c27a" },
        { r: (a) => islandRadiusAt(a) - 0.15, y: () => -0.5, color: "#e7bf9b" },
        { r: (a) => islandRadiusAt(a) - 0.6, y: () => -1.45, color: "#f1d1b0" },
        { r: (a) => islandRadiusAt(a) - 1.7, y: () => -2.65, color: "#e1b394" },
        { r: (a) => islandRadiusAt(a) - 3.4, y: () => -3.7, color: "#cf9c86" },
      ]),
    [],
  );
  return (
    <mesh geometry={geom} receiveShadow>
      <meshStandardMaterial vertexColors roughness={1} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Beach() {
  const geom = useMemo(
    () =>
      ringStrip(
        [
          { r: (a) => islandRadiusAt(a) - beachWidthAt(a) * 0.9, y: () => 0.025, color: "#f7e7c8" },
          { r: (a) => islandRadiusAt(a) - beachWidthAt(a) * 0.3, y: () => 0.03, color: "#f6e1bd" },
          { r: (a) => islandRadiusAt(a) + 0.15, y: (a) => (beachWidthAt(a) > 0.05 ? 0.02 : -0.05), color: "#f2d8af" },
          { r: (a) => islandRadiusAt(a) + 0.85 * beachWidthAt(a), y: (a) => (beachWidthAt(a) > 0.05 ? -1.7 : -0.6), color: "#d9bc92" },
        ],
        (a) => beachWidthAt(a) > 0.02,
      ),
    [],
  );
  const map = useMemo(() => {
    const t = sandTexture().clone();
    t.repeat.set(0.3, 0.3);
    t.needsUpdate = true;
    return t;
  }, []);
  // ringStrip doesn't emit UVs; project XZ as UV for the sand speckle.
  useMemo(() => {
    const p = geom.attributes.position;
    const uv: number[] = [];
    for (let i = 0; i < p.count; i++) uv.push(p.getX(i), p.getZ(i));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  }, [geom]);
  return (
    <mesh geometry={geom} receiveShadow>
      <meshStandardMaterial vertexColors map={map} roughness={1} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}

function Water({ lighting }: { lighting: LightingPreset }) {
  const foam = useRef<THREE.MeshBasicMaterial>(null);
  const water = useRef<THREE.MeshStandardMaterial>(null);
  const tmp = useMemo(() => new THREE.Color(), []);
  const ripples = useMemo(() => {
    const t = waterTexture().clone();
    t.repeat.set(26, 26);
    t.needsUpdate = true;
    return t;
  }, []);
  const shallows = useMemo(
    () =>
      ringStrip([
        { r: (a) => waterline(a) - 0.2, y: () => WATER_Y + 0.012, color: "#c9f6ee", alpha: 0.8 },
        { r: (a) => waterline(a) + 1.6, y: () => WATER_Y + 0.012, color: "#b2ecec", alpha: 0.45 },
        { r: (a) => waterline(a) + 4.2, y: () => WATER_Y + 0.012, color: "#a3e2ea", alpha: 0 },
      ]),
    [],
  );
  const foamGeom = useMemo(
    () =>
      ringStrip([
        { r: (a) => waterline(a) - 0.08, y: () => WATER_Y + 0.02, color: "#ffffff", alpha: 0.95 },
        { r: (a) => waterline(a) + 0.12, y: () => WATER_Y + 0.02, color: "#ffffff", alpha: 0.75 },
        { r: (a) => waterline(a) + 0.5, y: () => WATER_Y + 0.02, color: "#ffffff", alpha: 0 },
      ]),
    [],
  );
  useFrame(({ clock }, dt) => {
    if (foam.current) foam.current.opacity = 0.55 + Math.sin(clock.elapsedTime * 1.3) * 0.25;
    ripples.offset.set(clock.elapsedTime * 0.004, clock.elapsedTime * 0.0025);
    // The sea picks up the sky's colour (a cheap stand-in for reflections).
    if (water.current) water.current.emissive.lerp(tmp.set(lighting.skyTop).lerp(new THREE.Color(lighting.skyBottom), 0.35), Math.min(1, dt * 2));
  });
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_Y, 0]} receiveShadow>
        <circleGeometry args={[220, 64]} />
        <meshStandardMaterial ref={water} map={ripples} color="#6cc3dc" emissive="#62b2f6" emissiveIntensity={0.26} roughness={0.18} metalness={0.05} />
      </mesh>
      <mesh geometry={shallows}>
        <meshBasicMaterial vertexColors transparent depthWrite={false} />
      </mesh>
      <mesh geometry={foamGeom}>
        <meshBasicMaterial ref={foam} vertexColors transparent depthWrite={false} />
      </mesh>
      <Sparkles count={60} scale={[80, 0.3, 80]} position={[0, WATER_Y + 0.25, 0]} size={3} speed={0.25} color="#ffffff" opacity={0.6} />
    </group>
  );
}

export function Terrain({ lighting }: { lighting: LightingPreset }) {
  return (
    <group>
      <Water lighting={lighting} />
      <Cliffs />
      <GrassTop />
      <MeadowPatches />
      <Beach />
    </group>
  );
}
