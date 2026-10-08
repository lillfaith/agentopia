import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BuildingProps } from "../../theme-engine/types";

/** Triangular gable roof: width along x, height up, depth along z. */
function Gable({ w, h, d, color, position }: { w: number; h: number; d: number; color: string; position: [number, number, number] }) {
  const geom = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(0, h);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    return g;
  }, [w, h, d]);
  return (
    <mesh geometry={geom} position={position} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
  );
}

function Window({ position, glow, size = [0.5, 0.6] }: { position: [number, number, number]; glow: number; size?: [number, number] }) {
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[size[0] + 0.12, size[1] + 0.12, 0.06]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 0, 0.035]}>
        <planeGeometry args={size} />
        <meshStandardMaterial color="#bfe6ff" emissive="#ffd98a" emissiveIntensity={glow * 1.6} />
      </mesh>
    </group>
  );
}

function Door({ z, color, h = 1.2 }: { z: number; color: string; h?: number }) {
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[0.8, h, 0.08]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, h, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.4, 0.4, 0.08, 20, 1, false, -Math.PI / 2, Math.PI]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0.25, h * 0.5, 0.06]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color="#ffe08a" metalness={0.4} />
      </mesh>
    </group>
  );
}

function Plot({ color, selected, hovered }: { color: string; selected: boolean; hovered: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(clock.elapsedTime * 4) * 0.25;
  });
  return (
    <group>
      <mesh receiveShadow position={[0, 0.05, 0.3]}>
        <boxGeometry args={[6.4, 0.1, 6.8]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      {(selected || hovered) && (
        <mesh ref={ring} position={[0, 0.12, 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[4.3, 4.6, 48]} />
          <meshBasicMaterial color={selected ? "#ff8fb8" : "#ffffff"} transparent opacity={0.6} />
        </mesh>
      )}
    </group>
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

// ───────────────────────── Town Hall (hq) ─────────────────────────

function TownHall({ glow, activity }: { glow: number; activity: number }) {
  const flag = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (flag.current) flag.current.rotation.y = Math.sin(clock.elapsedTime * 2.2) * 0.35;
  });
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 1.4, 0]}>
        <boxGeometry args={[4.2, 2.8, 3.2]} />
        <meshStandardMaterial color="#ffc8dd" roughness={0.75} />
      </mesh>
      <mesh position={[0, 2.86, 0]}>
        <boxGeometry args={[4.4, 0.14, 3.4]} />
        <meshStandardMaterial color="#fff3f8" />
      </mesh>
      <Gable w={4.4} h={1.5} d={3.4} color="#c9b6ff" position={[0, 2.92, 0]} />
      {/* clock on the gable */}
      <group position={[0, 3.55, 1.72]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.42, 0.42, 0.06, 28]} />
          <meshStandardMaterial color="#fffaf0" emissive="#ffe8a8" emissiveIntensity={glow * 0.8} />
        </mesh>
        <mesh position={[0.08, 0.1, 0.04]} rotation={[0, 0, -0.6]}>
          <boxGeometry args={[0.04, 0.28, 0.02]} />
          <meshStandardMaterial color="#7a5c8f" />
        </mesh>
      </group>
      {/* towers */}
      {[-1.9, 1.9].map((x) => (
        <group key={x} position={[x, 0, -1.1]}>
          <mesh castShadow position={[0, 1.9, 0]}>
            <cylinderGeometry args={[0.72, 0.78, 3.8, 20]} />
            <meshStandardMaterial color="#fff1e6" roughness={0.7} />
          </mesh>
          <mesh castShadow position={[0, 4.4, 0]}>
            <coneGeometry args={[0.95, 1.6, 20]} />
            <meshStandardMaterial color="#b9a2ff" roughness={0.6} />
          </mesh>
          <Window position={[0, 2.6, 0.74]} glow={glow} size={[0.32, 0.5]} />
        </group>
      ))}
      <group position={[1.9, 5.2, -1.1]}>
        <mesh>
          <cylinderGeometry args={[0.03, 0.03, 0.9, 6]} />
          <meshStandardMaterial color="#9a86c9" />
        </mesh>
        <mesh ref={flag} position={[0.28, 0.25, 0]}>
          <boxGeometry args={[0.55, 0.32, 0.02]} />
          <meshStandardMaterial color="#ff8fb8" side={THREE.DoubleSide} />
        </mesh>
      </group>
      <Door z={1.62} color="#e889b0" h={1.4} />
      <Window position={[-1.35, 1.6, 1.62]} glow={Math.max(glow, activity ? 0.4 : 0)} />
      <Window position={[1.35, 1.6, 1.62]} glow={Math.max(glow, activity ? 0.4 : 0)} />
      {/* steps */}
      <mesh receiveShadow position={[0, 0.12, 2.0]}>
        <boxGeometry args={[1.6, 0.14, 0.6]} />
        <meshStandardMaterial color="#fff3f8" />
      </mesh>
    </group>
  );
}

