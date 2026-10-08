import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BuildingProps } from "../../theme-engine/types";
import {
  Builder,
  IRON,
  TIMBER,
  TRIM,
  chimney,
  coneRoof,
  doorOn,
  gableRoof,
  shade,
  signPost,
  timberFace,
  wallLantern,
  windowOn,
  yard,
  yardGround,
  type BoxShell,
  type MatKey,
} from "./architecture";
import { brickTexture, grassTexture, plasterTexture, posterTexture, roofTileTexture, signTexture, stoneTexture, woodTexture } from "./textures";

// ───────────── shared materials ─────────────

let shared: Partial<Record<MatKey, THREE.Material>> | null = null;
function sharedMaterials(): Partial<Record<MatKey, THREE.Material>> {
  if (shared) return shared;
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...p });
  shared = {
    plaster: std({ map: plasterTexture(), roughness: 0.92 }),
    stone: std({ map: stoneTexture(), roughness: 0.95 }),
    brick: std({ map: brickTexture(), roughness: 0.92 }),
    roof: std({ map: roofTileTexture(), roughness: 0.78 }),
    wood: std({ map: woodTexture(), roughness: 0.85 }),
    solid: std({ roughness: 0.7 }),
    foliage: std({ roughness: 0.9, flatShading: true }),
    metal: std({ roughness: 0.4, metalness: 0.45 }),
    grass: std({ map: grassTexture(), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }),
  };
  return shared;
}

/** Per-building window glass (lit by night and by work inside) and lanterns (lit by night). */
function useLitMaterials(glow: number, activity: number) {
  const glass = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, emissive: new THREE.Color("#ffc56b"), emissiveIntensity: 0, roughness: 0.15, metalness: 0.1 }), []);
  const lamp = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, emissive: new THREE.Color("#ffd27a"), emissiveIntensity: 0.3, roughness: 0.3 }), []);
  useFrame((_, dt) => {
    const k = Math.min(1, dt * 2);
    const target = Math.max(glow * 1.5, activity ? 0.55 : 0);
    glass.emissiveIntensity += (target - glass.emissiveIntensity) * k;
    lamp.emissiveIntensity += (0.25 + glow * 2.4 - lamp.emissiveIntensity) * k;
  });
  return { glass, glow: lamp };
}

type BuiltParts = { mat: MatKey; geometry: THREE.BufferGeometry }[];

/** Renders a Builder's merged geometries with the shared materials. */
function Built({ parts, glass, glow }: { parts: { mat: MatKey; geometry: THREE.BufferGeometry }[]; glass: THREE.Material; glow: THREE.Material }) {
  const mats = sharedMaterials();
  return (
    <group>
      {parts.map(({ mat, geometry }) => (
        <mesh key={mat} geometry={geometry} material={mat === "glass" ? glass : mat === "glow" ? glow : mats[mat]} castShadow={mat !== "grass" && mat !== "glass"} receiveShadow />
      ))}
    </group>
  );
}

