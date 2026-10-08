/**
 * Pastel Village models for the theme-agnostic cosmetic catalog (shared/cosmetics.ts).
 *
 * Every item is built from primitives and is attached to an anchor on the animated
 * rig (see Character.tsx): head/face/neck/back items ride on the bobbing body, hand
 * items are children of the swinging right arm. Unknown ids (e.g. from a cosmetic
 * pack this theme doesn't know yet) render a small neutral charm instead of nothing.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { WearableSlot } from "../../../../shared/cosmetics";

/** Anchor positions in character space (body sphere: centre y 0.62, radius 0.5). */
export const ANCHORS: Record<Exclude<WearableSlot, "hand">, [number, number, number]> = {
  head: [0, 1.12, 0],
  eyes: [0, 0.78, 0.44],
  neck: [0, 0.5, 0],
  back: [0, 0.62, -0.45],
};
/** Hand anchor, relative to the right arm's shoulder pivot. */
export const HAND_ANCHOR: [number, number, number] = [0.06, -0.28, 0.08];

/** Head items that cover the ears (ears are hidden while worn). */
export const HIDES_EARS = new Set(["sun-hat", "beanie"]);

const GOLD = { color: "#ffd86b", metalness: 0.5, roughness: 0.3 };

function Bow({ color, scale = 1 }: { color: string; scale?: number }) {
  return (
    <group scale={scale}>
      <mesh position={[-0.1, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.1, 0.2, 12]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      <mesh position={[0.1, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.1, 0.2, 12]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.055, 10, 8]} />
        <meshStandardMaterial color={color} roughness={0.45} />
      </mesh>
    </group>
  );
}

function Blossom({ color, r = 0.06, position }: { color: string; r?: number; position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh scale={[1, 0.6, 1]}>
        <sphereGeometry args={[r, 8, 6]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0, r * 0.45, 0]}>
        <sphereGeometry args={[r * 0.4, 6, 5]} />
        <meshStandardMaterial color="#ffe27a" roughness={0.5} />
      </mesh>
    </group>
  );
}

const PETALS = ["#ff9fc4", "#ffd1e3", "#f6a6bf", "#d8c8ff", "#fff1a8", "#ffc9b6"];

function starShape(outer: number, inner: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

/** A plump heart outline, centred at the origin, about 1.3·s wide. */
export function heartShape(sz: number): THREE.Shape {
  const h = new THREE.Shape();
  h.moveTo(0, -0.6 * sz);
  h.bezierCurveTo(-0.15 * sz, -0.45 * sz, -0.75 * sz, -0.15 * sz, -0.65 * sz, 0.25 * sz);
  h.bezierCurveTo(-0.55 * sz, 0.65 * sz, -0.05 * sz, 0.65 * sz, 0, 0.3 * sz);
  h.bezierCurveTo(0.05 * sz, 0.65 * sz, 0.55 * sz, 0.65 * sz, 0.65 * sz, 0.25 * sz);
  h.bezierCurveTo(0.75 * sz, -0.15 * sz, 0.15 * sz, -0.45 * sz, 0, -0.6 * sz);
  return h;
}

function Heart({ size, depth, color, emissive = 0 }: { size: number; depth: number; color: string; emissive?: number }) {
  const geom = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(heartShape(size), { depth, bevelEnabled: true, bevelSize: depth * 0.4, bevelThickness: depth * 0.4, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, -depth / 2);
    return g;
  }, [size, depth]);
  return (
    <mesh geometry={geom} castShadow>
      <meshStandardMaterial color={color} roughness={0.4} emissive={color} emissiveIntensity={emissive} />
    </mesh>
  );
}

function FairyWings() {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const f = Math.sin(clock.elapsedTime * 6) * 0.25;
    if (left.current) left.current.rotation.y = -0.5 - f;
    if (right.current) right.current.rotation.y = 0.5 + f;
  });
  const wing = (big: boolean, y: number) => (
    <mesh position={[big ? 0.22 : 0.17, y, 0]} rotation={[0, 0, big ? 0.5 : -0.4]} scale={big ? [0.26, 0.17, 1] : [0.18, 0.11, 1]}>
      <circleGeometry args={[1, 20]} />
      <meshStandardMaterial color="#ffe0ef" emissive="#ffc2dd" emissiveIntensity={0.35} transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
  return (
    <group position={[0, 0.08, -0.04]}>
      <group ref={right}>
        {wing(true, 0.1)}
        {wing(false, -0.12)}
      </group>
      <group ref={left} scale={[-1, 1, 1]}>
        {wing(true, 0.1)}
        {wing(false, -0.12)}
      </group>
    </group>
  );
}

