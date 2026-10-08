import { useMemo } from "react";
import * as THREE from "three";
import type { Composition, Placement, TreePlacement } from "./composition";
import { Instanced, type Inst } from "./instancing";
import { TOKENS } from "./palette";
import { radialTexture } from "./textures";

function shade(hex: string, t: number): string {
  const c = new THREE.Color(hex);
  if (t > 0) c.lerp(new THREE.Color("#ffffff"), t);
  else c.lerp(new THREE.Color("#4d3a55"), -t); // shade toward plum, not grey
  return `#${c.getHexString()}`;
}

function rotated(ox: number, oz: number, r: number): [number, number] {
  return [ox * Math.cos(r) + oz * Math.sin(r), -ox * Math.sin(r) + oz * Math.cos(r)];
}

interface Parts {
  trunks: Inst[];
  blobs: Inst[];
  shadows: Inst[];
}

function treeParts(trees: TreePlacement[], bushes: Placement[]): Parts {
  const p: Parts = { trunks: [], blobs: [], shadows: [] };
  const blob = (t: Placement, ox: number, oy: number, oz: number, r: number, color: string, sy = 1) => {
    const [x, z] = rotated(ox * t.s, oz * t.s, t.rot);
    p.blobs.push({ x: t.x + x, y: oy * t.s, z: t.z + z, ry: t.rot, s: r * t.s, sy, color });
  };
  for (const t of trees) {
    p.shadows.push({ x: t.x, y: 0.012, z: t.z, rx: -Math.PI / 2, s: 2.7 * t.s });
    switch (t.kind) {
      case "round":
        // A plump lollipop tree: one big soft crown and a small top tuft.
        p.trunks.push({ x: t.x, y: 0.65 * t.s, z: t.z, s: t.s, sy: 1.3, color: TOKENS.foliage.trunk });
        blob(t, 0, 1.85, 0, 1.0, t.color);
        blob(t, 0.25, 2.55, 0.1, 0.48, shade(t.color, 0.12));
        break;
      case "blossom":
        // Sakura: three soft stacked tiers.
        p.trunks.push({ x: t.x, y: 0.6 * t.s, z: t.z, s: t.s, sy: 1.2, color: TOKENS.foliage.trunkBlossom });
        blob(t, 0, 1.5, 0, 1.12, t.color, 0.58);
        blob(t, 0.05, 2.02, 0.03, 0.82, shade(t.color, 0.1), 0.62);
        blob(t, 0, 2.42, 0, 0.5, shade(t.color, 0.2), 0.75);
        break;
    }
  }
  for (const b of bushes) {
    p.shadows.push({ x: b.x, y: 0.012, z: b.z, rx: -Math.PI / 2, s: 1.6 * b.s });
    blob(b, 0, 0.38, 0, 0.55, b.color);
    blob(b, 0.45, 0.28, 0.1, 0.36, shade(b.color, 0.08));
  }
  return p;
}

export function Trees({ trees, bushes }: { trees: TreePlacement[]; bushes: Placement[] }) {
  const parts = useMemo(() => treeParts(trees, bushes), [trees, bushes]);
  return (
    <group>
      <Instanced items={parts.shadows}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={radialTexture()} color="#4a3350" transparent opacity={0.18} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
      </Instanced>
      <Instanced items={parts.trunks} castShadow>
        <cylinderGeometry args={[0.12, 0.19, 1, 7]} />
        <meshStandardMaterial roughness={0.9} />
      </Instanced>
      <Instanced items={parts.blobs} castShadow receiveShadow>
        <icosahedronGeometry args={[1, 3]} />
        <meshStandardMaterial roughness={0.75} />
      </Instanced>
    </group>
  );
}

/** Rows of hyacinths: a stem, a floret spike and a leaf tuft each. */
export function HyacinthField({ hyacinths }: { hyacinths: Placement[] }) {
  const spikes = useMemo<Inst[]>(() => hyacinths.map((h) => ({ x: h.x, y: 0.5 * h.s, z: h.z, ry: h.rot, s: h.s, color: h.color })), [hyacinths]);
  const stems = useMemo<Inst[]>(() => hyacinths.map((h) => ({ x: h.x, y: 0.17 * h.s, z: h.z, s: h.s, color: TOKENS.foliage.leaf })), [hyacinths]);
  const leaves = useMemo<Inst[]>(() => hyacinths.map((h) => ({ x: h.x, y: 0.1 * h.s, z: h.z, ry: h.rot, s: h.s, color: TOKENS.foliage.bushes[0] })), [hyacinths]);
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

/** Soft pink petal carpets under the sakura and in meadow drifts. */
export function PetalCarpets({ carpets }: { carpets: Placement[] }) {
  const items = useMemo<Inst[]>(() => carpets.map((p) => ({ x: p.x, y: 0.009, z: p.z, rx: -Math.PI / 2, rz: p.rot, s: p.s, sy: 0.75, color: p.color })), [carpets]);
  return (
    <Instanced items={items}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={radialTexture()} transparent opacity={0.55} depthWrite={false} polygonOffset polygonOffsetFactor={-1} />
    </Instanced>
  );
}

export function Flora({ composition }: { composition: Composition }) {
  return (
    <group>
      <PetalCarpets carpets={composition.petalCarpets} />
      <Trees trees={composition.trees} bushes={composition.bushes} />
      <HyacinthField hyacinths={composition.hyacinths} />
    </group>
  );
}