function Sign({ at, text, icon, color }: { at: { pos: [number, number, number]; rotY: number }; text: string; icon: string; color: string }) {
  const map = useMemo(() => signTexture(text, icon, color), [text, icon, color]);
  // Two single-sided faces back to back, so the name reads correctly from either side.
  return (
    <group position={at.pos} rotation={[0, at.rotY, 0]}>
      {[0, Math.PI].map((r) => (
        <mesh key={r} rotation={[0, r, 0]} position={[0, 0, r ? -0.01 : 0.01]} castShadow={!r}>
          <planeGeometry args={[1.5, 1.5]} />
          <meshStandardMaterial map={map} alphaTest={0.5} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function Poster({ position, rotY, seed, palette, size = [0.6, 0.75] }: { position: [number, number, number]; rotY: number; seed: number; palette: string[]; size?: [number, number] }) {
  const map = useMemo(() => posterTexture(seed, palette), [seed, palette]);
  return (
    <mesh position={position} rotation={[0, rotY, 0]}>
      <planeGeometry args={size} />
      <meshStandardMaterial map={map} roughness={0.9} />
    </mesh>
  );
}

function Smoke({ active }: { active: boolean }) {
  const puffs = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = puffs.current;
    if (!g) return;
    g.visible = active;
    g.children.forEach((c, i) => {
      const t = (clock.elapsedTime * 0.5 + i / g.children.length) % 1;
      c.position.set(Math.sin(t * 6 + i) * 0.15, t * 1.6, 0);
      c.scale.setScalar(0.15 + t * 0.35);
      ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.8 * (1 - t);
    });
  });
  return (
    <group ref={puffs}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.6} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

const PINKS = ["#ff9fc4", "#fff1a8", "#ffffff"];
const LILACS = ["#c9b4ff", "#ffd1e3", "#9fd8ff"];

// ───────────── Town Hall (hq) ─────────────

function townHall(name: string) {
  const b = new Builder();
  yardGround(b, {});
  yard(b, { doorZ: 1.75, flowers: PINKS });
  const ground: BoxShell = { W: 4.6, D: 3.2 };
  const upper: BoxShell = { W: 4.76, D: 3.34 };
  b.box("stone", "#efe6df", [5.0, 0.3, 3.6], [0, 0.15, 0], undefined, 0.9);
  b.box("stone", "#f4ece6", [4.6, 1.35, 3.2], [0, 0.975, 0], undefined, 0.9);
  b.box("plaster", "#ffd6e5", [4.76, 1.3, 3.34], [0, 2.3, 0], undefined, 1.2);
  b.box("wood", TIMBER, [4.9, 0.14, 3.48], [0, 1.66, 0]);
  for (const f of ["front", "back"] as const) timberFace(b, upper, f, 1.65, 1.3, { posts: [-2.32, -0.75, 0.75, 2.32], braces: true });
  for (const f of ["left", "right"] as const) timberFace(b, upper, f, 1.65, 1.3, { posts: [-1.6, 1.6], braces: true });
  gableRoof(b, { W: 4.76, D: 3.34, y: 2.95, pitch: 1.75, color: "#b9a2ff", wall: "#ffd6e5", gableTimber: false });
  // clock in the front gable (lit at night)
  b.add("glow", "#fffaf0", new THREE.CylinderGeometry(0.44, 0.44, 0.06, 28), { pos: [0, 3.62, 1.7], rot: [Math.PI / 2, 0, 0] });
  b.add("solid", "#b9a2ff", new THREE.TorusGeometry(0.46, 0.05, 6, 28), { pos: [0, 3.62, 1.72] });
  b.box("solid", "#5b4a6e", [0.04, 0.3, 0.02], [0.06, 3.72, 1.75], [0, 0, -0.5]);
  b.box("solid", "#5b4a6e", [0.04, 0.2, 0.02], [-0.06, 3.66, 1.75], [0, 0, 1.0]);
  doorOn(b, ground, "front", 0, { w: 1.1, h: 1.35, color: "#e889b0", double: true });
  b.box("stone", "#e9dfd6", [2.0, 0.12, 0.5], [0, 0.06, 2.15], undefined, 0.5);
  for (const u of [-1.55, 1.55]) windowOn(b, ground, "front", u, 0.95, { shutter: "#c9b6ff", flowers: PINKS });
  for (const u of [-1.5, 0, 1.5]) windowOn(b, upper, "front", u, 2.3, { w: 0.55, h: 0.7, flowers: u === 0 ? undefined : LILACS });
  for (const f of ["left", "right"] as const) {
    windowOn(b, upper, f, 0, 2.3, { w: 0.55, h: 0.7 });
    windowOn(b, ground, f, 0, 0.95, { w: 0.55, h: 0.7, shutter: "#c9b6ff" });
  }
  for (const u of [-0.85, 0.85]) wallLantern(b, ground, "front", u, 1.25);
  // banners between the upper windows
  for (const u of [-0.75, 0.75]) {
    b.box("solid", "#ff8fb8", [0.36, 0.9, 0.03], [u, 2.25, 1.71]);
    b.add("solid", "#ff8fb8", new THREE.ConeGeometry(0.255, 0.22, 3), { pos: [u, 1.73, 1.71], rot: [0, 0, Math.PI], scale: [1, 1, 0.12] });
    b.box("metal", "#ffd86b", [0.46, 0.05, 0.05], [u, 2.72, 1.72]);
  }
  // towers
  for (const x of [-2.15, 2.15]) {
    b.cyl("stone", "#efe6df", 0.8, 0.86, 1.65, [x, 0.82, -1.1], { seg: 20, uvUnit: 0.9 });
    b.cyl("plaster", "#fff1e8", 0.74, 0.74, 2.1, [x, 2.7, -1.1], { seg: 20, uvUnit: 1.2 });
    b.cyl("wood", TIMBER, 0.78, 0.78, 0.12, [x, 1.68, -1.1], { seg: 20 });
    b.cyl("wood", TIMBER, 0.78, 0.78, 0.12, [x, 3.72, -1.1], { seg: 20 });
    coneRoof(b, "#a993f0", 1.0, 1.75, [x, 4.6, -1.1]);
    b.box("solid", TRIM, [0.4, 0.58, 0.06], [x, 2.75, -1.1 + 0.74]);
    b.box("glass", "#cfe9ff", [0.3, 0.48, 0.04], [x, 2.75, -1.1 + 0.77]);
  }
  // task board in the yard: cork board with pinned notes under a little roof
  {
    const bx = -2.25;
    const bz = 1.95;
    const r = 0.35;
    const at = (u: number, v: number, out = 0): [number, number, number] => [bx + u * Math.cos(r) + out * Math.sin(r), v, bz - u * Math.sin(r) + out * Math.cos(r)];
    for (const u of [-0.55, 0.55]) b.box("wood", TIMBER, [0.1, 1.6, 0.1], at(u, 0.8), [0, r, 0]);
    b.box("wood", "#e7c39a", [1.2, 0.8, 0.06], at(0, 1.05), [0, r, 0]);
    const notes = ["#fffaf0", "#ffe3ef", "#e3f4ff", "#fff6c9", "#e9ffe3"];
    notes.forEach((c, i) => b.box("solid", c, [0.24, 0.2, 0.01], at(-0.42 + i * 0.21, 1.1 + (i % 2) * 0.17 - 0.08, 0.04), [0, r, (i % 3) * 0.08 - 0.08]));
    b.add("roof", "#b9a2ff", new THREE.BoxGeometry(1.45, 0.06, 0.4), { pos: at(0, 1.62, 0.05), rot: [0.35, r, 0], uv: [2, 0.6] });
  }
  const sign = signPost(b, 2.25, 2.05, -0.35);
  return { parts: b.build(), sign, name };
}

function Flag() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = Math.sin(clock.elapsedTime * 2.2) * 0.35;
  });
  return (
    <group position={[2.15, 5.45, -1.1]}>
      <mesh>
        <cylinderGeometry args={[0.03, 0.03, 0.9, 6]} />
        <meshStandardMaterial color="#9a86c9" />
      </mesh>
      <mesh ref={ref} position={[0.28, 0.25, 0]}>
        <boxGeometry args={[0.55, 0.32, 0.02]} />
        <meshStandardMaterial color="#ff8fb8" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ───────────── Observatory (research) ─────────────

function roundWindow(b: Builder, a: number, r: number, y: number, size = 0.26) {
  const pos: [number, number, number] = [Math.sin(a) * r, y, Math.cos(a) * r];
  b.add("solid", TRIM, new THREE.TorusGeometry(size, 0.05, 6, 18), { pos, rot: [0, a, 0] });
  b.add("glass", "#cfe9ff", new THREE.CircleGeometry(size, 18), { pos: [pos[0] - Math.sin(a) * 0.01, y, pos[2] - Math.cos(a) * 0.01], rot: [0, a, 0] });
}

function observatory(name: string) {
  const b = new Builder();
  yardGround(b, {});
  yard(b, { doorZ: 2.05, flowers: LILACS });
  b.cyl("stone", "#efe7e2", 2.05, 2.15, 1.7, [0, 0.85, 0], { seg: 32, uvUnit: 0.9 });
  // balcony
  b.cyl("wood", "#d8b49a", 2.35, 2.35, 0.12, [0, 1.76, 0], { seg: 32 });
  for (let a = 0; a < Math.PI * 2; a += 0.3) {
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.2) continue;
    b.box("wood", TRIM, [0.05, 0.48, 0.05], [Math.sin(a) * 2.27, 2.06, Math.cos(a) * 2.27]);
  }
  b.add("wood", TRIM, new THREE.TorusGeometry(2.27, 0.04, 6, 48), { pos: [0, 2.3, 0], rot: [Math.PI / 2, 0, 0] });
  // upper ring: plaster with timber posts
  b.cyl("plaster", "#cdeee3", 1.72, 1.72, 1.35, [0, 2.5, 0], { seg: 32, uvUnit: 1.2 });
  b.cyl("wood", TIMBER, 1.76, 1.76, 0.12, [0, 1.88, 0], { seg: 32 });
  b.cyl("wood", TIMBER, 1.76, 1.76, 0.12, [0, 3.12, 0], { seg: 32 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.31;
    b.box("wood", TIMBER, [0.1, 1.3, 0.1], [Math.sin(a) * 1.75, 2.5, Math.cos(a) * 1.75], [0, a, 0]);
  }
  for (const a of [-0.62, 0.62, Math.PI - 0.6, Math.PI + 0.6]) roundWindow(b, a, 1.75, 2.5, 0.25);
  for (const a of [-1.0, 1.0]) roundWindow(b, a, 2.08, 1.0, 0.22);
  doorOn(b, { W: 4.2, D: 4.2 }, "front", 0, { w: 0.85, h: 1.15, color: "#7fc8b4" });
  wallLantern(b, { W: 4.2, D: 4.2 }, "front", 0.75, 1.0);
  // tripod telescope in the yard
  {
    const [tx, tz] = [2.0, 1.5];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      b.beam("wood", TIMBER, [tx + Math.cos(a) * 0.38, 0, tz + Math.sin(a) * 0.38], [tx, 1.05, tz], 0.05);
    }
    b.add("metal", "#8a7dd8", new THREE.CylinderGeometry(0.08, 0.12, 0.95, 12), { pos: [tx - 0.05, 1.25, tz + 0.1], rot: [-0.9, 0.4, 0] });
    b.add("metal", "#ffd86b", new THREE.CylinderGeometry(0.13, 0.13, 0.08, 12), { pos: [tx - 0.17, 1.55, tz + 0.4], rot: [-0.9, 0.4, 0] });
  }
  // globe on a stand, and a stack of books by the door
  {
    const [gx, gz] = [-2.05, 1.55];
    b.box("wood", TIMBER, [0.08, 0.7, 0.08], [gx, 0.35, gz]);
    b.cyl("wood", TIMBER, 0.28, 0.32, 0.06, [gx, 0.03, gz]);
    b.sphere("solid", "#8fd3e8", 0.34, [gx, 0.98, gz], [1, 1, 1], 2);
    b.sphere("foliage", "#9fd68f", 0.16, [gx + 0.18, 1.08, gz + 0.18], [1, 0.5, 1], 0);
    b.add("metal", "#ffd86b", new THREE.TorusGeometry(0.4, 0.02, 6, 24), { pos: [gx, 0.98, gz], rot: [0, 0.6, 0.4] });
    ["#ff9fc4", "#9fd8ff", "#fff1a8", "#c9b4ff"].forEach((c, i) => b.box("solid", c, [0.42 - i * 0.04, 0.09, 0.3], [-0.85, 0.05 + i * 0.09, 2.45], [0, i * 0.3, 0]));
  }
  const sign = signPost(b, -2.25, 2.25, 0.35);
  // the rotating dome is built separately so it can turn
  const d = new Builder();
  d.sphere("metal", "#9dbcf0", 1.74, [0, 0, 0], [1, 1, 1], 3);
  for (let i = 0; i < 8; i++) d.add("metal", "#ffd86b", new THREE.TorusGeometry(1.75, 0.035, 6, 24, Math.PI / 2), { rot: [0, (i / 8) * Math.PI * 2, Math.PI / 2] });
  d.box("solid", "#3f3a63", [0.42, 1.75, 0.2], [0, 0.95, 1.38], [-0.62, 0, 0]);
  d.add("metal", "#8a7dd8", new THREE.CylinderGeometry(0.22, 0.3, 1.9, 16), { pos: [0, 0.8, 0.95], rot: [-0.95, 0, 0] });
  d.add("metal", "#ffd86b", new THREE.CylinderGeometry(0.31, 0.31, 0.12, 16), { pos: [0, 1.5, 1.45], rot: [-0.95, 0, 0] });
  d.add("glow", "#ffe58a", new THREE.OctahedronGeometry(0.24, 0), { pos: [0, 1.95, 0] });
  // the lower half of the sphere is hidden inside the ring; keep only what shows
  return { parts: b.build(), dome: d.build(), sign, name };
}

function Orbiter() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime * 1.6;
    ref.current.position.set(Math.cos(t) * 2.6, 5.9 + Math.sin(t * 2) * 0.2, Math.sin(t) * 2.6);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.18, 12, 10]} />
      <meshStandardMaterial color="#fff2b3" emissive="#ffe27a" emissiveIntensity={1.2} />
    </mesh>
  );
}

