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

const PETALS = ["#ff9fc4", "#ffd1e3", "#bfe3ff", "#d8c8ff", "#fff1a8", "#c9f5d4"];

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
      <meshStandardMaterial color="#cdf3ff" emissive="#a8e8ff" emissiveIntensity={0.35} transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} />
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
            <meshStandardMaterial color="#8fd3c1" roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.96, 1]}>
            <torusGeometry args={[0.39, 0.065, 8, 28]} />
            <meshStandardMaterial color="#6fbfab" roughness={0.95} />
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
            <meshStandardMaterial color="#5b5f7a" roughness={0.4} />
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
    case "goggles":
      return (
        <group position={[0, 0.2, -0.44]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.95, 1]}>
            <torusGeometry args={[0.37, 0.03, 8, 32]} />
            <meshStandardMaterial color="#8a7dd8" />
          </mesh>
          {[-0.13, 0.13].map((x) => (
            <group key={x} position={[x, 0.03, 0.33]} rotation={[-0.55, x * 1.4, 0]}>
              <mesh>
                <cylinderGeometry args={[0.1, 0.1, 0.06, 18]} />
                <meshStandardMaterial color="#c99a45" metalness={0.6} roughness={0.3} />
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
    case "scarf":
      return (
        <group>
          <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.95, 1]}>
            <torusGeometry args={[0.5, 0.075, 10, 32]} />
            <meshStandardMaterial color="#ff8f8f" roughness={0.95} />
          </mesh>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[0.2 + i * 0.012, -0.1 - i * 0.1, 0.47]} rotation={[0.1, 0, 0.12]}>
              <boxGeometry args={[0.13, 0.1, 0.05]} />
              <meshStandardMaterial color={i % 2 ? "#fff2d6" : "#ff8f8f"} roughness={0.95} />
            </mesh>
          ))}
        </group>
      );
    case "bow-tie":
      return (
        <group position={[0, 0, 0.48]}>
          <Bow color="#5b8def" scale={0.7} />
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
    case "backpack":
      return (
        <group position={[0, -0.04, -0.06]}>
          <mesh castShadow scale={[0.8, 0.95, 0.5]}>
            <sphereGeometry args={[0.36, 18, 14]} />
            <meshStandardMaterial color="#f2a65a" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.12, -0.08]} scale={[0.82, 0.5, 0.48]}>
            <sphereGeometry args={[0.36, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#d9853b" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.02, -0.18]}>
            <boxGeometry args={[0.08, 0.06, 0.03]} />
            <meshStandardMaterial {...GOLD} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.24, 0.3, 0.3]} rotation={[0.25, 0, 0]}>
              <boxGeometry args={[0.06, 0.035, 0.56]} />
              <meshStandardMaterial color="#d9853b" roughness={0.8} />
            </mesh>
          ))}
        </group>
      );
    case "fairy-wings":
      return <FairyWings />;
    case "cape":
      return (
        <group position={[0, -0.15, 0.45]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.44, 0.62, 0.78, 20, 1, true, Math.PI * 0.62, Math.PI * 0.76]} />
            <meshStandardMaterial color="#e2556f" roughness={0.7} side={THREE.DoubleSide} />
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
    case "book":
      return (
        <group rotation={[0.2, -0.4, 0]}>
          <mesh>
            <boxGeometry args={[0.2, 0.26, 0.07]} />
            <meshStandardMaterial color="#6f8fe6" roughness={0.7} />
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
            <meshStandardMaterial color="#fff6ea" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.071, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.062, 14]} />
            <meshStandardMaterial color="#8a5a3c" />
          </mesh>
          <mesh position={[0.08, 0, 0]}>
            <torusGeometry args={[0.035, 0.012, 6, 12]} />
            <meshStandardMaterial color="#fff6ea" />
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
            <meshStandardMaterial color="#b9c2d6" metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.24, 0]} rotation={[0, 0, Math.PI * 0.3]}>
            <torusGeometry args={[0.05, 0.022, 6, 14, Math.PI * 1.55]} />
            <meshStandardMaterial color="#b9c2d6" metalness={0.6} roughness={0.35} />
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
