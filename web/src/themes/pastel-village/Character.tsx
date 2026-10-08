import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CharacterProps } from "../../theme-engine/types";

function lighten(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color("#ffffff"), amount);
  return `#${c.getHexString()}`;
}

function Accessory({ kind, color }: { kind: string; color: string }) {
  switch (kind) {
    case "crown":
      return (
        <group position={[0, 1.22, 0]}>
          <mesh>
            <cylinderGeometry args={[0.22, 0.25, 0.14, 16, 1, true]} />
            <meshStandardMaterial color="#ffd86b" metalness={0.5} roughness={0.3} side={THREE.DoubleSide} />
          </mesh>
          {[0, 1, 2, 3, 4].map((i) => {
            const a = (i / 5) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.22, 0.12, Math.sin(a) * 0.22]}>
                <coneGeometry args={[0.05, 0.13, 6]} />
                <meshStandardMaterial color="#ffd86b" metalness={0.5} roughness={0.3} />
              </mesh>
            );
          })}
          <mesh position={[0, 0.02, 0.24]}>
            <sphereGeometry args={[0.04, 8, 8]} />
            <meshStandardMaterial color="#ff8fb8" emissive="#ff8fb8" emissiveIntensity={0.4} />
          </mesh>
        </group>
      );
    case "goggles":
      return (
        <group position={[0, 1.0, 0.05]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.47, 0.035, 8, 32]} />
            <meshStandardMaterial color="#8a7dd8" />
          </mesh>
          {[-0.17, 0.17].map((x) => (
            <group key={x} position={[x, 0.02, 0.43]}>
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.11, 0.035, 8, 20]} />
                <meshStandardMaterial color="#ffd86b" metalness={0.4} roughness={0.3} />
              </mesh>
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.1, 20]} />
                <meshStandardMaterial color="#c8f1ff" transparent opacity={0.7} side={THREE.DoubleSide} />
              </mesh>
            </group>
          ))}
        </group>
      );
    case "beret":
      return (
        <group position={[0.06, 1.18, 0]} rotation={[0, 0, -0.25]}>
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
    case "none":
      return null;
    default:
      // Unknown accessory keyword → a little sprout, so custom agents still look intentional.
      return (
        <group position={[0, 1.2, 0]}>
          <mesh position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.14, 6]} />
            <meshStandardMaterial color="#7cc47f" />
          </mesh>
          <mesh position={[0.07, 0.13, 0]} scale={[1, 0.4, 0.6]}>
            <sphereGeometry args={[0.09, 10, 8]} />
            <meshStandardMaterial color={lighten(color, 0.1)} />
          </mesh>
        </group>
      );
  }
}

/** Floating icons above the head that make the state readable from far away. */
function StateProp({ anim, carrying }: { anim: CharacterProps["anim"]; carrying: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.y = 1.75 + Math.sin(clock.elapsedTime * 3) * 0.06;
    ref.current.rotation.y = clock.elapsedTime * 1.5;
  });
  if (carrying || anim === "carry") {
    return (
      <group position={[0, 1.55, 0.25]}>
        {/* a sealed scroll/envelope being delivered */}
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.1, 0.1, 0.5, 12]} />
          <meshStandardMaterial color="#fff6e0" />
        </mesh>
        <mesh position={[0, 0, 0.1]}>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial color="#ff6f91" />
        </mesh>
      </group>
    );
  }
  if (anim === "wait") {
    return (
      <group ref={ref}>
        <mesh position={[0, 0.12, 0]}>
          <boxGeometry args={[0.09, 0.28, 0.09]} />
          <meshStandardMaterial color="#ffb020" emissive="#ffb020" emissiveIntensity={0.6} />
        </mesh>
        <mesh position={[0, -0.12, 0]}>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial color="#ffb020" emissive="#ffb020" emissiveIntensity={0.6} />
        </mesh>
      </group>
    );
  }
  if (anim === "sad") {
    return (
      <group position={[0, 1.85, 0]}>
        {[
          [0, 0, 0, 0.2],
          [0.18, -0.03, 0, 0.15],
          [-0.17, -0.04, 0, 0.14],
        ].map(([x, y, z, r], i) => (
          <mesh key={i} position={[x, y, z]}>
            <sphereGeometry args={[r, 10, 8]} />
            <meshStandardMaterial color="#9aa0b8" />
          </mesh>
        ))}
      </group>
    );
  }
  if (anim === "think") {
    return (
      <group ref={ref}>
        {[-0.14, 0, 0.14].map((x, i) => (
          <mesh key={i} position={[x, 0, 0]}>
            <sphereGeometry args={[0.045, 8, 8]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.3} />
          </mesh>
        ))}
      </group>
    );
  }
  return null;
}