// ───────────────────────── Observatory (research) ─────────────────────────

function Observatory({ glow, activity }: { glow: number; activity: number }) {
  const scope = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (scope.current) scope.current.rotation.y = activity ? clock.elapsedTime * 0.6 : Math.sin(clock.elapsedTime * 0.2) * 0.4;
  });
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 1.2, 0]}>
        <cylinderGeometry args={[2.0, 2.15, 2.4, 32]} />
        <meshStandardMaterial color="#bdeee0" roughness={0.75} />
      </mesh>
      <mesh position={[0, 2.45, 0]}>
        <cylinderGeometry args={[2.1, 2.1, 0.14, 32]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh castShadow position={[0, 3.2, 0]}>
        <cylinderGeometry args={[1.65, 1.8, 1.4, 32]} />
        <meshStandardMaterial color="#fffaf3" roughness={0.7} />
      </mesh>
      <group ref={scope} position={[0, 3.9, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[1.66, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#a9c8ff" roughness={0.4} metalness={0.1} />
        </mesh>
        <mesh position={[0, 0.7, 0.9]} rotation={[-0.9, 0, 0]} castShadow>
          <cylinderGeometry args={[0.22, 0.3, 1.8, 16]} />
          <meshStandardMaterial color="#8a7dd8" metalness={0.3} roughness={0.4} />
        </mesh>
        <mesh position={[0, 1.63, 0]}>
          <octahedronGeometry args={[0.22, 0]} />
          <meshStandardMaterial color="#ffe58a" emissive="#ffd84a" emissiveIntensity={0.4 + glow} />
        </mesh>
      </group>
      <Door z={2.07} color="#7fc8b4" h={1.3} />
      {[-0.9, 0.9].map((a) => (
        <Window key={a} position={[Math.sin(a) * 1.82, 3.25, Math.cos(a) * 1.82]} glow={Math.max(glow, activity ? 0.5 : 0)} size={[0.36, 0.45]} />
      ))}
      {/* tiny orbiting moon when researching */}
      {activity > 0 && <Orbiter />}
    </group>
  );
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

// ───────────────────────── Inkwell Studio (studio) ─────────────────────────

function InkStudio({ glow, activity }: { glow: number; activity: number }) {
  const quill = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (quill.current) quill.current.rotation.z = -0.35 + Math.sin(clock.elapsedTime * (activity ? 6 : 1.2)) * (activity ? 0.12 : 0.05);
  });
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 1.15, 0]}>
        <boxGeometry args={[3.8, 2.3, 3.0]} />
        <meshStandardMaterial color="#fff1b8" roughness={0.75} />
      </mesh>
      <Gable w={4.3} h={2.0} d={3.4} color="#ff9fae" position={[0, 2.3, 0]} />
      <mesh castShadow position={[1.1, 3.6, -0.6]}>
        <boxGeometry args={[0.5, 1.2, 0.5]} />
        <meshStandardMaterial color="#f2a0a8" />
      </mesh>
      <group position={[1.1, 4.25, -0.6]}>
        <Smoke active={activity > 0} />
      </group>
      <Door z={1.52} color="#f08ca0" />
      <Window position={[-1.1, 1.4, 1.52]} glow={Math.max(glow, activity ? 0.5 : 0)} />
      <Window position={[1.1, 1.4, 1.52]} glow={Math.max(glow, activity ? 0.5 : 0)} />
      <Window position={[0, 3.1, 1.72]} glow={glow} size={[0.42, 0.42]} />
      {/* giant quill in an inkpot */}
      <group position={[-2.35, 0, 1.4]}>
        <mesh castShadow position={[0, 0.35, 0]}>
          <cylinderGeometry args={[0.38, 0.45, 0.7, 20]} />
          <meshStandardMaterial color="#6f7fd8" roughness={0.3} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.72, 0]}>
          <cylinderGeometry args={[0.22, 0.3, 0.12, 16]} />
          <meshStandardMaterial color="#4b57b0" />
        </mesh>
        <group ref={quill} position={[0, 0.7, 0]}>
          <mesh castShadow position={[0.0, 1.1, 0]} scale={[0.32, 1.25, 0.08]}>
            <sphereGeometry args={[1, 16, 12]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0, 0.9, 0.05]} scale={[0.06, 1.3, 0.06]}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshStandardMaterial color="#ffb3c7" />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// ───────────────────────── Workshop (engineering) ─────────────────────────

