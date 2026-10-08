import { useMemo } from "react";
import * as THREE from "three";
import type { Composition, Placement, TreePlacement } from "./composition";
import { Instanced, type Inst } from "./instancing";
import { radialTexture } from "./textures";

function shade(hex: string, t: number): string {
  const c = new THREE.Color(hex);
  if (t > 0) c.lerp(new THREE.Color("#ffffff"), t);
  else c.lerp(new THREE.Color("#3d4a5c"), -t);
  return `#${c.getHexString()}`;
}

function rotated(ox: number, oz: number, r: number): [number, number] {
  return [ox * Math.cos(r) + oz * Math.sin(r), -ox * Math.sin(r) + oz * Math.cos(r)];
}

interface Parts {
  trunks: Inst[];
  blobs: Inst[];
  cones: Inst[];
  shadows: Inst[];
}

function treeParts(trees: TreePlacement[], bushes: Placement[]): Parts {
  const p: Parts = { trunks: [], blobs: [], cones: [], shadows: [] };
  const blob = (t: Placement, ox: number, oy: number, oz: number, r: number, color: string, sy = 1) => {
    const [x, z] = rotated(ox * t.s, oz * t.s, t.rot);
    p.blobs.push({ x: t.x + x, y: oy * t.s, z: t.z + z, ry: t.rot, s: r * t.s, sy, color });
  };
  for (const t of trees) {
    p.shadows.push({ x: t.x, y: 0.012, z: t.z, rx: -Math.PI / 2, s: 2.7 * t.s });
    switch (t.kind) {
      case "round":
        p.trunks.push({ x: t.x, y: 0.65 * t.s, z: t.z, s: t.s, sy: 1.3, color: "#b58a6c" });
        blob(t, 0, 1.78, 0, 0.95, t.color);
        blob(t, 0.58, 1.4, 0.25, 0.62, shade(t.color, -0.12));
        blob(t, -0.38, 2.2, -0.2, 0.6, shade(t.color, 0.14));
        blob(t, -0.5, 1.45, 0.35, 0.5, shade(t.color, -0.05));
        break;
      case "blossom":
        p.trunks.push({ x: t.x, y: 0.6 * t.s, z: t.z, s: t.s, sy: 1.2, color: "#a7806b" });
        blob(t, 0, 1.45, 0, 1.1, t.color, 0.55);
        blob(t, 0.1, 1.95, 0.05, 0.82, shade(t.color, 0.1), 0.6);
        blob(t, 0, 2.38, 0, 0.55, shade(t.color, 0.22), 0.7);
        blob(t, 0.7, 1.35, -0.4, 0.42, shade(t.color, -0.06));
        break;
      case "poplar":
        p.trunks.push({ x: t.x, y: 0.35 * t.s, z: t.z, s: t.s * 0.8, sy: 0.7, color: "#b58a6c" });
        blob(t, 0, 2.0, 0, 0.72, t.color, 2.0);
        blob(t, 0.12, 2.9, 0.1, 0.42, shade(t.color, 0.15), 1.6);
        break;
      case "pine":
        p.trunks.push({ x: t.x, y: 0.4 * t.s, z: t.z, s: t.s * 0.9, sy: 0.8, color: "#9e765e" });
        p.cones.push({ x: t.x, y: 1.25 * t.s, z: t.z, ry: t.rot, s: t.s, color: shade(t.color, -0.06) });
        p.cones.push({ x: t.x, y: 1.95 * t.s, z: t.z, ry: t.rot + 0.4, s: t.s * 0.78, color: t.color });
        p.cones.push({ x: t.x, y: 2.55 * t.s, z: t.z, ry: t.rot + 0.8, s: t.s * 0.54, color: shade(t.color, 0.12) });
        break;
    }
  }
  for (const b of bushes) {
    p.shadows.push({ x: b.x, y: 0.012, z: b.z, rx: -Math.PI / 2, s: 1.6 * b.s });
    blob(b, 0, 0.36, 0, 0.5, b.color);
    blob(b, 0.42, 0.28, 0.1, 0.38, shade(b.color, -0.1));
    blob(b, -0.36, 0.27, -0.06, 0.36, shade(b.color, 0.1));
  }
  return p;
}

