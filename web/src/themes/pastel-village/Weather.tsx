import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { TimeOfDay } from "../../state/store";
import { seeded } from "./layout";

const COUNT = 140;

/** Drifting blossom petals by day; glowing fireflies at dusk and night. */
export function PastelWeather({ timeOfDay }: { timeOfDay: TimeOfDay }) {
  const night = timeOfDay === "night" || timeOfDay === "dusk";
  const ref = useRef<THREE.InstancedMesh>(null);
  const particles = useMemo(() => {
    const r = seeded(99);
    return Array.from({ length: COUNT }, () => ({
      x: (r() - 0.5) * 50,
      y: r() * 14,
      z: (r() - 0.5) * 50,
      s: 0.5 + r() * 0.8,
      p: r() * Math.PI * 2,
    }));
  }, []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const sc = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }, dt) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    particles.forEach((p, i) => {
      if (night) {
        p.y += Math.sin(t * 0.8 + p.p) * dt * 0.3;
        if (p.y < 0.4) p.y = 0.4;
        if (p.y > 4) p.y = 4;
        v.set(p.x + Math.sin(t * 0.5 + p.p) * 0.8, p.y, p.z + Math.cos(t * 0.4 + p.p) * 0.8);
        sc.setScalar(0.6 + Math.sin(t * 3 + p.p) * 0.4);
        e.set(0, 0, 0);
      } else {
        p.y -= dt * 0.6 * p.s;
        if (p.y < 0) p.y = 14;
        v.set(p.x + Math.sin(t * 0.7 + p.p) * 1.5, p.y, p.z + Math.cos(t * 0.5 + p.p));
        sc.setScalar(p.s);
        e.set(t * p.s + p.p, t * 0.7 + p.p, 0);
      }
      q.setFromEuler(e);
      m.compose(v, q, sc);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, COUNT]} key={night ? "night" : "day"}>
      {night ? <sphereGeometry args={[0.05, 6, 6]} /> : <planeGeometry args={[0.14, 0.1]} />}
      {night ? (
        <meshBasicMaterial color="#fff3a0" />
      ) : (
        <meshStandardMaterial color="#ffc4d8" side={THREE.DoubleSide} transparent opacity={0.85} />
      )}
    </instancedMesh>
  );
}
