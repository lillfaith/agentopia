import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

const tmp = new THREE.Vector3();

/**
 * Floating HTML label anchored in the 3D world. Scales with camera distance but
 * clamped, so labels stay legible in the overview and don't balloon up close.
 * Pointer events are stopped here so clicking a label never "misses" into the canvas.
 */
export function WorldLabel({ position, children, reference = 30, min = 0.5, max = 1, zIndex = 10 }: {
  position: [number, number, number];
  children: ReactNode;
  reference?: number;
  min?: number;
  max?: number;
  zIndex?: number;
}) {
  const anchor = useRef<THREE.Group>(null);
  const inner = useRef<HTMLDivElement>(null);
  useFrame(({ camera }) => {
    if (!anchor.current || !inner.current) return;
    anchor.current.getWorldPosition(tmp);
    const s = Math.min(max, Math.max(min, reference / camera.position.distanceTo(tmp)));
    inner.current.style.transform = `scale(${s.toFixed(3)})`;
  });
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <group ref={anchor} position={position}>
      <Html center zIndexRange={[zIndex, 0]}>
        <div ref={inner} className="label-scaler" onPointerDown={stop} onPointerUp={stop} onClick={stop}>
          {children}
        </div>
      </Html>
    </group>
  );
}
