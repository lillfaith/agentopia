import { useLayoutEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";

/** One instance: position, optional rotation (radians) and scale, optional colour. */
export interface Inst {
  x: number;
  y?: number;
  z: number;
  rx?: number;
  ry?: number;
  rz?: number;
  /** Uniform scale, or per-axis via sx/sy/sz (which multiply `s`). */
  s?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  color?: string;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Draws many copies of one geometry + material in a single draw call. Children
 * are the geometry and material, e.g.
 *   <Instanced items={rocks}><dodecahedronGeometry /><meshStandardMaterial /></Instanced>
 * Per-instance colours multiply the material colour (keep it white to use them as-is).
 */
export function Instanced({ items, children, castShadow, receiveShadow, frustumCulled = true }: { items: Inst[]; children: ReactNode; castShadow?: boolean; receiveShadow?: boolean; frustumCulled?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((it, i) => {
      const s = it.s ?? 1;
      _p.set(it.x, it.y ?? 0, it.z);
      _q.setFromEuler(_e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0));
      _s.set(s * (it.sx ?? 1), s * (it.sy ?? 1), s * (it.sz ?? 1));
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      if (it.color) mesh.setColorAt(i, _c.set(it.color));
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  if (!items.length) return null;
  return (
    // Keyed by count so a different number of items rebuilds the buffers.
    <instancedMesh key={items.length} ref={ref} args={[undefined, undefined, items.length]} castShadow={castShadow} receiveShadow={receiveShadow} frustumCulled={frustumCulled}>
      {children}
    </instancedMesh>
  );
}