function Gear({ radius, teeth, color, speed, position, rotation = [0, 0, 0] }: { radius: number; teeth: number; color: string; speed: number; position: [number, number, number]; rotation?: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.z += dt * speed;
  });
  return (
    <group position={position} rotation={rotation}>
      <group ref={ref}>
        <mesh castShadow>
          <cylinderGeometry args={[radius, radius, 0.16, 24]} />
          <meshStandardMaterial color={color} metalness={0.3} roughness={0.4} />
        </mesh>
        {Array.from({ length: teeth }, (_, i) => {
          const a = (i / teeth) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * radius, 0, Math.sin(a) * radius]} rotation={[0, -a, 0]}>
              <boxGeometry args={[0.22, 0.16, 0.18]} />
              <meshStandardMaterial color={color} metalness={0.3} roughness={0.4} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

function Workshop({ glow, activity }: { glow: number; activity: number }) {
  const spin = activity ? 2.2 : 0.35;
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 1.2, 0]}>
        <boxGeometry args={[4.0, 2.4, 3.2]} />
        <meshStandardMaterial color="#c8f0d8" roughness={0.75} />
      </mesh>
      {/* saw-tooth factory roof */}
      {[-1.0, 1.0].map((x) => (
        <Gable key={x} w={2.1} h={1.1} d={3.4} color="#7fc8a9" position={[x, 2.4, 0]} />
      ))}
      <mesh castShadow position={[-1.4, 3.6, -0.9]}>
        <cylinderGeometry args={[0.22, 0.26, 1.4, 12]} />
        <meshStandardMaterial color="#e3b3c9" />
      </mesh>
      <group position={[-1.4, 4.35, -0.9]}>
        <Smoke active={activity > 0} />
      </group>
      {/* big gears on the facade */}
      <Gear radius={0.55} teeth={10} color="#ffd86b" speed={spin} position={[1.15, 1.75, 1.62]} rotation={[Math.PI / 2, 0, 0]} />
      <Gear radius={0.35} teeth={8} color="#ff9fb8" speed={-spin * 1.5} position={[1.85, 1.1, 1.62]} rotation={[Math.PI / 2, 0, 0]} />
      <Door z={1.62} color="#6fb396" />
      <Window position={[-1.2, 1.5, 1.62]} glow={Math.max(glow, activity ? 0.5 : 0)} />
      {/* a little terminal screen outside */}
      <group position={[-2.6, 0, 1.2]}>
        <mesh castShadow position={[0, 0.45, 0]}>
          <boxGeometry args={[0.5, 0.9, 0.4]} />
          <meshStandardMaterial color="#b9a2ff" />
        </mesh>
        <mesh position={[0, 0.6, 0.21]}>
          <planeGeometry args={[0.36, 0.3]} />
          <meshStandardMaterial color="#1f2a44" emissive="#7cf0b0" emissiveIntensity={activity ? 1.2 : 0.3} />
        </mesh>
      </group>
    </group>
  );
}

// ───────────────────────── Glass atelier (design) ─────────────────────────