const ROSE_GOLD = { color: "#f3b6c8", metalness: 0.5, roughness: 0.3 };

function Star({ outer, inner, depth, color, emissive = 0.4 }: { outer: number; inner: number; depth: number; color: string; emissive?: number }) {
  const geom = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(starShape(outer, inner), { depth, bevelEnabled: true, bevelSize: depth * 0.3, bevelThickness: depth * 0.3, bevelSegments: 1 });
    g.translate(0, 0, -depth / 2);
    return g;
  }, [outer, inner, depth]);
  return (
    <mesh geometry={geom}>
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissive} metalness={0.3} roughness={0.35} />
    </mesh>
  );
}

/** Boutique: four plush hearts that flutter like wings. */
function HeartWings() {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const f = Math.sin(clock.elapsedTime * 5) * 0.22;
    if (left.current) left.current.rotation.y = -0.45 - f;
    if (right.current) right.current.rotation.y = 0.45 + f;
  });
  const side = (
    <>
      <group position={[0.24, 0.1, 0]} rotation={[0, 0, -0.55]}>
        <Heart size={0.24} depth={0.05} color="#ffb3cf" emissive={0.15} />
      </group>
      <group position={[0.18, -0.12, 0]} rotation={[0, 0, -2.3]}>
        <Heart size={0.15} depth={0.04} color="#e6c4f5" emissive={0.15} />
      </group>
    </>
  );
  return (
    <group position={[0, 0.08, -0.04]}>
      <group ref={right}>{side}</group>
      <group ref={left} scale={[-1, 1, 1]}>
        {side}
      </group>
    </group>
  );
}

/** Boutique: a heart balloon on a ribbon that bobs gently. */
function HeartBalloon() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.position.y = 0.62 + Math.sin(clock.elapsedTime * 1.6) * 0.03;
      ref.current.rotation.z = Math.sin(clock.elapsedTime * 1.1) * 0.08;
    }
  });
  return (
    <group>
      <mesh position={[0, 0.28, 0]}>
        <cylinderGeometry args={[0.006, 0.006, 0.56, 4]} />
        <meshStandardMaterial color="#fff4f6" />
      </mesh>
      <group ref={ref} position={[0, 0.62, 0]}>
        <Heart size={0.17} depth={0.12} color="#ff8fb8" emissive={0.12} />
      </group>
    </group>
  );
}