function Spin({ speed, children, position }: { speed: number; children: ReactNode; position: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = speed ? clock.elapsedTime * speed : Math.sin(clock.elapsedTime * 0.2) * 0.4;
  });
  return (
    <group ref={ref} position={position}>
      {children}
    </group>
  );
}

// ───────────── Inkwell Studio (studio) ─────────────

function cottage(b: Builder, o: { W: number; D: number; H: number; wall: string; roof: string; shutter: string; door: string; ridge: "x" | "z"; flowers: string[]; pitch?: number }) {
  const s: BoxShell = { W: o.W, D: o.D };
  b.box("stone", "#ece3db", [o.W + 0.3, 0.32, o.D + 0.3], [0, 0.16, 0], undefined, 0.9);
  b.box("plaster", o.wall, [o.W, o.H, o.D], [0, 0.32 + o.H / 2, 0], undefined, 1.2);
  const third = o.W / 2 - 0.06;
  for (const f of ["front", "back"] as const) timberFace(b, s, f, 0.32, o.H, { posts: [-third, -o.W * 0.15, o.W * 0.15, third], braces: true, mid: true });
  for (const f of ["left", "right"] as const) timberFace(b, s, f, 0.32, o.H, { posts: [-o.D / 2 + 0.06, 0, o.D / 2 - 0.06], braces: true, mid: true });
  gableRoof(b, { W: o.W, D: o.D, y: 0.32 + o.H, pitch: o.pitch ?? 1.55, color: o.roof, wall: o.wall, ridge: o.ridge, gableTimber: true });
  doorOn(b, s, "front", 0, { color: o.door });
  for (const u of [-o.W * 0.32, o.W * 0.32]) windowOn(b, s, "front", u, 1.35, { shutter: o.shutter, flowers: o.flowers });
  for (const f of ["left", "right", "back"] as const) windowOn(b, s, f, 0, 1.4, { shutter: o.shutter, w: 0.55, h: 0.7 });
  wallLantern(b, s, "front", 0.72, 1.2);
  return s;
}

