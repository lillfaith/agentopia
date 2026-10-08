/**
 * Architecture kit for Pastel Village buildings.
 *
 * Buildings are assembled from parts (walls, timber framing, tiled roofs, windows
 * with shutters and flower boxes, arched doors, chimneys, fenced yards…) into a
 * Builder, which merges everything into ONE geometry per material. A detailed
 * cottage costs ~7 draw calls instead of ~150, which keeps the town smooth on
 * integrated GPUs. Colours are baked as vertex colours so one textured material
 * (e.g. roof tiles) serves every roof colour.
 *
 * Coordinates: building-local, door facing +z, ground at y = 0.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PALETTE, TOKENS } from "./palette";

export type MatKey = "plaster" | "stone" | "brick" | "roof" | "wood" | "solid" | "foliage" | "metal" | "glass" | "glow" | "grass";

export const TIMBER = TOKENS.wood.timber;
export const TRIM = TOKENS.trim;
export const IRON = TOKENS.iron;
const GLASS = "#dfe6fb";

type V3 = [number, number, number];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export interface AddOpts {
  pos?: V3;
  rot?: V3;
  scale?: V3;
  /** Multiply UVs (tile a texture in world units). */
  uv?: [number, number];
  /** Swap U and V (e.g. to run roof-tile rows along a slab). */
  uvSwap?: boolean;
  /** Flip V after swapping (mirror tiles on the opposite slab). */
  uvFlip?: boolean;
}

export class Builder {
  private buckets = new Map<MatKey, THREE.BufferGeometry[]>();

  add(mat: MatKey, color: string, geometry: THREE.BufferGeometry, o: AddOpts = {}): this {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (o.uv || o.uvSwap) {
      const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
      if (uv) {
        for (let i = 0; i < uv.count; i++) {
          let u = uv.getX(i) * (o.uv?.[0] ?? 1);
          let v = uv.getY(i) * (o.uv?.[1] ?? 1);
          if (o.uvSwap) [u, v] = [v, u];
          if (o.uvFlip) u = -u;
          uv.setXY(i, u, v);
        }
      }
    }
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    _p.set(...(o.pos ?? [0, 0, 0]));
    _q.setFromEuler(_e.set(...(o.rot ?? [0, 0, 0])));
    _s.set(...(o.scale ?? [1, 1, 1]));
    g.applyMatrix4(_m.compose(_p, _q, _s));
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(k)) g.deleteAttribute(k);
    const list = this.buckets.get(mat) ?? [];
    list.push(g);
    this.buckets.set(mat, list);
    return this;
  }

  box(mat: MatKey, color: string, size: V3, pos: V3, rot?: V3, uvUnit?: number): this {
    const g = new THREE.BoxGeometry(...size);
    if (uvUnit) worldUVBox(g, size, uvUnit);
    return this.add(mat, color, g, { pos, rot });
  }

  cyl(mat: MatKey, color: string, rTop: number, rBot: number, h: number, pos: V3, opts: { seg?: number; rot?: V3; open?: boolean; uvUnit?: number; theta?: [number, number] } = {}): this {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, opts.seg ?? 16, 1, opts.open ?? false, opts.theta?.[0] ?? 0, opts.theta?.[1] ?? Math.PI * 2);
    const uv = opts.uvUnit ? ([(Math.PI * 2 * Math.max(rTop, rBot)) / opts.uvUnit, h / opts.uvUnit] as [number, number]) : undefined;
    return this.add(mat, color, g, { pos, rot: opts.rot, uv });
  }

  sphere(mat: MatKey, color: string, r: number, pos: V3, scale: V3 = [1, 1, 1], detail = 1): this {
    return this.add(mat, color, new THREE.IcosahedronGeometry(r, detail), { pos, scale });
  }

  /** A beam from a to b (any direction) with a square section. */
  beam(mat: MatKey, color: string, a: V3, b: V3, t = 0.1): this {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length();
    const g = new THREE.BoxGeometry(t, len, t);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    return this.add(mat, color, g, { pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], rot: [e.x, e.y, e.z] });
  }

  build(): { mat: MatKey; geometry: THREE.BufferGeometry }[] {
    const out: { mat: MatKey; geometry: THREE.BufferGeometry }[] = [];
    for (const [mat, list] of this.buckets) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      out.push({ mat, geometry: merged });
    }
    return out;
  }
}

/** Box UVs scaled so a repeating texture tiles every `unit` world units. */
function worldUVBox(g: THREE.BoxGeometry, [w, h, d]: V3, unit: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / unit, (uv.getY(i) * dims[f][1]) / unit);
    }
}