function Steam() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    ref.current?.children.forEach((c, i) => {
      const t = (clock.elapsedTime * 0.6 + i / 3) % 1;
      c.position.set(Math.sin(t * 6 + i) * 0.02, 0.1 + t * 0.18, 0);
      c.scale.setScalar(0.6 + t * 0.8);
      ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - t);
    });
  });
  return (
    <group ref={ref}>
      {[0, 1, 2].map((i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.025, 6, 5]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function HeadItem({ id }: { id: string }) {
  switch (id) {
    case "star-halo":
      return (
        <group position={[0, 0.3, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.2, 0.016, 8, 32]} />
            <meshStandardMaterial {...GOLD} emissive="#ffd86b" emissiveIntensity={0.5} />
          </mesh>
          {[0, 1, 2, 3, 4].map((i) => {
            const a = (i / 5) * Math.PI * 2;
            return (
              <group key={i} position={[Math.sin(a) * 0.2, 0.02, Math.cos(a) * 0.2]} rotation={[0, a, 0]}>
                <Star outer={0.045} inner={0.02} depth={0.015} color="#ffe27a" />
              </group>
            );
          })}
        </group>
      );
    case "heart-crown":
      return (
        <group position={[0, 0.06, 0]}>
          <mesh>
            <cylinderGeometry args={[0.22, 0.25, 0.12, 16, 1, true]} />
            <meshStandardMaterial {...ROSE_GOLD} side={THREE.DoubleSide} />
          </mesh>
          {[0, 1, 2, 3, 4].map((i) => {
            const a = (i / 5) * Math.PI * 2;
            return (
              <group key={i} position={[Math.sin(a) * 0.22, 0.12, Math.cos(a) * 0.22]} rotation={[0, a, 0]}>
                <Heart size={0.075} depth={0.03} color={i === 0 ? "#ff6fa3" : "#ffb3cf"} emissive={i === 0 ? 0.4 : 0.1} />
              </group>
            );
          })}
        </group>
      );
    case "ribbon-bow":
      return (
        <group position={[0.2, 0, 0.06]} rotation={[0, 0, -0.35]}>
          <Bow color="#ff7aa8" />
        </group>
      );
    case "sun-hat":
      return (
        <group position={[0, -0.08, 0]} rotation={[-0.08, 0, 0.06]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.66, 0.68, 0.035, 32]} />
            <meshStandardMaterial color="#f3d9a0" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.13, 0]}>
            <cylinderGeometry args={[0.3, 0.37, 0.24, 24]} />
            <meshStandardMaterial color="#f3d9a0" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.375, 0.375, 0.07, 24]} />
            <meshStandardMaterial color="#ff9fbf" roughness={0.6} />
          </mesh>
          <group position={[0.3, 0.07, 0.2]} rotation={[0, 0.6, 0]}>
            <Bow color="#ff9fbf" scale={0.6} />
          </group>
        </group>
      );
    case "crown":
      return (
        <group position={[0, 0.06, 0]}>
          <mesh>
            <cylinderGeometry args={[0.22, 0.25, 0.14, 16, 1, true]} />
            <meshStandardMaterial {...GOLD} side={THREE.DoubleSide} />
          </mesh>
          {[0, 1, 2, 3, 4].map((i) => {
            const a = (i / 5) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.sin(a) * 0.22, 0.12, Math.cos(a) * 0.22]}>
                <coneGeometry args={[0.05, 0.13, 6]} />
                <meshStandardMaterial {...GOLD} />
              </mesh>
            );
          })}
          <mesh position={[0, 0.01, 0.245]}>
            <sphereGeometry args={[0.042, 8, 8]} />
            <meshStandardMaterial color="#ff8fb8" emissive="#ff8fb8" emissiveIntensity={0.4} />
          </mesh>
        </group>
      );
    case "beret":
      return (
        <group position={[0.06, 0.04, 0]} rotation={[0, 0, -0.25]}>
          <mesh scale={[1, 0.38, 1]}>
            <sphereGeometry args={[0.36, 20, 12]} />
            <meshStandardMaterial color="#ff8fa3" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.15, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.1, 6]} />
            <meshStandardMaterial color="#e86f88" />
          </mesh>
        </group>
      );
    case "flower-crown":
      return (
        <group position={[0, -0.02, 0]} rotation={[0.12, 0, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.3, 0.022, 6, 28]} />
            <meshStandardMaterial color="#7cc47f" roughness={0.8} />
          </mesh>
          {Array.from({ length: 9 }, (_, i) => {
            const a = (i / 9) * Math.PI * 2;
            return <Blossom key={i} color={PETALS[i % PETALS.length]} position={[Math.sin(a) * 0.3, 0.03, Math.cos(a) * 0.3]} />;
          })}
        </group>
      );
    case "beanie":
      return (
        <group position={[0, -0.14, 0]}>
          <mesh scale={[1, 0.85, 0.96]}>
            <sphereGeometry args={[0.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#f4a6bf" roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.96, 1]}>
            <torusGeometry args={[0.39, 0.065, 8, 28]} />
            <meshStandardMaterial color="#e888a8" roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.37, 0]}>
            <sphereGeometry args={[0.1, 12, 10]} />
            <meshStandardMaterial color="#fff2d6" roughness={1} />
          </mesh>
        </group>
      );
    case "headphones":
      return (
        <group position={[0, -0.32, 0]}>
          <mesh>
            <torusGeometry args={[0.47, 0.035, 8, 28, Math.PI]} />
            <meshStandardMaterial color="#a87597" roughness={0.4} />
          </mesh>
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.49, 0, 0]}>
              <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.13, 0.13, 0.1, 18]} />
                <meshStandardMaterial color="#ff8fb8" roughness={0.5} />
              </mesh>
              <mesh position={[s * 0.055, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.08, 0.08, 0.02, 14]} />
                <meshStandardMaterial color="#ffffff" roughness={0.4} />
              </mesh>
            </group>
          ))}
        </group>
      );
    case "tiara":
      return (
        <group position={[0, -0.02, 0.06]} rotation={[-0.3, 0, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.3, 0.025, 6, 24, Math.PI]} />
            <meshStandardMaterial {...GOLD} color="#f2c9a0" />
          </mesh>
          {[-0.9, -0.45, 0.45, 0.9].map((a) => (
            <mesh key={a} position={[Math.sin(a) * 0.3, 0.07, Math.cos(a) * 0.3]}>
              <coneGeometry args={[0.03, 0.12, 5]} />
              <meshStandardMaterial {...GOLD} color="#f2c9a0" />
            </mesh>
          ))}
          <group position={[0, 0.1, 0.3]} scale={0.9}>
            <Heart size={0.11} depth={0.04} color="#ff7fab" emissive={0.25} />
          </group>
        </group>
      );
    case "sakura-pin":
      return (
        <group position={[0.3, -0.08, 0.14]} rotation={[0.2, 0.5, -0.3]}>
          <Blossom color="#ffc4d8" r={0.085} position={[0, 0, 0]} />
          <Blossom color="#ffd6e4" r={0.07} position={[0.11, -0.05, 0.02]} />
          <Blossom color="#f7aac6" r={0.065} position={[-0.06, -0.1, 0.03]} />
          <mesh position={[0.05, 0.08, -0.03]} rotation={[0, 0, -0.6]} scale={[1, 0.4, 0.6]}>
            <sphereGeometry args={[0.07, 8, 6]} />
            <meshStandardMaterial color="#8fd18a" />
          </mesh>
        </group>
      );
    case "sprout":
      return (
        <group>
          <mesh position={[0, 0.07, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.14, 6]} />
            <meshStandardMaterial color="#6fb86f" />
          </mesh>
          <mesh position={[0.08, 0.15, 0]} rotation={[0, 0, -0.5]} scale={[1, 0.4, 0.6]}>
            <sphereGeometry args={[0.09, 10, 8]} />
            <meshStandardMaterial color="#8fd68a" />
          </mesh>
          <mesh position={[-0.08, 0.15, 0]} rotation={[0, 0, 0.5]} scale={[1, 0.4, 0.6]}>
            <sphereGeometry args={[0.09, 10, 8]} />
            <meshStandardMaterial color="#8fd68a" />
          </mesh>
        </group>
      );
    default:
      return <Charm />;
  }
}