function inkStudio(name: string) {
  const b = new Builder();
  yardGround(b, {});
  yard(b, { doorZ: 1.5, flowers: PINKS });
  const s = cottage(b, { W: 4.0, D: 3.0, H: 2.2, wall: "#fff0c4", roof: "#ff9e9e", shutter: "#9fd8c4", door: "#7fc8b4", ridge: "x", flowers: PINKS });
  chimney(b, 1.15, -0.55, 2.4, 1.9);
  // striped awning over the door
  for (let i = 0; i < 6; i++) b.box("solid", i % 2 ? "#ffffff" : "#ff9fb8", [0.2, 0.04, 0.62], [-0.5 + i * 0.2, 1.98, 1.78], [0.42, 0, 0]);
  // writing desk with a typewriter and notebooks
  {
    const [dx, dz, r] = [2.45, 0.0, -Math.PI / 2];
    const at = (u: number, v: number, w: number): [number, number, number] => [dx + u * Math.cos(r) + w * Math.sin(r), v, dz - u * Math.sin(r) + w * Math.cos(r)];
    b.box("wood", "#d9a37a", [1.0, 0.06, 0.55], at(0, 0.72, 0), [0, r, 0]);
    for (const [u, w] of [
      [-0.43, -0.22],
      [0.43, -0.22],
      [-0.43, 0.22],
      [0.43, 0.22],
    ])
      b.box("wood", "#c48f6e", [0.06, 0.72, 0.06], at(u, 0.36, w), [0, r, 0]);
    b.box("solid", "#9fd8c4", [0.42, 0.14, 0.3], at(0.12, 0.82, 0), [0, r, 0]);
    b.box("solid", "#5b5f7a", [0.36, 0.03, 0.14], at(0.12, 0.9, 0.06), [0.3, r, 0]);
    b.box("solid", "#fffaf0", [0.3, 0.24, 0.01], at(0.12, 1.0, -0.1), [-0.2, r, 0]);
    ["#ff9fc4", "#c9b4ff"].forEach((c, i) => b.box("solid", c, [0.24, 0.04, 0.3], at(-0.3, 0.77 + i * 0.04, 0), [0, r + i * 0.2, 0]));
    b.cyl("wood", "#d9a37a", 0.2, 0.2, 0.45, at(0, 0.23, 0.55));
  }
  const sign = signPost(b, -2.25, 2.1, 0.35);
  return { parts: b.build(), sign, name, shell: s };
}