// ───────────── faces ─────────────

export type Face = "front" | "back" | "left" | "right";

/** Maps face coordinates (u across, v up, out from the wall) to building space for a W×D box centred at cx/cz. */
export function facePoint(face: Face, W: number, D: number, u: number, v: number, out = 0, cx = 0, cz = 0): { pos: V3; rotY: number } {
  switch (face) {
    case "front":
      return { pos: [cx + u, v, cz + D / 2 + out], rotY: 0 };
    case "back":
      return { pos: [cx - u, v, cz - D / 2 - out], rotY: Math.PI };
    case "right":
      return { pos: [cx + W / 2 + out, v, cz - u], rotY: Math.PI / 2 };
    case "left":
      return { pos: [cx - W / 2 - out, v, cz + u], rotY: -Math.PI / 2 };
  }
}

export interface BoxShell {
  W: number;
  D: number;
  cx?: number;
  cz?: number;
}

function faceWidth(face: Face, s: BoxShell) {
  return face === "front" || face === "back" ? s.W : s.D;
}

/** Half-timbering on one face: sill, plate, posts and braces. */
export function timberFace(b: Builder, s: BoxShell, face: Face, y0: number, h: number, opts: { posts?: number[]; braces?: boolean; mid?: boolean; color?: string } = {}) {
  const fw = faceWidth(face, s);
  const color = opts.color ?? TIMBER;
  const P = (u: number, v: number) => facePoint(face, s.W, s.D, u, v, 0.03, s.cx, s.cz).pos;
  b.beam("wood", color, P(-fw / 2, y0 + 0.06), P(fw / 2, y0 + 0.06), 0.12);
  b.beam("wood", color, P(-fw / 2, y0 + h - 0.06), P(fw / 2, y0 + h - 0.06), 0.12);
  if (opts.mid) b.beam("wood", color, P(-fw / 2, y0 + h * 0.48), P(fw / 2, y0 + h * 0.48), 0.09);
  const posts = opts.posts ?? [-fw / 2 + 0.06, fw / 2 - 0.06];
  for (const u of posts) b.beam("wood", color, P(u, y0), P(u, y0 + h), 0.11);
  if (opts.braces) {
    const l = -fw / 2 + 0.06;
    const r = fw / 2 - 0.06;
    const span = Math.min(0.9, fw * 0.22);
    b.beam("wood", color, P(l, y0 + 0.1), P(l + span, y0 + h - 0.1), 0.08);
    b.beam("wood", color, P(r, y0 + 0.1), P(r - span, y0 + h - 0.1), 0.08);
  }
}

/** Window with frame, mullions, sill, optional shutters and a flower box. */
export function windowOn(b: Builder, s: BoxShell, face: Face, u: number, v: number, o: { w?: number; h?: number; shutter?: string; flowers?: string[]; frame?: string; round?: boolean } = {}) {
  const w = o.w ?? 0.6;
  const h = o.h ?? 0.75;
  const at = (du: number, dv: number, out: number) => facePoint(face, s.W, s.D, u + du, v + dv, out, s.cx, s.cz);
  const { rotY } = at(0, 0, 0);
  const frame = o.frame ?? TRIM;
  if (o.round) {
    b.add("solid", frame, new THREE.TorusGeometry(w / 2, 0.06, 6, 20), { pos: at(0, 0, 0.03).pos, rot: [0, rotY, 0] });
    b.add("glass", GLASS, new THREE.CircleGeometry(w / 2, 20), { pos: at(0, 0, 0.02).pos, rot: [0, rotY, 0] });
    b.box("solid", frame, [w, 0.04, 0.04], at(0, 0, 0.05).pos, [0, rotY, 0]);
    return;
  }
  b.box("solid", frame, [w + 0.16, h + 0.16, 0.06], at(0, 0, 0.01).pos, [0, rotY, 0]);
  b.box("glass", GLASS, [w, h, 0.02], at(0, 0, 0.045).pos, [0, rotY, 0]);
  b.box("solid", frame, [0.045, h, 0.03], at(0, 0, 0.065).pos, [0, rotY, 0]);
  b.box("solid", frame, [w, 0.045, 0.03], at(0, 0.04, 0.065).pos, [0, rotY, 0]);
  b.box("solid", frame, [w + 0.26, 0.07, 0.16], at(0, -h / 2 - 0.08, 0.07).pos, [0, rotY, 0]);
  if (o.shutter) {
    for (const side of [-1, 1]) {
      b.box("wood", o.shutter, [w * 0.48, h + 0.06, 0.05], at(side * (w / 2 + w * 0.3), 0, 0.05).pos, [0, rotY, 0]);
      b.box("solid", "#ffffff", [w * 0.3, 0.035, 0.02], at(side * (w / 2 + w * 0.3), h * 0.22, 0.085).pos, [0, rotY, 0]);
      b.box("solid", "#ffffff", [w * 0.3, 0.035, 0.02], at(side * (w / 2 + w * 0.3), -h * 0.22, 0.085).pos, [0, rotY, 0]);
    }
  }
  if (o.flowers) {
    b.box("wood", TOKENS.wood.planter, [w + 0.18, 0.17, 0.2], at(0, -h / 2 - 0.22, 0.14).pos, [0, rotY, 0]);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const du = -w / 2 + (i + 0.5) * (w / n);
      b.sphere("foliage", TOKENS.foliage.leaf, 0.085, at(du, -h / 2 - 0.1, 0.15).pos, [1, 0.8, 1], 0);
      b.sphere("foliage", o.flowers[i % o.flowers.length], 0.065, at(du + 0.02, -h / 2 - 0.02, 0.2).pos, [1, 0.8, 1], 0);
    }
  }
}