function EyesItem({ id }: { id: string }) {
  const star = useMemo(() => starShape(0.13, 0.06), []);
  const starBack = useMemo(() => starShape(0.155, 0.075), []);
  const heartFrame = useMemo(() => heartShape(0.2), []);
  const heartLens = useMemo(() => heartShape(0.16), []);
  switch (id) {
    case "round-glasses":
      return (
        <group position={[0, 0, 0.05]}>
          {[-0.16, 0.16].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <mesh>
                <torusGeometry args={[0.1, 0.014, 6, 24]} />
                <meshStandardMaterial {...GOLD} color="#d9b25a" />
              </mesh>
              <mesh>
                <circleGeometry args={[0.095, 20]} />
                <meshStandardMaterial color="#e8f7ff" transparent opacity={0.28} depthWrite={false} />
              </mesh>
            </group>
          ))}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.01, 0.01, 0.12, 6]} />
            <meshStandardMaterial {...GOLD} color="#d9b25a" />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.27, 0, -0.16]} rotation={[0, s * 0.35, 0]}>
              <boxGeometry args={[0.012, 0.012, 0.3]} />
              <meshStandardMaterial {...GOLD} color="#d9b25a" />
            </mesh>
          ))}
        </group>
      );
    case "star-shades":
      return (
        <group position={[0, 0.01, 0.06]}>
          {[-0.16, 0.16].map((x) => (
            <group key={x} position={[x, 0, 0]} rotation={[0, x * 0.9, 0]}>
              <mesh position={[0, 0, -0.005]}>
                <shapeGeometry args={[starBack]} />
                <meshStandardMaterial color="#ff6fa8" roughness={0.4} side={THREE.DoubleSide} />
              </mesh>
              <mesh>
                <shapeGeometry args={[star]} />
                <meshStandardMaterial color="#3b2f4a" roughness={0.15} metalness={0.3} side={THREE.DoubleSide} />
              </mesh>
            </group>
          ))}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.014, 0.014, 0.1, 6]} />
            <meshStandardMaterial color="#ff6fa8" />
          </mesh>
        </group>
      );
    case "heart-shades":
      return (
        <group position={[0, 0.01, 0.06]}>
          {[-0.16, 0.16].map((x) => (
            <group key={x} position={[x, 0, 0]} rotation={[0, x * 0.9, 0]}>
              <mesh position={[0, 0, -0.006]}>
                <shapeGeometry args={[heartFrame]} />
                <meshStandardMaterial color="#e7799e" roughness={0.4} side={THREE.DoubleSide} />
              </mesh>
              <mesh>
                <shapeGeometry args={[heartLens]} />
                <meshStandardMaterial color="#c84a7c" roughness={0.12} metalness={0.3} transparent opacity={0.85} side={THREE.DoubleSide} />
              </mesh>
            </group>
          ))}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.012, 0.012, 0.1, 6]} />
            <meshStandardMaterial color="#e7799e" />
          </mesh>
        </group>
      );
    case "goggles":
      return (
        <group position={[0, 0.2, -0.44]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.95, 1]}>
            <torusGeometry args={[0.37, 0.03, 8, 32]} />
            <meshStandardMaterial color="#c497b4" />
          </mesh>
          {[-0.13, 0.13].map((x) => (
            <group key={x} position={[x, 0.03, 0.33]} rotation={[-0.55, x * 1.4, 0]}>
              <mesh>
                <cylinderGeometry args={[0.1, 0.1, 0.06, 18]} />
                <meshStandardMaterial color="#e6a99c" metalness={0.6} roughness={0.3} />
              </mesh>
              <mesh position={[0, 0.032, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.08, 18]} />
                <meshStandardMaterial color="#c8f1ff" emissive="#9fe3ff" emissiveIntensity={0.2} transparent opacity={0.85} />
              </mesh>
            </group>
          ))}
        </group>
      );
    default:
      return (
        <group position={[0.3, 0.12, 0]}>
          <Charm />
        </group>
      );
  }
}