function Quill({ activity }: { activity: number }) {
  const quill = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (quill.current) quill.current.rotation.z = -0.35 + Math.sin(clock.elapsedTime * (activity ? 6 : 1.2)) * (activity ? 0.12 : 0.05);
  });
  return (
    <group position={[2.35, 0, 2.0]} scale={0.8}>
      <mesh castShadow position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.38, 0.45, 0.7, 20]} />
        <meshStandardMaterial color="#6f7fd8" roughness={0.3} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.72, 0]}>
        <cylinderGeometry args={[0.22, 0.3, 0.12, 16]} />
        <meshStandardMaterial color="#4b57b0" />
      </mesh>
      <group ref={quill} position={[0, 0.7, 0]}>
        <mesh castShadow position={[0, 1.1, 0]} scale={[0.32, 1.25, 0.08]}>
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0, 0.9, 0.05]} scale={[0.06, 1.3, 0.06]}>
          <sphereGeometry args={[1, 8, 8]} />
          <meshStandardMaterial color="#ffb3c7" />
        </mesh>
      </group>
    </group>
  );
}

// ───────────── Workshop (engineering) ─────────────

function workshop(name: string) {
  const b = new Builder();
  yardGround(b, {});
  yard(b, { doorZ: 1.62, flowers: ["#ffb38a", "#ffe08a", "#ff9fc4"] });
  const s: BoxShell = { W: 4.2, D: 3.2 };
  b.box("stone", "#ece3db", [4.5, 0.32, 3.5], [0, 0.16, 0], undefined, 0.9);
  b.box("brick", "#f7d3c6", [4.2, 2.3, 3.2], [0, 1.47, 0], undefined, 0.9);
  for (const x of [-1.05, 1.05]) gableRoof(b, { W: 2.1, D: 3.2, y: 2.62, pitch: 1.0, color: "#8fc9b8", wall: "#f7d3c6", cx: x, overhang: 0.22 });
  // big barn door with X braces
  b.box("wood", "#9fd8c4", [1.6, 1.85, 0.08], [-0.55, 1.25, 1.64]);
  b.beam("wood", shade("#9fd8c4", -0.3), [-1.3, 0.4, 1.7], [0.2, 2.1, 1.7], 0.09);
  b.beam("wood", shade("#9fd8c4", -0.3), [0.2, 0.4, 1.7], [-1.3, 2.1, 1.7], 0.09);
  b.box("wood", shade("#9fd8c4", -0.3), [1.7, 0.1, 0.1], [-0.55, 2.2, 1.7]);
  b.box("metal", IRON, [2.0, 0.06, 0.06], [-0.55, 2.3, 1.72]);
  windowOn(b, s, "front", 1.35, 1.1, { w: 0.6, h: 0.6, shutter: "#ffd27a" });
  for (const f of ["left", "right"] as const) for (const u of [-0.7, 0.7]) windowOn(b, s, f, u, 1.5, { w: 0.5, h: 0.6 });
  wallLantern(b, s, "front", 0.55, 1.7);
  b.cyl("brick", "#f2c4bf", 0.24, 0.28, 1.6, [-1.5, 3.4, -1.0], { uvUnit: 0.6 });
  // crates and a workbench with a little prototype robot
  [
    [2.35, 0.25, 1.6, 0.2],
    [2.6, 0.25, 0.95, -0.15],
    [2.45, 0.75, 1.35, 0.4],
  ].forEach(([x, y, z, r]) => {
    b.box("wood", "#d9a37a", [0.5, 0.5, 0.5], [x, y, z], [0, r, 0]);
    b.box("wood", shade("#d9a37a", -0.2), [0.52, 0.06, 0.52], [x, y + 0.18, z], [0, r, 0]);
  });
  {
    const [wx, wz] = [-2.35, 0.6];
    b.box("wood", "#c48f6e", [0.6, 0.08, 1.2], [wx, 0.78, wz]);
    for (const [x, z] of [
      [-0.24, -0.52],
      [0.24, -0.52],
      [-0.24, 0.52],
      [0.24, 0.52],
    ])
      b.box("wood", shade("#c48f6e", -0.15), [0.07, 0.78, 0.07], [wx + x, 0.39, wz + z]);
    b.box("metal", "#b9c2d6", [0.2, 0.16, 0.14], [wx, 0.9, wz - 0.4]);
    b.box("solid", "#ffd6e4", [0.26, 0.26, 0.2], [wx, 0.97, wz + 0.15]);
    b.box("solid", "#ffffff", [0.2, 0.16, 0.16], [wx, 1.18, wz + 0.15]);
    b.box("glow", "#9ff0c8", [0.12, 0.05, 0.02], [wx + 0.08, 1.2, wz + 0.15]);
    b.cyl("metal", IRON, 0.01, 0.01, 0.16, [wx, 1.33, wz + 0.15]);
    b.sphere("glow", "#ff9fc4", 0.04, [wx, 1.42, wz + 0.15], [1, 1, 1], 0);
  }
  // terminal by the door
  b.box("solid", "#b9a2ff", [0.5, 0.9, 0.4], [1.0, 0.45, 2.4]);
  b.box("glow", "#7cf0b0", [0.36, 0.3, 0.02], [1.0, 0.6, 2.61]);
  const sign = signPost(b, -2.25, 2.15, 0.35);
  return { parts: b.build(), sign, name };
}