/** Arched plank door with a stone frame, knob and step. */
export function doorOn(b: Builder, s: BoxShell, face: Face, u: number, o: { w?: number; h?: number; color?: string; double?: boolean } = {}) {
  const w = o.w ?? 0.85;
  const h = o.h ?? 1.3;
  const color = o.color ?? TOKENS.doors.studio;
  const at = (du: number, dv: number, out: number) => facePoint(face, s.W, s.D, u + du, dv, out, s.cx, s.cz);
  const { rotY } = at(0, 0, 0);
  // stone surround
  b.box("stone", TOKENS.stone.doorFrame, [w + 0.3, h + 0.15, 0.08], at(0, (h + 0.15) / 2, 0.0).pos, [0, rotY, 0], 0.5);
  b.add("stone", TOKENS.stone.doorFrame, halfDisc((w + 0.3) / 2, 0.08), { pos: at(0, h + 0.15, 0).pos, rot: [0, rotY, 0] });
  b.box("wood", color, [w, h, 0.06], at(0, h / 2, 0.05).pos, [0, rotY, 0]);
  b.add("wood", color, halfDisc(w / 2, 0.06), { pos: at(0, h, 0.05).pos, rot: [0, rotY, 0] });
  // plank grooves
  for (const du of [-w / 4, 0, w / 4]) b.box("wood", shade(color, -0.25), [0.025, h + w / 2 - 0.12, 0.02], at(du, (h + w / 2) / 2 - 0.06, 0.085).pos, [0, rotY, 0]);
  if (o.double) b.box("wood", shade(color, -0.3), [0.04, h + w / 2 - 0.05, 0.03], at(0, (h + w / 2) / 2, 0.09).pos, [0, rotY, 0]);
  b.sphere("metal", PALETTE.gold, 0.045, at(w * 0.3, h * 0.5, 0.11).pos, [1, 1, 1], 0);
  // step
  b.box("stone", TOKENS.stone.step, [w + 0.5, 0.14, 0.45], at(0, 0.07, 0.25).pos, [0, rotY, 0], 0.5);
}

/** Upper half of a disc of thickness t, facing +z (for arched doors). */
function halfDisc(r: number, t: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, t, 18, 1, false, -Math.PI / 2, Math.PI);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A little wall lantern (always faintly lit, bright at night). */
export function wallLantern(b: Builder, s: BoxShell, face: Face, u: number, v: number) {
  const at = (dv: number, out: number) => facePoint(face, s.W, s.D, u, v + dv, out, s.cx, s.cz);
  const { rotY } = at(0, 0);
  b.box("metal", IRON, [0.05, 0.05, 0.28], at(0.1, 0.14).pos, [0, rotY, 0]);
  b.box("glow", TOKENS.glow.lampGlass, [0.18, 0.24, 0.18], at(-0.05, 0.28).pos, [0, rotY, 0]);
  b.add("metal", IRON, new THREE.ConeGeometry(0.17, 0.14, 4), { pos: at(0.14, 0.28).pos, rot: [0, rotY + Math.PI / 4, 0] });
}

export function shade(hex: string, t: number): string {
  const c = new THREE.Color(hex);
  if (t > 0) c.lerp(new THREE.Color("#ffffff"), t);
  else c.lerp(new THREE.Color(PALETTE.inkPlum), -t);
  return `#${c.getHexString()}`;
}

/**
 * Pitched roof of clay tiles over a W×D footprint. The ridge runs along z
 * (gable facing the front) or along x (gable on the sides). Gable ends are
 * plastered, with timber bargeboards.
 */
