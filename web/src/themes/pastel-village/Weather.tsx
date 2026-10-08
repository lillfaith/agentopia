import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { EnvironmentState } from "../../environment/dayCycle";
import { seeded } from "./layout";

const PETALS = 140;
const FIREFLIES = 90;

/**
 * Ambient particles driven continuously by the environment: blossom petals fade
 * out towards evening while fireflies fade in. Future weather kinds (rain, snow)
 * plug in here via `env.weather` without touching the AI side.
 */
export function PastelWeather({ env }: { env: EnvironmentState }) {
  return (
    <>
      <Petals amount={env.lighting.petals} />
      <Fireflies amount={env.lighting.fireflies} />
    </>
  );
}

function useParticles(count: number, seed: number, spread: number, height: number) {
  return useMemo(() => {
    const r = seeded(seed);
    return Array.from({ length: count }, () => ({ x: (r() - 0.5) * spread, y: r() * height, z: (r() - 0.5) * spread, s: 0.5 + r() * 0.8, p: r() * Math.PI * 2 }));
  }, [count, seed, spread, height]);
}

function Petals({ amount }: { amount: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const ps = useParticles(PETALS, 99, 50, 14);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), v: new THREE.Vector3(), s: new THREE.Vector3() }), []);
  useFrame(({ clock }, dt) => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.visible = amount > 0.02;
    if (!mesh.visible) return;
    const t = clock.elapsedTime;
    const visible = Math.round(PETALS * amount);
    ps.forEach((p, i) => {
      p.y -= dt * 0.6 * p.s;
      if (p.y < 0) p.y = 14;
      tmp.v.set(p.x + Math.sin(t * 0.7 + p.p) * 1.5, p.y, p.z + Math.cos(t * 0.5 + p.p));
      tmp.s.setScalar(i < visible ? p.s : 0);
      tmp.e.set(t * p.s + p.p, t * 0.7 + p.p, 0);
      tmp.q.setFromEuler(tmp.e);
      tmp.m.compose(tmp.v, tmp.q, tmp.s);
      mesh.setMatrixAt(i, tmp.m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, PETALS]}>
      <planeGeometry args={[0.14, 0.1]} />
      <meshStandardMaterial color="#ffc4d8" side={THREE.DoubleSide} transparent opacity={0.85} />
    </instancedMesh>
  );
}

function Fireflies({ amount }: { amount: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const ps = useParticles(FIREFLIES, 7, 48, 4);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), v: new THREE.Vector3(), s: new THREE.Vector3(), q: new THREE.Quaternion() }), []);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.visible = amount > 0.02;
    if (!mesh.visible) return;
    const t = clock.elapsedTime;
    const visible = Math.round(FIREFLIES * amount);
    ps.forEach((p, i) => {
      tmp.v.set(p.x + Math.sin(t * 0.5 + p.p) * 0.9, 0.5 + p.y * 0.8 + Math.sin(t * 0.8 + p.p) * 0.3, p.z + Math.cos(t * 0.4 + p.p) * 0.9);
      tmp.s.setScalar(i < visible ? 0.6 + Math.sin(t * 3 + p.p) * 0.4 : 0);
      tmp.m.compose(tmp.v, tmp.q, tmp.s);
      mesh.setMatrixAt(i, tmp.m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, FIREFLIES]}>
      <sphereGeometry args={[0.055, 6, 6]} />
      <meshBasicMaterial color="#fff3a0" toneMapped={false} />
    </instancedMesh>
  );
}