function NeckItem({ id }: { id: string }) {
  switch (id) {
    case "heart-locket":
      return (
        <group position={[0, -0.04, 0]} rotation={[0.18, 0, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1.02, 0.97, 1]}>
            <torusGeometry args={[0.5, 0.012, 6, 48]} />
            <meshStandardMaterial {...GOLD} />
          </mesh>
          <group position={[0, -0.1, 0.5]}>
            <Heart size={0.1} depth={0.04} color="#ff8fb8" emissive={0.35} />
          </group>
        </group>
      );
    case "scarf":
      return (
        <group>
          <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.95, 1]}>
            <torusGeometry args={[0.5, 0.075, 10, 32]} />
            <meshStandardMaterial color="#ec88a8" roughness={0.95} />
          </mesh>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[0.2 + i * 0.012, -0.1 - i * 0.1, 0.47]} rotation={[0.1, 0, 0.12]}>
              <boxGeometry args={[0.13, 0.1, 0.05]} />
              <meshStandardMaterial color={i % 2 ? "#fff4f6" : "#ec88a8"} roughness={0.95} />
            </mesh>
          ))}
        </group>
      );
    case "bow-tie":
      return (
        <group position={[0, 0, 0.48]}>
          <Bow color="#cf5a86" scale={0.7} />
        </group>
      );
    case "pearls":
      return (
        <group position={[0, -0.04, 0]} rotation={[0.18, 0, 0]}>
          {Array.from({ length: 22 }, (_, i) => {
            const a = (i / 22) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.sin(a) * 0.51, 0, Math.cos(a) * 0.485]}>
                <sphereGeometry args={[0.04, 8, 6]} />
                <meshStandardMaterial color="#fde6ee" roughness={0.25} metalness={0.25} />
              </mesh>
            );
          })}
          <mesh position={[0, -0.07, 0.5]}>
            <sphereGeometry args={[0.065, 10, 8]} />
            <meshStandardMaterial color="#ffd0e0" roughness={0.2} metalness={0.3} />
          </mesh>
        </group>
      );
    case "ruffle-collar":
      return (
        <group>
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.sin(a) * 0.5, 0, Math.cos(a) * 0.48]} rotation={[0, a, 0.0]} scale={[1, 0.55, 0.45]}>
                <sphereGeometry args={[0.13, 10, 6]} />
                <meshStandardMaterial color="#fff6fa" roughness={0.9} />
              </mesh>
            );
          })}
          <group position={[0, 0.02, 0.56]}>
            <Bow color="#ec88a8" scale={0.55} />
          </group>
        </group>
      );
    case "flower-lei":
      return (
        <group rotation={[0.15, 0, 0]}>
          {Array.from({ length: 14 }, (_, i) => {
            const a = (i / 14) * Math.PI * 2;
            return <Blossom key={i} r={0.07} color={PETALS[(i * 2) % PETALS.length]} position={[Math.sin(a) * 0.5, 0, Math.cos(a) * 0.48]} />;
          })}
        </group>
      );
    default:
      return (
        <group position={[0, 0, 0.5]}>
          <Charm />
        </group>
      );
  }
}