export function gableRoof(b: Builder, o: { W: number; D: number; y: number; pitch: number; color: string; wall: string; ridge?: "z" | "x"; overhang?: number; cx?: number; cz?: number; gableTimber?: boolean }) {
  const ridgeX = o.ridge === "x";
  // Work in a frame where slabs slope along local x and the ridge runs along local z.
  const span = ridgeX ? o.D : o.W;
  const len = ridgeX ? o.W : o.D;
  const ov = o.overhang ?? 0.32;
  const half = span / 2 + ov;
  const theta = Math.atan2(o.pitch, span / 2);
  const L = half / Math.cos(theta);
  const T = 0.13;
  const cx = o.cx ?? 0;
  const cz = o.cz ?? 0;
  const yaw = ridgeX ? Math.PI / 2 : 0;
  const rot = (x: number, z: number): [number, number] => (ridgeX ? [cx + z, cz - x] : [cx + x, cz + z]);
  for (const side of [-1, 1]) {
    const mx = side * (L / 2) * Math.cos(theta) + side * Math.sin(theta) * (T / 2);
    const my = o.y + o.pitch - (L / 2) * Math.sin(theta) + Math.cos(theta) * (T / 2);
    const [px, pz] = rot(mx, 0);
    const g = new THREE.BoxGeometry(L, T, len + ov * 2);
    worldUVBox(g, [L, T, len + ov * 2], 0.62);
    b.add("roof", o.color, g, { pos: [px, my, pz], rot: [0, yaw, -side * theta], uvSwap: true, uvFlip: side < 0 });
  }
  // ridge cap
  const [rx, rz] = rot(0, 0);
  b.add("roof", shade(o.color, -0.12), new THREE.CylinderGeometry(0.11, 0.11, len + ov * 2 + 0.05, 8), { pos: [rx, o.y + o.pitch + 0.07, rz], rot: ridgeX ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0] });
  // gable ends (plaster triangles) + bargeboards
  const shape = new THREE.Shape();
  shape.moveTo(-span / 2, 0);
  shape.lineTo(span / 2, 0);
  shape.lineTo(0, o.pitch);
  shape.closePath();
  const tri = new THREE.ExtrudeGeometry(shape, { depth: len - 0.02, bevelEnabled: false });
  tri.translate(0, 0, -(len - 0.02) / 2);
  // planar UVs for the plaster texture
  const p = tri.attributes.position as THREE.BufferAttribute;
  const uv = tri.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 1.2, p.getY(i) / 1.2);
  b.add("plaster", o.wall, tri, { pos: [cx, o.y, cz], rot: [0, yaw, 0] });
  for (const end of [-1, 1]) {
    for (const side of [-1, 1]) {
      const a = rot(side * (half - 0.02), end * (len / 2 + ov - 0.04));
      const c = rot(0, end * (len / 2 + ov - 0.04));
      b.beam("wood", TIMBER, [a[0], o.y - ov * Math.tan(theta) + 0.06, a[1]], [c[0], o.y + o.pitch + 0.1, c[1]], 0.1);
    }
    if (o.gableTimber) {
      const z = end * (len / 2 + 0.02);
      const k = rot(0, z);
      b.beam("wood", TIMBER, [k[0], o.y + 0.05, k[1]], [k[0], o.y + o.pitch - 0.05, k[1]], 0.09);
    }
  }
}

/** Cone roof (towers) in roof tiles. */
export function coneRoof(b: Builder, color: string, r: number, h: number, pos: V3) {
  const g = new THREE.ConeGeometry(r, h, 18, 1);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ((Math.PI * 2 * r) / 0.62), uv.getY(i) * (h / 0.62) * 1.2);
  b.add("roof", color, g, { pos });
  b.sphere("metal", PALETTE.gold, 0.09, [pos[0], pos[1] + h / 2 + 0.05, pos[2]], [1, 1, 1], 0);
}

export function chimney(b: Builder, x: number, z: number, yBase: number, h: number) {
  b.box("brick", TOKENS.walls.chimney, [0.5, h, 0.5], [x, yBase + h / 2, z], undefined, 0.6);
  b.box("stone", TOKENS.stone.foundation, [0.62, 0.12, 0.62], [x, yBase + h + 0.06, z], undefined, 0.5);
}