export function Trees({ trees, bushes }: { trees: TreePlacement[]; bushes: Placement[] }) {
  const parts = useMemo(() => treeParts(trees, bushes), [trees, bushes]);
  return (
    <group>
      <Instanced items={parts.shadows}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={radialTexture()} color="#2e3a2e" transparent opacity={0.28} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
      </Instanced>
      <Instanced items={parts.trunks} castShadow>
        <cylinderGeometry args={[0.12, 0.19, 1, 7]} />
        <meshStandardMaterial roughness={0.9} />
      </Instanced>
      <Instanced items={parts.blobs} castShadow receiveShadow>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial roughness={0.85} flatShading />
      </Instanced>
      <Instanced items={parts.cones} castShadow receiveShadow>
        <coneGeometry args={[1, 1.3, 8]} />
        <meshStandardMaterial roughness={0.85} flatShading />
      </Instanced>
    </group>
  );
}

export function Mushrooms({ mushrooms }: { mushrooms: Placement[] }) {
  const stems = useMemo<Inst[]>(() => mushrooms.map((m) => ({ x: m.x, y: 0.5 * m.s, z: m.z, s: m.s, color: "#fff6ea" })), [mushrooms]);
  const caps = useMemo<Inst[]>(() => mushrooms.map((m) => ({ x: m.x, y: 1.0 * m.s, z: m.z, ry: m.rot, s: m.s, sy: 0.62, color: m.color })), [mushrooms]);
  const dots = useMemo<Inst[]>(
    () =>
      mushrooms.flatMap((m) =>
        [0, 1, 2, 3].map((i) => {
          const a = m.rot + (i / 4) * Math.PI * 2;
          return { x: m.x + Math.cos(a) * 0.55 * m.s, y: 1.22 * m.s, z: m.z + Math.sin(a) * 0.55 * m.s, s: 0.12 * m.s, color: "#ffffff" };
        }),
      ),
    [mushrooms],
  );
  return (
    <group>
      <Instanced items={stems} castShadow>
        <cylinderGeometry args={[0.2, 0.28, 1, 10]} />
        <meshStandardMaterial roughness={0.8} />
      </Instanced>
      <Instanced items={caps} castShadow>
        <sphereGeometry args={[0.95, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial roughness={0.55} />
      </Instanced>
      <Instanced items={dots}>
        <sphereGeometry args={[1, 6, 5]} />
        <meshStandardMaterial roughness={0.6} />
      </Instanced>
    </group>
  );
}

export function Rocks({ rocks }: { rocks: Placement[] }) {
  const items = useMemo<Inst[]>(() => rocks.map((r) => ({ x: r.x, y: r.s * 0.3, z: r.z, ry: r.rot, rx: r.rot * 0.3, s: r.s, sx: 1.3, sy: 0.75, color: r.color })), [rocks]);
  return (
    <Instanced items={items} castShadow receiveShadow>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={1} flatShading />
    </Instanced>
  );
}

/** Rows of hyacinths: a stem, a floret spike and a leaf tuft each. */
export function HyacinthField({ hyacinths }: { hyacinths: Placement[] }) {
  const spikes = useMemo<Inst[]>(() => hyacinths.map((h) => ({ x: h.x, y: 0.5 * h.s, z: h.z, ry: h.rot, s: h.s, color: h.color })), [hyacinths]);
  const stems = useMemo<Inst[]>(() => hyacinths.map((h) => ({ x: h.x, y: 0.17 * h.s, z: h.z, s: h.s, color: "#6fb879" })), [hyacinths]);
  const leaves = useMemo<Inst[]>(() => hyacinths.map((h) => ({ x: h.x, y: 0.1 * h.s, z: h.z, ry: h.rot, s: h.s, color: "#86c98a" })), [hyacinths]);
  const spikeGeom = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(0.1, 0.24, 0.1);
    return g;
  }, []);
  return (
    <group>
      <Instanced items={leaves}>
        <coneGeometry args={[0.14, 0.26, 5]} />
        <meshStandardMaterial roughness={0.9} flatShading />
      </Instanced>
      <Instanced items={stems}>
        <cylinderGeometry args={[0.018, 0.022, 0.34, 4]} />
        <meshStandardMaterial roughness={0.9} />
      </Instanced>
      <Instanced items={spikes} castShadow>
        <primitive object={spikeGeom} attach="geometry" />
        <meshStandardMaterial roughness={0.7} flatShading />
      </Instanced>
    </group>
  );
}

export function Flora({ composition }: { composition: Composition }) {
  return (
    <group>
      <Trees trees={composition.trees} bushes={composition.bushes} />
      <Mushrooms mushrooms={composition.mushrooms} />
      <Rocks rocks={composition.rocks} />
      <HyacinthField hyacinths={composition.hyacinths} />
    </group>
  );
}