function BackItem({ id }: { id: string }) {
  switch (id) {
    case "heart-wings":
      return <HeartWings />;
    case "backpack":
      return (
        <group position={[0, -0.04, -0.06]}>
          <mesh castShadow scale={[0.8, 0.95, 0.5]}>
            <sphereGeometry args={[0.36, 18, 14]} />
            <meshStandardMaterial color="#f8b79c" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.12, -0.08]} scale={[0.82, 0.5, 0.48]}>
            <sphereGeometry args={[0.36, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#ec88a8" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.02, -0.18]}>
            <boxGeometry args={[0.08, 0.06, 0.03]} />
            <meshStandardMaterial {...GOLD} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.24, 0.3, 0.3]} rotation={[0.25, 0, 0]}>
              <boxGeometry args={[0.06, 0.035, 0.56]} />
              <meshStandardMaterial color="#ec88a8" roughness={0.8} />
            </mesh>
          ))}
        </group>
      );
    case "fairy-wings":
      return <FairyWings />;
    case "heart-pack":
      return (
        <group position={[0, -0.02, -0.12]}>
          <group rotation={[0, Math.PI, 0]}>
            <Heart size={0.42} depth={0.2} color="#f6a6bf" />
          </group>
          <mesh position={[0, 0.02, -0.17]}>
            <sphereGeometry args={[0.06, 8, 6]} />
            <meshStandardMaterial color="#fff4f6" />
          </mesh>
          {[-1, 1].map((sd) => (
            <mesh key={sd} position={[sd * 0.24, 0.3, 0.34]} rotation={[0.25, 0, 0]}>
              <boxGeometry args={[0.06, 0.035, 0.56]} />
              <meshStandardMaterial color="#ec88a8" roughness={0.8} />
            </mesh>
          ))}
        </group>
      );
    case "cape":
      return (
        <group position={[0, -0.15, 0.45]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.44, 0.62, 0.78, 20, 1, true, Math.PI * 0.62, Math.PI * 0.76]} />
            <meshStandardMaterial color="#e7799e" roughness={0.7} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0.37, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.45, 0.035, 6, 24]} />
            <meshStandardMaterial {...GOLD} />
          </mesh>
        </group>
      );
    default:
      return (
        <group position={[0, 0.1, -0.05]}>
          <Charm />
        </group>
      );
  }
}