function Gear({ radius, teeth, color, speed, position, rotation = [0, 0, 0] }: { radius: number; teeth: number; color: string; speed: number; position: [number, number, number]; rotation?: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.z += dt * speed;
  });
  return (
    <group position={position} rotation={rotation}>
      <group ref={ref}>
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[radius, radius, 0.12, 24]} />
          <meshStandardMaterial color={color} metalness={0.3} roughness={0.4} />
        </mesh>
        {Array.from({ length: teeth }, (_, i) => {
          const a = (i / teeth) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * radius, Math.sin(a) * radius, 0]} rotation={[0, 0, a]}>
              <boxGeometry args={[0.18, 0.16, 0.12]} />
              <meshStandardMaterial color={color} metalness={0.3} roughness={0.4} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

// ───────────── Glass atelier (design) ─────────────

function atelier(name: string) {
  const b = new Builder();
  yardGround(b, {});
  yard(b, { doorZ: 1.62, flowers: LILACS });
  b.box("stone", "#f0e7e0", [4.0, 0.9, 3.2], [0, 0.45, 0], undefined, 0.9);
  for (const x of [-1.9, -0.95, 0, 0.95, 1.9]) {
    b.box("solid", "#ffffff", [0.08, 1.6, 0.08], [x, 1.7, 1.52]);
    b.box("solid", "#ffffff", [0.08, 1.6, 0.08], [x, 1.7, -1.52]);
  }
  for (const z of [-0.75, 0, 0.75]) for (const x of [-1.9, 1.9]) b.box("solid", "#ffffff", [0.08, 1.6, 0.08], [x, 1.7, z]);
  // greenhouse roof frame: eaves, ridge and rafters (the glass panes are drawn separately)
  for (const x of [-1.95, 1.95]) b.box("solid", "#ffffff", [0.1, 0.1, 3.2], [x, 2.52, 0]);
  b.box("solid", "#ffffff", [4.0, 0.1, 0.1], [0, 2.52, 1.55]);
  b.box("solid", "#ffffff", [4.0, 0.1, 0.1], [0, 2.52, -1.55]);
  b.box("solid", "#ffffff", [0.1, 0.1, 3.3], [0, 3.42, 0]);
  for (const z of [-1.55, -0.52, 0.52, 1.55]) for (const side of [-1, 1]) b.beam("solid", "#ffffff", [side * 1.95, 2.55, z], [0, 3.42, z], 0.08);
  doorOn(b, { W: 4.0, D: 3.2 }, "front", 0, { color: "#ff9fb8", h: 1.25 });
  // easel with a canvas, paint pots, leaning canvases, potted plants
  {
    const [ex, ez, r] = [-2.4, 1.3, 0.5];
    const at = (u: number, v: number, w = 0): [number, number, number] => [ex + u * Math.cos(r) + w * Math.sin(r), v, ez - u * Math.sin(r) + w * Math.cos(r)];
    b.beam("wood", "#d9a37a", at(-0.3, 0, 0.1), at(-0.05, 1.45, -0.05), 0.06);
    b.beam("wood", "#d9a37a", at(0.3, 0, 0.1), at(0.05, 1.45, -0.05), 0.06);
    b.beam("wood", "#d9a37a", at(0, 0, -0.4), at(0, 1.4, -0.05), 0.05);
    b.box("solid", "#fffaf0", [0.8, 0.6, 0.04], at(0, 1.05, 0.06), [-0.12, r, 0]);
    ["#ff8fb8", "#9bf6ff", "#ffd86b"].forEach((c, i) => b.add("solid", c, new THREE.CircleGeometry(0.1, 14), { pos: at(-0.2 + i * 0.2, 1.05 + (i % 2) * 0.1, 0.1), rot: [-0.12, r, 0] }));
    ["#ff8fb8", "#9bf6ff", "#ffd86b", "#c9b4ff"].forEach((c, i) => {
      b.cyl("solid", "#ffffff", 0.1, 0.1, 0.16, at(0.5 + (i % 2) * 0.25, 0.08, 0.3 + Math.floor(i / 2) * 0.25));
      b.cyl("solid", c, 0.09, 0.09, 0.02, at(0.5 + (i % 2) * 0.25, 0.165, 0.3 + Math.floor(i / 2) * 0.25));
    });
  }
  for (const [x, z, c] of [
    [2.35, 1.6, "#ff9fc4"],
    [2.6, 0.9, "#fff1a8"],
  ] as [number, number, string][]) {
    b.cyl("solid", "#e8a07e", 0.22, 0.17, 0.35, [x, 0.17, z]);
    b.sphere("foliage", "#86c98a", 0.3, [x, 0.5, z], [1, 0.9, 1]);
    for (let i = 0; i < 4; i++) b.sphere("foliage", c, 0.08, [x + Math.cos(i * 1.6) * 0.2, 0.68, z + Math.sin(i * 1.6) * 0.2], [1, 0.8, 1], 0);
  }
  b.box("solid", "#fffaf0", [0.7, 0.9, 0.04], [2.1, 0.45, -0.6], [0.15, -Math.PI / 2, 0]);
  const sign = signPost(b, -2.25, 2.2, 0.35);
  return { parts: b.build(), sign, name };
}

function Brush({ activity }: { activity: number }) {
  const brush = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (brush.current) brush.current.rotation.z = Math.sin(clock.elapsedTime * (activity ? 5 : 1)) * 0.35;
  });
  return (
    <group ref={brush} position={[-1.95, 1.0, 1.7]}>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.45, 6]} />
        <meshStandardMaterial color="#8a7dd8" />
      </mesh>
      <mesh position={[0, 0.44, 0]}>
        <sphereGeometry args={[0.04, 8, 6]} />
        <meshStandardMaterial color="#ff8fb8" />
      </mesh>
    </group>
  );
}