function WorkSparkles({ color }: { color: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    g.children.forEach((c, i) => {
      const t = clock.elapsedTime * 2 + i * 1.3;
      c.position.set(Math.cos(t) * 0.75, 0.5 + ((t * 0.3) % 1) * 0.9, Math.sin(t) * 0.75);
      c.rotation.set(t, t, 0);
    });
  });
  return (
    <group ref={ref}>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i}>
          <octahedronGeometry args={[0.06, 0]} />
          <meshStandardMaterial color={lighten(color, 0.4)} emissive={color} emissiveIntensity={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Confetti() {
  const ref = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const bits = useMemo(
    () => Array.from({ length: 14 }, (_, i) => ({ a: (i / 14) * Math.PI * 2, v: 1.4 + (i % 4) * 0.35, c: ["#ff8fb8", "#ffd86b", "#9bf6ff", "#caffbf", "#bdb2ff"][i % 5] })),
    [],
  );
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    if (start.current === null) start.current = clock.elapsedTime;
    const t = (clock.elapsedTime - start.current) % 2.2;
    g.children.forEach((c, i) => {
      const b = bits[i];
      c.position.set(Math.cos(b.a) * t * 0.9, 1.2 + b.v * t - 2.2 * t * t, Math.sin(b.a) * t * 0.9);
      c.rotation.set(t * 8, t * 5, 0);
    });
  });
  return (
    <group ref={ref}>
      {bits.map((b, i) => (
        <mesh key={i}>
          <planeGeometry args={[0.09, 0.05]} />
          <meshStandardMaterial color={b.c} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

export function PastelCharacter({ color, accessory, anim, moving, carrying, selected, hovered }: CharacterProps) {
  const body = useRef<THREE.Group>(null);
  const leftFoot = useRef<THREE.Mesh>(null);
  const rightFoot = useRef<THREE.Mesh>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const phase = useMemo(() => Math.random() * 10, []);
  const sad = anim === "sad";
  const bodyColor = sad ? lighten("#a3a8bf", 0.2) : color;
  const belly = lighten(bodyColor, 0.55);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + phase;
    const b = body.current;
    if (!b) return;
    let y = 0;
    let sx = 1;
    let sy = 1;
    let tilt = 0;
    let spin = 0;
    let foot = 0;
    let arm = 0;
    if (moving) {
      y = Math.abs(Math.sin(t * 9)) * 0.14;
      foot = Math.sin(t * 9) * 0.5;
      arm = Math.sin(t * 9) * 0.6;
      tilt = 0.08;
      if (carrying) arm = -1.2;
    } else {
      switch (anim) {
        case "work":
          y = Math.abs(Math.sin(t * 12)) * 0.06;
          arm = Math.sin(t * 14) * 0.9;
          sy = 1 + Math.sin(t * 12) * 0.03;
          break;
        case "think":
          tilt = Math.sin(t * 1.5) * 0.12;
          sy = 1 + Math.sin(t * 2) * 0.02;
          break;
        case "wait":
          tilt = Math.sin(t * 2.2) * 0.08;
          arm = -0.6 + Math.sin(t * 4) * 0.2;
          break;
        case "celebrate":
          y = Math.abs(Math.sin(t * 5)) * 0.5;
          spin = t * 4;
          arm = -2.2;
          break;
        case "sad":
          sy = 0.92;
          sx = 1.05;
          tilt = 0.15;
          break;
        case "carry":
          arm = -1.2;
          break;
        default:
          sy = 1 + Math.sin(t * 2) * 0.03;
          sx = 1 - Math.sin(t * 2) * 0.015;
      }
    }
    b.position.y += (y - b.position.y) * Math.min(1, dt * 18);
    b.scale.set(sx, sy, sx);
    b.rotation.x = tilt;
    b.rotation.y = anim === "celebrate" && !moving ? spin : b.rotation.y * 0.85;
    if (leftFoot.current) leftFoot.current.position.z = 0.08 + foot * 0.25;
    if (rightFoot.current) rightFoot.current.position.z = 0.08 - foot * 0.25;
    if (leftArm.current) leftArm.current.rotation.x = arm;
    if (rightArm.current) rightArm.current.rotation.x = anim === "work" && !moving ? -arm : -arm * (carrying || anim === "celebrate" ? -1 : 1);
    if (ring.current) ring.current.rotation.z = t * 1.5;
  });

  return (
    <group scale={hovered ? 1.45 : 1.35}>
      {selected && (
        <mesh ref={ring} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.62, 0.76, 32, 1, 0, Math.PI * 1.7]} />
          <meshBasicMaterial color="#ff8fb8" transparent opacity={0.9} />
        </mesh>
      )}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.45, 24]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.12} depthWrite={false} />
      </mesh>
      <mesh ref={leftFoot} castShadow position={[-0.18, 0.08, 0.08]} scale={[1, 0.6, 1.3]}>
        <sphereGeometry args={[0.13, 12, 10]} />
        <meshStandardMaterial color={bodyColor} roughness={0.7} />
      </mesh>
      <mesh ref={rightFoot} castShadow position={[0.18, 0.08, 0.08]} scale={[1, 0.6, 1.3]}>
        <sphereGeometry args={[0.13, 12, 10]} />
        <meshStandardMaterial color={bodyColor} roughness={0.7} />
      </mesh>
      <group ref={body}>
        <mesh castShadow position={[0, 0.62, 0]} scale={[1, 1.08, 0.95]}>
          <sphereGeometry args={[0.5, 28, 22]} />
          <meshStandardMaterial color={bodyColor} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.5, 0.33]} scale={[0.75, 0.7, 0.4]}>
          <sphereGeometry args={[0.42, 20, 16]} />
          <meshStandardMaterial color={belly} roughness={0.6} />
        </mesh>
        {/* face */}
        {[-0.16, 0.16].map((x) => (
          <group key={x} position={[x, 0.78, 0.43]}>
            <mesh scale={sad ? [1, 0.45, 1] : [1, 1.2, 1]}>
              <sphereGeometry args={[0.065, 12, 10]} />
              <meshStandardMaterial color="#3b2f4a" roughness={0.3} />
            </mesh>
            <mesh position={[0.02, 0.03, 0.05]}>
              <sphereGeometry args={[0.02, 8, 6]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
          </group>
        ))}
        {[-0.3, 0.3].map((x) => (
          <mesh key={x} position={[x, 0.64, 0.38]} rotation={[0, x * 1.2, 0]}>
            <circleGeometry args={[0.07, 16]} />
            <meshBasicMaterial color="#ff9fb8" transparent opacity={0.7} />
          </mesh>
        ))}
        <mesh position={[0, 0.66, 0.47]} rotation={[0, 0, sad ? 0 : Math.PI]}>
          <torusGeometry args={[0.05, 0.014, 6, 12, Math.PI]} />
          <meshBasicMaterial color="#3b2f4a" />
        </mesh>
        {/* arms pivot at the shoulder so rotation swings the hand */}
        <group ref={leftArm} position={[-0.44, 0.76, 0]}>
          <mesh castShadow position={[-0.04, -0.17, 0]} scale={[1, 1.25, 1]}>
            <sphereGeometry args={[0.1, 10, 8]} />
            <meshStandardMaterial color={bodyColor} roughness={0.6} />
          </mesh>
        </group>
        <group ref={rightArm} position={[0.44, 0.76, 0]}>
          <mesh castShadow position={[0.04, -0.17, 0]} scale={[1, 1.25, 1]}>
            <sphereGeometry args={[0.1, 10, 8]} />
            <meshStandardMaterial color={bodyColor} roughness={0.6} />
          </mesh>
        </group>
        <Accessory kind={accessory} color={color} />
      </group>
      <StateProp anim={anim} carrying={carrying} />
      {anim === "work" && !moving && <WorkSparkles color={color} />}
      {anim === "celebrate" && !moving && <Confetti />}
    </group>
  );
}