/** Freestanding signpost; returns where to put the painted board (drawn separately, with text). */
export function signPost(b: Builder, x: number, z: number, rotY: number): { pos: V3; rotY: number } {
  const c = Math.cos(rotY);
  const sn = Math.sin(rotY);
  for (const side of [-1, 1]) {
    const px = x + side * 0.62 * c;
    const pz = z - side * 0.62 * sn;
    b.box("wood", TIMBER, [0.1, 1.55, 0.1], [px, 0.78, pz], [0, rotY, 0]);
    b.sphere("wood", TIMBER, 0.07, [px, 1.6, pz], [1, 1, 1], 0);
  }
  return { pos: [x, 1.12, z], rotY };
}

/** Fenced garden plot: picket fence on the sides and back, bushes at the front corners, stepping stones to the door. */
export function yard(b: Builder, o: { doorZ: number; halfW?: number; zMin?: number; zMax?: number; fence?: string; flowers?: string[] }) {
  const hw = o.halfW ?? 3.15;
  const z0 = o.zMin ?? -2.95;
  const z1 = o.zMax ?? 2.6;
  const fence = o.fence ?? TOKENS.wood.fence;
  const picket = (x: number, z: number, rotY: number) => {
    b.box("wood", fence, [0.09, 0.62, 0.05], [x, 0.31, z], [0, rotY, 0]);
    b.add("wood", fence, new THREE.ConeGeometry(0.065, 0.1, 4), { pos: [x, 0.66, z], rot: [0, rotY + Math.PI / 4, 0] });
  };
  for (let x = -hw; x <= hw + 0.01; x += 0.3) picket(x, z0, 0);
  for (let z = z0 + 0.3; z <= z1; z += 0.3) {
    picket(-hw, z, Math.PI / 2);
    picket(hw, z, Math.PI / 2);
  }
  for (const y of [0.22, 0.48]) {
    b.box("wood", shade(fence, -0.08), [hw * 2, 0.06, 0.04], [0, y, z0 - 0.04], undefined);
    for (const x of [-hw, hw]) b.box("wood", shade(fence, -0.08), [0.04, 0.06, z1 - z0], [x + Math.sign(x) * 0.04, y, (z0 + z1) / 2]);
  }
  // corner posts
  for (const [x, z] of [
    [-hw, z0],
    [hw, z0],
    [-hw, z1],
    [hw, z1],
  ] as [number, number][]) {
    b.box("wood", shade(fence, -0.05), [0.14, 0.8, 0.14], [x, 0.4, z]);
    b.sphere("wood", shade(fence, -0.05), 0.09, [x, 0.84, z], [1, 1, 1], 0);
  }
  // front corner bushes and flowers along the fence
  const flowers = o.flowers ?? TOKENS.flowers.sets[0];
  for (const side of [-1, 1]) {
    b.sphere("foliage", TOKENS.foliage.bushes[0], 0.42, [side * (hw - 0.45), 0.36, z1 - 0.35], [1, 0.85, 1]);
    b.sphere("foliage", TOKENS.foliage.flowering[side > 0 ? 0 : 2], 0.3, [side * (hw - 0.95), 0.27, z1 - 0.2], [1, 0.85, 1]);
    for (let z = z0 + 0.5; z < z1 - 1.2; z += 0.42) {
      b.sphere("foliage", TOKENS.foliage.leaf, 0.1, [side * (hw - 0.25), 0.1, z], [1, 0.8, 1], 0);
      b.sphere("foliage", flowers[Math.abs(Math.round(z * 3)) % flowers.length], 0.075, [side * (hw - 0.25), 0.22, z + 0.05], [1, 0.8, 1], 0);
    }
  }
  // stepping stones from the door to the gate
  for (let z = o.doorZ + 0.55, i = 0; z < z1 + 0.5; z += 0.48, i++) {
    b.add("stone", i % 2 ? TOKENS.stone.flag[3] : TOKENS.stone.flag[0], new THREE.CylinderGeometry(0.26, 0.28, 0.06, 9), { pos: [(i % 2 ? 0.08 : -0.06), 0.04, z], rot: [0, i, 0], uv: [0.4, 0.4] });
  }
}

/** Ground of the yard: a slightly richer lawn inside the fence. */
export function yardGround(b: Builder, o: { halfW?: number; zMin?: number; zMax?: number; color?: string }) {
  const hw = o.halfW ?? 3.15;
  const z0 = o.zMin ?? -2.95;
  const z1 = o.zMax ?? 2.6;
  const g = new THREE.PlaneGeometry(hw * 2, z1 - z0);
  b.add("grass", o.color ?? TOKENS.ground.yard, g, { pos: [0, 0.012, (z0 + z1) / 2], rot: [-Math.PI / 2, 0, 0], uv: [(hw * 2) / 4.5, (z1 - z0) / 4.5] });
}