// ───────────── Crystal lab (3D / experiments) ─────────────

function lab(name: string) {
  const b = new Builder();
  yardGround(b, {});
  yard(b, { doorZ: 2.1, flowers: LILACS });
  b.cyl("stone", "#ebe4f2", 2.25, 2.45, 1.2, [0, 0.6, 0], { seg: 8, uvUnit: 0.9 });
  doorOn(b, { W: 4.4, D: 4.4 }, "front", 0, { color: "#a58cff", h: 0.95, w: 0.75 });
  const sign = signPost(b, -2.25, 2.3, 0.35);
  return { parts: b.build(), sign, name };
}

function CrystalTop({ glow, activity }: { glow: number; activity: number }) {
  const rings = useRef<THREE.Group>(null);
  const crystal = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, dt) => {
    if (rings.current) {
      rings.current.rotation.y += dt * (activity ? 1.6 : 0.3);
      rings.current.rotation.x = Math.sin(clock.elapsedTime * 0.5) * 0.2;
    }
    if (crystal.current) crystal.current.position.y = 4.6 + Math.sin(clock.elapsedTime * 1.5) * 0.15;
  });
  return (
    <group>
      <mesh castShadow position={[0, 2.2, 0]}>
        <icosahedronGeometry args={[1.9, 1]} />
        <meshStandardMaterial color="#c9b6ff" roughness={0.25} metalness={0.15} flatShading transparent opacity={0.92} emissive="#a58cff" emissiveIntensity={0.1 + glow * 0.4 + (activity ? 0.25 : 0)} />
      </mesh>
      <group ref={rings} position={[0, 2.4, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[2.6, 0.05, 8, 48]} />
          <meshStandardMaterial color="#9bf6ff" emissive="#9bf6ff" emissiveIntensity={0.6} />
        </mesh>
        <mesh rotation={[Math.PI / 2.6, 0.6, 0]}>
          <torusGeometry args={[2.9, 0.04, 8, 48]} />
          <meshStandardMaterial color="#ffc6ff" emissive="#ffc6ff" emissiveIntensity={0.6} />
        </mesh>
      </group>
      <mesh ref={crystal} castShadow position={[0, 4.6, 0]}>
        <octahedronGeometry args={[0.45, 0]} />
        <meshStandardMaterial color="#ffffff" emissive="#bdb2ff" emissiveIntensity={0.6 + glow} flatShading />
      </mesh>
    </group>
  );
}

// ───────────── fallback cottage ─────────────