function HandItem({ id }: { id: string }) {
  switch (id) {
    case "star-wand":
      return (
        <group position={[0, 0.08, 0.02]}>
          <mesh position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.012, 0.014, 0.3, 6]} />
            <meshStandardMaterial color="#fff4f6" roughness={0.4} />
          </mesh>
          <group position={[0, 0.25, 0]}>
            <Star outer={0.075} inner={0.032} depth={0.025} color="#ffd86b" emissive={0.6} />
          </group>
        </group>
      );
    case "heart-balloon":
      return <HeartBalloon />;
    case "book":
      return (
        <group rotation={[0.2, -0.4, 0]}>
          <mesh>
            <boxGeometry args={[0.2, 0.26, 0.07]} />
            <meshStandardMaterial color="#b8a0ec" roughness={0.7} />
          </mesh>
          <mesh position={[0.012, 0, 0]}>
            <boxGeometry args={[0.18, 0.24, 0.055]} />
            <meshStandardMaterial color="#fffaf0" roughness={0.9} />
          </mesh>
        </group>
      );
    case "coffee":
      return (
        <group position={[0, 0.02, 0.02]}>
          <mesh>
            <cylinderGeometry args={[0.07, 0.06, 0.14, 14]} />
            <meshStandardMaterial color="#ffe3ec" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.071, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.062, 14]} />
            <meshStandardMaterial color="#8a5a3c" />
          </mesh>
          <mesh position={[0.08, 0, 0]}>
            <torusGeometry args={[0.035, 0.012, 6, 12]} />
            <meshStandardMaterial color="#ffe3ec" />
          </mesh>
          <Steam />
        </group>
      );
    case "quill":
      return (
        <group rotation={[0.3, 0, -0.5]}>
          <mesh position={[0, 0.2, 0]} scale={[1, 1, 0.3]}>
            <coneGeometry args={[0.055, 0.4, 8]} />
            <meshStandardMaterial color="#e9e1ff" roughness={0.8} />
          </mesh>
          <mesh position={[0, -0.01, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.015, 0.05, 6]} />
            <meshStandardMaterial color="#3b2f4a" />
          </mesh>
        </group>
      );
    case "wrench":
      return (
        <group rotation={[0.2, 0, -0.3]}>
          <mesh position={[0, 0.08, 0]}>
            <boxGeometry args={[0.04, 0.26, 0.025]} />
            <meshStandardMaterial color="#d6c2d6" metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.24, 0]} rotation={[0, 0, Math.PI * 0.3]}>
            <torusGeometry args={[0.05, 0.022, 6, 14, Math.PI * 1.55]} />
            <meshStandardMaterial color="#d6c2d6" metalness={0.6} roughness={0.35} />
          </mesh>
        </group>
      );
    case "parasol":
      return (
        <group position={[0, 0.05, 0.02]} rotation={[0.25, 0, 0.2]}>
          <mesh position={[0, 0.45, 0]}>
            <cylinderGeometry args={[0.015, 0.015, 1.0, 6]} />
            <meshStandardMaterial color="#c497b4" />
          </mesh>
          <mesh position={[0, 0.98, 0]}>
            <coneGeometry args={[0.55, 0.32, 10, 1, true]} />
            <meshStandardMaterial color="#ffc4d8" roughness={0.8} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0.83, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.55, 0.035, 6, 30]} />
            <meshStandardMaterial color="#fff6fa" roughness={0.9} />
          </mesh>
          <mesh position={[0, 1.17, 0]}>
            <sphereGeometry args={[0.04, 8, 6]} />
            <meshStandardMaterial color="#ec88a8" />
          </mesh>
        </group>
      );
    case "bouquet":
      return (
        <group position={[0, 0.06, 0.02]}>
          <mesh rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.09, 0.2, 10, 1, true]} />
            <meshStandardMaterial color="#ffd1e3" roughness={0.8} side={THREE.DoubleSide} />
          </mesh>
          {[
            [0, 0.12, 0],
            [0.06, 0.1, 0.03],
            [-0.06, 0.1, 0.02],
            [0.02, 0.1, -0.06],
            [-0.03, 0.15, 0.04],
          ].map((p, i) => (
            <Blossom key={i} r={0.045} color={PETALS[i]} position={p as [number, number, number]} />
          ))}
        </group>
      );
    default:
      return <Charm />;
  }
}

/** Neutral fallback for item ids this theme has no model for. */
function Charm() {
  return (
    <mesh>
      <octahedronGeometry args={[0.07, 0]} />
      <meshStandardMaterial color="#ffd86b" emissive="#ffd86b" emissiveIntensity={0.3} />
    </mesh>
  );
}

/** Wearable for a non-hand slot, placed at its anchor (render inside the body group). */
export function Wearable({ slot, id }: { slot: Exclude<WearableSlot, "hand">; id: string }) {
  const Item = slot === "head" ? HeadItem : slot === "eyes" ? EyesItem : slot === "neck" ? NeckItem : BackItem;
  return (
    <group position={ANCHORS[slot]}>
      <Item id={id} />
    </group>
  );
}

/** Hand item (render inside the right arm group). */
export function HeldItem({ id }: { id: string }) {
  return (
    <group position={HAND_ANCHOR}>
      <HandItem id={id} />
    </group>
  );
}