function Atelier({ glow, activity }: { glow: number; activity: number }) {
  const brush = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (brush.current) brush.current.rotation.z = Math.sin(clock.elapsedTime * (activity ? 5 : 1)) * 0.35;
  });
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.5, 0]}>
        <boxGeometry args={[4.0, 1.0, 3.2]} />
        <meshStandardMaterial color="#ffe1ef" roughness={0.8} />
      </mesh>
      {/* glass greenhouse body */}
      <mesh castShadow position={[0, 1.75, 0]}>
        <boxGeometry args={[3.8, 1.5, 3.0]} />
        <meshStandardMaterial color="#d6f4ff" transparent opacity={0.45} roughness={0.1} metalness={0.1} emissive="#ffe8a8" emissiveIntensity={glow * 0.5 + (activity ? 0.2 : 0)} />
      </mesh>
      <Gable w={4.0} h={1.1} d={3.2} color="#bfe9ff" position={[0, 2.5, 0]} />
      {/* frame */}
      {[-1.9, 0, 1.9].map((x) => (
        <mesh key={x} position={[x, 1.75, 1.52]}>
          <boxGeometry args={[0.08, 1.5, 0.08]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
      ))}
      <Door z={1.62} color="#ff9fb8" />
      {/* easel with a painting */}
      <group position={[-2.5, 0, 1.3]} rotation={[0, 0.5, 0]}>
        {[-0.3, 0.3].map((x) => (
          <mesh key={x} position={[x, 0.7, 0]} rotation={[0.15, 0, x > 0 ? -0.12 : 0.12]}>
            <boxGeometry args={[0.06, 1.4, 0.06]} />
            <meshStandardMaterial color="#d9a37a" />
          </mesh>
        ))}
        <mesh position={[0, 1.05, 0.05]} rotation={[0.15, 0, 0]}>
          <boxGeometry args={[0.8, 0.6, 0.04]} />
          <meshStandardMaterial color="#fffaf0" />
        </mesh>
        {["#ff8fb8", "#9bf6ff", "#ffd86b"].map((c, i) => (
          <mesh key={c} position={[-0.2 + i * 0.2, 1.05 + (i % 2) * 0.1, 0.09]} rotation={[0.15, 0, 0]}>
            <circleGeometry args={[0.1, 16]} />
            <meshStandardMaterial color={c} />
          </mesh>
        ))}
        <group ref={brush} position={[0.45, 1.0, 0.15]}>
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.45, 6]} />
            <meshStandardMaterial color="#8a7dd8" />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// ───────────────────────── Crystal lab (3D / experiments) ─────────────────────────

function CrystalLab({ glow, activity }: { glow: number; activity: number }) {
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
      <mesh castShadow receiveShadow position={[0, 0.6, 0]}>
        <cylinderGeometry args={[2.2, 2.4, 1.2, 8]} />
        <meshStandardMaterial color="#e6dcff" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[0, 2.2, 0]}>
        <icosahedronGeometry args={[1.9, 1]} />
        <meshStandardMaterial color="#c9b6ff" roughness={0.25} metalness={0.15} flatShading transparent opacity={0.9} emissive="#a58cff" emissiveIntensity={0.1 + glow * 0.4 + (activity ? 0.25 : 0)} />
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
      <group position={[0, 0, 2.1]}>
        <Door z={0} color="#a58cff" />
      </group>
    </group>
  );
}

// ───────────────────────── fallback ─────────────────────────

function GenericHouse({ glow, seed }: { glow: number; seed: string }) {
  const hue = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const wall = `hsl(${hue}, 80%, 88%)`;
  const roof = `hsl(${(hue + 40) % 360}, 75%, 75%)`;
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 1.1, 0]}>
        <boxGeometry args={[3.4, 2.2, 3]} />
        <meshStandardMaterial color={wall} />
      </mesh>
      <mesh castShadow position={[0, 2.95, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[2.7, 1.5, 4]} />
        <meshStandardMaterial color={roof} />
      </mesh>
      <Door z={1.52} color={roof} />
      <Window position={[1.0, 1.4, 1.52]} glow={glow} />
    </group>
  );
}

const PLOT_COLORS: Record<string, string> = { hq: "#ffe3ef", research: "#dff6f0", studio: "#fff6d6", workshop: "#e2f7ea", atelier: "#ffeaf3", lab: "#eee8ff" };
const KNOWN_KINDS = new Set(["hq", "research", "studio", "workshop", "atelier", "lab"]);

export function PastelBuilding({ building, glow, hovered, selected, activity }: BuildingProps) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!group.current) return;
    const target = hovered ? 1.04 : 1;
    const s = group.current.scale.x + (target - group.current.scale.x) * Math.min(1, dt * 10);
    group.current.scale.setScalar(s);
  });
  return (
    <group>
      <Plot color={PLOT_COLORS[building.kind] ?? "#f3ecff"} selected={selected} hovered={hovered} />
      <group ref={group}>
        {building.kind === "hq" && <TownHall glow={glow} activity={activity} />}
        {building.kind === "research" && <Observatory glow={glow} activity={activity} />}
        {building.kind === "studio" && <InkStudio glow={glow} activity={activity} />}
        {building.kind === "workshop" && <Workshop glow={glow} activity={activity} />}
        {building.kind === "atelier" && <Atelier glow={glow} activity={activity} />}
        {building.kind === "lab" && <CrystalLab glow={glow} activity={activity} />}
        {!KNOWN_KINDS.has(building.kind) && <GenericHouse glow={glow} seed={building.id} />}
      </group>
    </group>
  );
}