function hashHue(seed: string) {
  return [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
}

function genericHouse(name: string, seed: string) {
  const b = new Builder();
  const hue = hashHue(seed);
  const wall = `#${new THREE.Color().setHSL(hue / 360, 0.7, 0.9).getHexString()}`;
  const roof = `#${new THREE.Color().setHSL(((hue + 40) % 360) / 360, 0.55, 0.72).getHexString()}`;
  const shutter = `#${new THREE.Color().setHSL(((hue + 180) % 360) / 360, 0.45, 0.78).getHexString()}`;
  yardGround(b, {});
  yard(b, { doorZ: 1.5, flowers: PINKS });
  cottage(b, { W: 3.6, D: 2.9, H: 2.0, wall, roof, shutter, door: roof, ridge: hue % 2 ? "x" : "z", flowers: PINKS });
  chimney(b, -0.9, -0.5, 2.2, 1.6);
  const sign = signPost(b, -2.25, 2.1, 0.35);
  return { parts: b.build(), sign, name };
}

// ───────────── component ─────────────

const SIGN: Record<string, { icon: string; color: string }> = {
  hq: { icon: "🏛️", color: "#e9dcff" },
  research: { icon: "🔭", color: "#d4f2ea" },
  studio: { icon: "🪶", color: "#fff1c9" },
  workshop: { icon: "⚙️", color: "#e2f5ea" },
  atelier: { icon: "🎨", color: "#ffe3ef" },
  lab: { icon: "🧊", color: "#ece6ff" },
};

function SelectionRing({ selected, hovered }: { selected: boolean; hovered: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(clock.elapsedTime * 4) * 0.25;
  });
  if (!selected && !hovered) return null;
  return (
    <mesh ref={ring} position={[0, 0.1, 0.1]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[4.3, 4.6, 48]} />
      <meshBasicMaterial color={selected ? "#ff8fb8" : "#ffffff"} transparent opacity={0.6} />
    </mesh>
  );
}

/** Static, merged model for a building kind (unknown kinds get a cottage). Exported for tests. */
export function buildingModel(kind: string, name: string, id: string) {
  switch (kind) {
    case "hq":
      return townHall(name);
    case "research":
      return observatory(name);
    case "studio":
      return inkStudio(name);
    case "workshop":
      return workshop(name);
    case "atelier":
      return atelier(name);
    case "lab":
      return lab(name);
    default:
      return genericHouse(name, id);
  }
}

export function PastelBuilding({ building, glow, hovered, selected, activity }: BuildingProps) {
  const group = useRef<THREE.Group>(null);
  const lit = useLitMaterials(glow, activity);
  const model = useMemo(() => buildingModel(building.kind, building.name, building.id), [building.kind, building.name, building.id]);
  useFrame((_, dt) => {
    if (!group.current) return;
    const target = hovered ? 1.03 : 1;
    const s = group.current.scale.x + (target - group.current.scale.x) * Math.min(1, dt * 10);
    group.current.scale.setScalar(s);
  });
  const sign = SIGN[building.kind] ?? { icon: "🏠", color: "#f3ecff" };
  const kind = building.kind;
  return (
    <group>
      <SelectionRing selected={selected} hovered={hovered} />
      <group ref={group}>
        <Built parts={model.parts} glass={lit.glass} glow={lit.glow} />
        <Sign at={model.sign} text={building.name} icon={sign.icon} color={sign.color} />
        {kind === "hq" && <Flag />}
        {kind === "research" && "dome" in model && (
          <Spin speed={activity ? 0.6 : 0} position={[0, 3.18, 0]}>
            <Built parts={model.dome as BuiltParts} glass={lit.glass} glow={lit.glow} />
          </Spin>
        )}
        {kind === "research" && activity > 0 && <Orbiter />}
        {kind === "studio" && (
          <>
            <Quill activity={activity} />
            <group position={[1.15, 4.4, -0.55]}>
              <Smoke active={activity > 0} />
            </group>
            <Poster position={[-2.04, 1.55, -0.55]} rotY={-Math.PI / 2} seed={3} palette={["#ff9fc4", "#9fd8ff", "#ffd86b"]} />
            <Poster position={[-2.04, 1.5, 0.55]} rotY={-Math.PI / 2} seed={8} palette={["#c9b4ff", "#ffb38a", "#a8e6b0"]} size={[0.55, 0.7]} />
          </>
        )}
        {kind === "workshop" && (
          <>
            <Gear radius={0.5} teeth={10} color="#ffd86b" speed={activity ? 2.2 : 0.35} position={[1.25, 1.95, 1.66]} />
            <Gear radius={0.32} teeth={8} color="#ff9fb8" speed={activity ? -3.3 : -0.5} position={[1.85, 2.3, 1.66]} />
            <group position={[-1.5, 4.25, -1.0]}>
              <Smoke active={activity > 0} />
            </group>
          </>
        )}
        {kind === "atelier" && (
          <>
            <mesh position={[0, 1.7, 0]}>
              <boxGeometry args={[3.8, 1.6, 3.0]} />
              <meshStandardMaterial color="#d6f4ff" transparent opacity={0.42} depthWrite={false} roughness={0.1} metalness={0.1} emissive="#ffe8a8" emissiveIntensity={glow * 0.5 + (activity ? 0.2 : 0)} />
            </mesh>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[side * 0.98, 2.98, 0]} rotation={[0, 0, -side * Math.atan2(0.9, 1.95)]}>
                <boxGeometry args={[2.15, 0.03, 3.2]} />
                <meshStandardMaterial color="#cdeeff" transparent opacity={0.5} roughness={0.08} metalness={0.1} depthWrite={false} />
              </mesh>
            ))}
            <Brush activity={activity} />
          </>
        )}
        {kind === "lab" && <CrystalTop glow={glow} activity={activity} />}
      </group>
    </group>
  );
}

