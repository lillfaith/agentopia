import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Appearance, EarStyle, EyeStyle, Expression, TailStyle } from "../../../../shared/cosmetics";
import type { CharacterAnim, CharacterProps } from "../../theme-engine/types";
import { HeldItem, HIDES_EARS, Wearable } from "./wearables";

const INK = "#3b2f4a";

function lighten(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color("#ffffff"), amount);
  return `#${c.getHexString()}`;
}

function darken(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color("#2a2140"), amount);
  return `#${c.getHexString()}`;
}

// ───────────── face ─────────────

type EyeLook = EyeStyle | "closed" | "worried" | "wide";
type MouthLook = Expression | "frown" | "open";
type Brows = "none" | "worried" | "focused";

/**
 * The resting face comes from the villager's appearance; real states temporarily
 * change it (worried on a failed task, a grin on a completed one, closed eyes asleep).
 */
export function faceFor(anim: CharacterAnim, a: Pick<Appearance, "eyes" | "expression">): { eyes: EyeLook; mouth: MouthLook; brows: Brows } {
  switch (anim) {
    case "sleep":
      return { eyes: "closed", mouth: "calm", brows: "none" };
    case "rest":
      return { eyes: "sleepy", mouth: a.expression === "surprised" ? "smile" : a.expression, brows: "none" };
    case "celebrate":
      return { eyes: "happy", mouth: "grin", brows: "none" };
    case "confused":
      return { eyes: "worried", mouth: "frown", brows: "worried" };
    case "wait":
      return { eyes: "wide", mouth: "surprised", brows: "worried" };
    case "think":
      return { eyes: a.eyes === "happy" ? "round" : a.eyes, mouth: "calm", brows: "focused" };
    case "work":
    case "sit-work":
    case "read":
    case "write":
      return { eyes: a.eyes, mouth: a.expression === "grin" ? "smile" : a.expression, brows: "focused" };
    case "converse":
      return { eyes: a.eyes, mouth: "open", brows: "none" };
    default:
      return { eyes: a.eyes, mouth: a.expression, brows: "none" };
  }
}

function Highlight({ r, position }: { r: number; position: [number, number, number] }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[r, 8, 6]} />
      <meshBasicMaterial color="#ffffff" />
    </mesh>
  );
}

function Arc({ r, up, tube = 0.016 }: { r: number; up: boolean; tube?: number }) {
  return (
    <mesh rotation={[0, 0, up ? 0 : Math.PI]}>
      <torusGeometry args={[r, tube, 6, 14, Math.PI]} />
      <meshBasicMaterial color={INK} />
    </mesh>
  );
}

function Eye({ look, side }: { look: EyeLook; side: -1 | 1 }) {
  const style = look === "wink" ? (side === 1 ? "happy" : "round") : look;
  switch (style) {
    case "sparkle":
      return (
        <group>
          <mesh scale={[1, 1.25, 1]}>
            <sphereGeometry args={[0.078, 14, 10]} />
            <meshStandardMaterial color={INK} roughness={0.25} />
          </mesh>
          <Highlight r={0.026} position={[0.025, 0.04, 0.06]} />
          <Highlight r={0.013} position={[-0.025, -0.03, 0.065]} />
        </group>
      );
    case "sleepy":
      return (
        <group position={[0, -0.015, 0]}>
          <mesh scale={[1.1, 0.5, 0.8]}>
            <sphereGeometry args={[0.065, 12, 8]} />
            <meshStandardMaterial color={INK} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.03, 0.012]} scale={[1, 0.35, 1]}>
            <boxGeometry args={[0.15, 0.04, 0.05]} />
            <meshBasicMaterial color={INK} />
          </mesh>
        </group>
      );
    case "happy":
      return (
        <group position={[0, -0.01, 0.015]}>
          <Arc r={0.052} up />
        </group>
      );
    case "closed":
      return (
        <group position={[0, 0.01, 0.015]}>
          <Arc r={0.048} up={false} tube={0.014} />
        </group>
      );
    case "dot":
      return (
        <mesh>
          <sphereGeometry args={[0.042, 10, 8]} />
          <meshStandardMaterial color={INK} roughness={0.3} />
        </mesh>
      );
    case "worried":
      return (
        <group position={[0, -0.01, 0]}>
          <mesh scale={[1, 1.1, 1]}>
            <sphereGeometry args={[0.055, 12, 10]} />
            <meshStandardMaterial color={INK} roughness={0.3} />
          </mesh>
          <Highlight r={0.018} position={[0.018, 0.022, 0.045]} />
        </group>
      );
    case "wide":
      return (
        <group>
          <mesh scale={[1, 1.3, 1]}>
            <sphereGeometry args={[0.075, 14, 10]} />
            <meshStandardMaterial color={INK} roughness={0.25} />
          </mesh>
          <Highlight r={0.026} position={[0.022, 0.04, 0.058]} />
        </group>
      );
    default:
      return (
        <group>
          <mesh scale={[1, 1.2, 1]}>
            <sphereGeometry args={[0.065, 12, 10]} />
            <meshStandardMaterial color={INK} roughness={0.3} />
          </mesh>
          <Highlight r={0.02} position={[0.02, 0.03, 0.05]} />
        </group>
      );
  }
}

function Mouth({ look }: { look: MouthLook }) {
  switch (look) {
    case "grin":
      return (
        <group>
          <mesh>
            <circleGeometry args={[0.075, 18, Math.PI, Math.PI]} />
            <meshBasicMaterial color="#5a2f45" />
          </mesh>
          <mesh position={[0, -0.042, 0.001]} scale={[1, 0.6, 1]}>
            <circleGeometry args={[0.035, 12]} />
            <meshBasicMaterial color="#ff8fa8" />
          </mesh>
        </group>
      );
    case "calm":
      return (
        <mesh>
          <boxGeometry args={[0.07, 0.014, 0.01]} />
          <meshBasicMaterial color={INK} />
        </mesh>
      );
    case "cat":
      return (
        <group>
          {[-0.028, 0.028].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <Arc r={0.028} up={false} tube={0.012} />
            </group>
          ))}
        </group>
      );
    case "surprised":
      return (
        <group>
          <mesh scale={[1, 1.2, 1]}>
            <circleGeometry args={[0.032, 14]} />
            <meshBasicMaterial color="#5a2f45" />
          </mesh>
        </group>
      );
    case "frown":
      return (
        <group position={[0, -0.03, 0]}>
          <Arc r={0.045} up tube={0.014} />
        </group>
      );
    case "open":
      return (
        <mesh scale={[1, 0.8, 1]}>
          <circleGeometry args={[0.045, 14]} />
          <meshBasicMaterial color="#5a2f45" />
        </mesh>
      );
    default:
      return <Arc r={0.05} up={false} tube={0.014} />;
  }
}

function BrowPair({ brows }: { brows: Brows }) {
  if (brows === "none") return null;
  const a = brows === "worried" ? 0.4 : -0.25;
  return (
    <group position={[0, 0.9, 0.41]}>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.16, 0, 0]} rotation={[-0.3, 0, -s * a]}>
          <boxGeometry args={[0.1, 0.018, 0.02]} />
          <meshBasicMaterial color={INK} />
        </mesh>
      ))}
    </group>
  );
}

// ───────────── features ─────────────

function Ears({ style, body, accent }: { style: EarStyle; body: string; accent: string }) {
  const one = (s: -1 | 1) => {
    switch (style) {
      case "bear":
        return (
          <group position={[s * 0.3, 1.0, -0.02]}>
            <mesh scale={[1, 1, 0.7]}>
              <sphereGeometry args={[0.13, 14, 10]} />
              <meshStandardMaterial color={body} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0, 0.07]} scale={[1, 1, 0.3]}>
              <sphereGeometry args={[0.08, 12, 8]} />
              <meshStandardMaterial color={accent} roughness={0.6} />
            </mesh>
          </group>
        );
      case "bunny":
        return (
          <group position={[s * 0.16, 1.22, -0.04]} rotation={[-0.15, 0, -s * 0.2]}>
            <mesh scale={[0.38, 1, 0.25]}>
              <sphereGeometry args={[0.28, 14, 12]} />
              <meshStandardMaterial color={body} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0, 0.045]} scale={[0.22, 0.78, 0.12]}>
              <sphereGeometry args={[0.28, 12, 10]} />
              <meshStandardMaterial color={accent} roughness={0.6} />
            </mesh>
          </group>
        );
      case "cat":
        return (
          <group position={[s * 0.25, 1.06, 0]} rotation={[0, 0, -s * 0.35]}>
            <mesh scale={[1, 1, 0.6]}>
              <coneGeometry args={[0.13, 0.24, 4]} />
              <meshStandardMaterial color={body} roughness={0.6} flatShading />
            </mesh>
            <mesh position={[0, -0.02, 0.045]} scale={[0.6, 0.65, 0.3]}>
              <coneGeometry args={[0.13, 0.24, 4]} />
              <meshStandardMaterial color={accent} roughness={0.6} flatShading />
            </mesh>
          </group>
        );
      case "floppy":
        return (
          <group position={[s * 0.4, 0.92, 0]} rotation={[0, 0, s * 0.35]}>
            <mesh position={[0, -0.14, 0]} scale={[0.4, 1, 0.3]}>
              <sphereGeometry args={[0.24, 14, 10]} />
              <meshStandardMaterial color={darken(body, 0.12)} roughness={0.7} />
            </mesh>
          </group>
        );
      case "horns":
        return (
          <group position={[s * 0.22, 1.08, 0.02]} rotation={[0.1, 0, -s * 0.5]}>
            <mesh>
              <coneGeometry args={[0.06, 0.24, 10]} />
              <meshStandardMaterial color="#fff2d6" roughness={0.5} />
            </mesh>
            <mesh position={[0, -0.06, 0]}>
              <torusGeometry args={[0.055, 0.012, 6, 12]} />
              <meshStandardMaterial color="#e8d3b0" roughness={0.6} />
            </mesh>
          </group>
        );
      case "antenna":
        return (
          <group position={[s * 0.14, 1.1, 0]} rotation={[0, 0, -s * 0.3]}>
            <mesh position={[0, 0.1, 0]}>
              <cylinderGeometry args={[0.012, 0.012, 0.22, 6]} />
              <meshStandardMaterial color={darken(body, 0.25)} />
            </mesh>
            <mesh position={[0, 0.23, 0]}>
              <sphereGeometry args={[0.05, 10, 8]} />
              <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.5} />
            </mesh>
          </group>
        );
      default:
        return null;
    }
  };
  if (style === "none") return null;
  return (
    <group>
      {one(-1)}
      {one(1)}
    </group>
  );
}

function Tail({ style, body, accent }: { style: TailStyle; body: string; accent: string }) {
  const catCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0.05, -0.18),
        new THREE.Vector3(0, 0.25, -0.28),
        new THREE.Vector3(0.05, 0.42, -0.22),
        new THREE.Vector3(0.12, 0.46, -0.12),
      ]),
    [],
  );
  switch (style) {
    case "puff":
      return (
        <mesh position={[0, 0, -0.06]}>
          <sphereGeometry args={[0.13, 12, 10]} />
          <meshStandardMaterial color={lighten(accent, 0.3)} roughness={1} />
        </mesh>
      );
    case "cat":
      return (
        <mesh>
          <tubeGeometry args={[catCurve, 20, 0.045, 8, false]} />
          <meshStandardMaterial color={body} roughness={0.6} />
        </mesh>
      );
    case "fox":
      return (
        <group rotation={[-1.0, 0, 0]}>
          <mesh position={[0, 0.2, 0]} scale={[0.75, 1, 0.75]}>
            <sphereGeometry args={[0.16, 14, 12]} />
            <meshStandardMaterial color={body} roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.36, 0]}>
            <coneGeometry args={[0.1, 0.16, 12]} />
            <meshStandardMaterial color={lighten(accent, 0.5)} roughness={0.8} />
          </mesh>
        </group>
      );
    case "curly":
      return (
        <group position={[0, 0.04, -0.06]} rotation={[0, Math.PI / 2, 0]}>
          <mesh>
            <torusGeometry args={[0.07, 0.025, 8, 20, Math.PI * 1.7]} />
            <meshStandardMaterial color={darken(body, 0.08)} roughness={0.6} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

// ───────────── state props (readable from far away) ─────────────

function QuestionMark() {
  return (
    <group scale={1.2}>
      <mesh rotation={[0, 0, -Math.PI / 2]}>
        <torusGeometry args={[0.09, 0.032, 8, 18, Math.PI * 1.5]} />
        <meshStandardMaterial color="#ffb86b" emissive="#ffb86b" emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0, -0.13, 0]}>
        <cylinderGeometry args={[0.032, 0.032, 0.08, 8]} />
        <meshStandardMaterial color="#ffb86b" emissive="#ffb86b" emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0, -0.25, 0]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#ffb86b" emissive="#ffb86b" emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}

function Zee({ s }: { s: number }) {
  return (
    <group scale={s}>
      <mesh position={[0, 0.06, 0]}>
        <boxGeometry args={[0.12, 0.025, 0.02]} />
        <meshBasicMaterial color="#cfd8ff" transparent opacity={0.9} />
      </mesh>
      <mesh rotation={[0, 0, Math.atan2(0.12, 0.12)]}>
        <boxGeometry args={[0.16, 0.025, 0.02]} />
        <meshBasicMaterial color="#cfd8ff" transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[0.12, 0.025, 0.02]} />
        <meshBasicMaterial color="#cfd8ff" transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

function Sleepy() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    ref.current?.children.forEach((c, i) => {
      const t = (clock.elapsedTime * 0.35 + i / 3) % 1;
      c.position.set(0.25 + t * 0.25, 1.15 + t * 0.6, 0);
      c.scale.setScalar(0.6 + t * 0.7);
    });
  });
  return (
    <group ref={ref}>
      {[0, 1, 2].map((i) => (
        <group key={i}>
          <Zee s={1} />
        </group>
      ))}
    </group>
  );
}

function StateProp({ anim, carrying }: { anim: CharacterAnim; carrying: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.y = 1.78 + Math.sin(clock.elapsedTime * 3) * 0.06;
    ref.current.rotation.y = Math.sin(clock.elapsedTime * 1.5) * 0.6;
  });
  if (carrying || anim === "carry") return null; // the scroll is held in the hands (see below)
  if (anim === "sleep") return <Sleepy />;
  let icon: ReactNode = null;
  if (anim === "wait") {
    icon = (
      <>
        <mesh position={[0, 0.1, 0]}>
          <boxGeometry args={[0.09, 0.26, 0.09]} />
          <meshStandardMaterial color="#ffb020" emissive="#ffb020" emissiveIntensity={0.6} />
        </mesh>
        <mesh position={[0, -0.12, 0]}>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial color="#ffb020" emissive="#ffb020" emissiveIntensity={0.6} />
        </mesh>
      </>
    );
  } else if (anim === "confused") {
    icon = <QuestionMark />;
  } else if (anim === "think") {
    icon = [-0.14, 0, 0.14].map((x, i) => (
      <mesh key={i} position={[x, 0, 0]}>
        <sphereGeometry args={[0.045, 8, 8]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.3} />
      </mesh>
    ));
  }
  return icon ? <group ref={ref}>{icon}</group> : null;
}

function Scroll() {
  return (
    <group position={[0, 0.55, 0.52]}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.09, 0.09, 0.5, 12]} />
        <meshStandardMaterial color="#fff6e0" />
      </mesh>
      <mesh position={[0, 0, 0.09]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color="#ff6f91" />
      </mesh>
    </group>
  );
}

function OpenBook() {
  return (
    <group position={[0, 0.52, 0.56]} rotation={[-0.75, 0, 0]}>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.1, 0, 0]} rotation={[0, 0, s * 0.22]}>
          <mesh>
            <boxGeometry args={[0.2, 0.016, 0.26]} />
            <meshStandardMaterial color="#7a9bea" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.012, 0]}>
            <boxGeometry args={[0.18, 0.012, 0.24]} />
            <meshStandardMaterial color="#fffaf0" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Notepad() {
  return (
    <group position={[-0.06, 0.46, 0.55]} rotation={[-0.55, 0.15, 0]}>
      <mesh>
        <boxGeometry args={[0.26, 0.02, 0.32]} />
        <meshStandardMaterial color="#fff6dc" roughness={0.9} />
      </mesh>
      {[-0.08, -0.02, 0.04, 0.1].map((z) => (
        <mesh key={z} position={[0, 0.011, z]}>
          <boxGeometry args={[0.2, 0.002, 0.01]} />
          <meshBasicMaterial color="#b9c7f0" />
        </mesh>
      ))}
    </group>
  );
}

function WorkSparkles({ color }: { color: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    ref.current?.children.forEach((c, i) => {
      const t = clock.elapsedTime * 2 + i * 1.3;
      c.position.set(Math.cos(t) * 0.75, 0.5 + ((t * 0.3) % 1) * 0.9, Math.sin(t) * 0.75);
      c.rotation.set(t, t, 0);
    });
  });
  return (
    <group ref={ref}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i}>
          <octahedronGeometry args={[0.055, 0]} />
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

// ───────────── rig ─────────────

const SITTING = new Set<CharacterAnim>(["sit-work", "rest", "sleep"]);

export function PastelCharacter({ appearance, anim, moving, carrying, selected, hovered, talking }: CharacterProps) {
  const body = useRef<THREE.Group>(null);
  const leftFoot = useRef<THREE.Mesh>(null);
  const rightFoot = useRef<THREE.Mesh>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const mouth = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const seed = useMemo(() => Math.random() * 10, []);

  const a = appearance;
  const bodyColor = a.bodyColor;
  const footColor = darken(bodyColor, 0.08);
  const face = faceFor(moving ? "walk" : anim, a);
  const head = a.wearables.head;
  const showEars = !(head && HIDES_EARS.has(head));
  const holding = carrying || (!moving && anim === "carry");
  // Contextual props replace the held item where they would clash.
  let hand = a.wearables.hand;
  if (!moving && anim === "read" && hand === "book") hand = undefined;
  if (!moving && anim === "write" && !hand) hand = "quill";
  if (holding) hand = undefined;

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + seed;
    const b = body.current;
    if (!b) return;
    let y = 0;
    let sx = 1;
    let sy = 1;
    let tiltX = 0;
    let tiltZ = 0;
    let spin: number | null = null;
    let foot = 0;
    let armL = 0;
    let armR = 0;
    let armLz = 0;
    let armRz = 0;
    let tailSpeed = 3;
    const sitting = !moving && SITTING.has(anim);
    const st = (s: number) => Math.sin(t * s);

    if (moving) {
      y = Math.abs(st(9)) * 0.14;
      foot = st(9) * 0.5;
      armL = st(9) * 0.6;
      armR = -armL;
      tiltX = 0.08;
      tailSpeed = 12;
      if (holding) armL = armR = -1.2;
    } else {
      switch (anim) {
        case "think":
          tiltZ = st(1.5) * 0.1;
          sy = 1 + st(2) * 0.02;
          armR = -2.3;
          armRz = -0.5;
          break;
        case "work":
          y = Math.abs(st(12)) * 0.05;
          armL = -0.5 + st(14) * 0.8;
          armR = -0.5 - st(14) * 0.8;
          sy = 1 + st(12) * 0.03;
          break;
        case "sit-work":
          y = -0.14 + Math.abs(st(8)) * 0.015;
          armL = -1.0 + st(16) * 0.15;
          armR = -1.0 - st(16) * 0.15;
          armLz = 0.25;
          armRz = -0.25;
          break;
        case "read":
          y = st(1.4) * 0.01;
          tiltX = 0.14;
          armL = armR = -1.15;
          armLz = 0.4;
          armRz = -0.4;
          if ((t % 5) < 0.4) armR -= 0.4; // turn the page
          break;
        case "write":
          tiltX = 0.18;
          armL = -0.95;
          armLz = 0.35;
          armR = -1.05 + st(20) * 0.1;
          armRz = -0.3 + st(13) * 0.12;
          break;
        case "carry":
          armL = armR = -1.2;
          break;
        case "wait":
          tiltZ = st(2.2) * 0.08;
          armL = armR = 0.45;
          foot = Math.max(0, st(7)) * 0.4;
          break;
        case "celebrate":
          y = Math.abs(st(5)) * 0.5;
          spin = t * 4;
          armL = armR = -2.6;
          tailSpeed = 14;
          break;
        case "confused":
          tiltZ = st(1.6) * 0.18;
          sy = 0.96;
          armR = -2.6;
          armRz = -0.3 + st(9) * 0.15; // scratching the head
          armL = -0.15;
          tailSpeed = 1;
          break;
        case "rest":
          y = -0.16;
          sx = 1.04 + st(1.5) * 0.01;
          sy = 0.95 + st(1.5) * 0.015;
          armLz = -0.3;
          armRz = 0.3;
          tailSpeed = 1.2;
          break;
        case "sleep":
          y = -0.18;
          tiltX = 0.22;
          tiltZ = 0.1;
          sy = 1 + st(1.2) * 0.04;
          armLz = -0.2;
          armRz = 0.2;
          tailSpeed = 0;
          break;
        case "converse":
          y = Math.abs(st(4)) * 0.03;
          armR = -0.9 + st(3) * 0.5;
          armL = -0.3 + st(2.2) * 0.2;
          tiltZ = st(1.3) * 0.06;
          tailSpeed = 6;
          break;
        default:
          sy = 1 + st(2) * 0.03;
          sx = 1 - st(2) * 0.015;
      }
    }

    const k = Math.min(1, dt * 12);
    b.position.y += (y - b.position.y) * Math.min(1, dt * 18);
    b.scale.set(sx, sy, sx);
    b.rotation.x += (tiltX - b.rotation.x) * k;
    b.rotation.z += (tiltZ - b.rotation.z) * k;
    b.rotation.y = spin !== null ? spin : b.rotation.y * 0.85;
    for (const [f, sgn] of [
      [leftFoot.current, 1],
      [rightFoot.current, -1],
    ] as const) {
      if (!f) continue;
      const tz = sitting ? 0.3 : 0.08 + (anim === "wait" && !moving ? (sgn > 0 ? foot * 0.2 : 0) : foot * 0.25 * sgn);
      f.position.z += (tz - f.position.z) * k;
      f.position.y = sitting ? 0.06 : 0.08 + (anim === "wait" && !moving && sgn > 0 ? foot * 0.08 : 0);
    }
    const ease = (g: THREE.Group | null, x: number, z: number) => {
      if (!g) return;
      g.rotation.x += (x - g.rotation.x) * Math.min(1, dt * 16);
      g.rotation.z += (z - g.rotation.z) * Math.min(1, dt * 16);
    };
    ease(leftArm.current, armL, armLz);
    ease(rightArm.current, armR, armRz);
    if (tail.current) tail.current.rotation.y = Math.sin(t * tailSpeed) * 0.35;
    // Blink every few seconds (skipped while eyes are drawn closed/happy).
    if (eyes.current) {
      const blink = (t % 4.3) < 0.12 && face.eyes !== "closed" && face.eyes !== "happy";
      eyes.current.scale.y = blink ? 0.12 : 1;
    }
    if (mouth.current) {
      const flap = talking || (!moving && anim === "converse");
      mouth.current.scale.y = flap ? 0.5 + Math.abs(st(16)) * 1.1 : 1;
    }
    if (ring.current) ring.current.rotation.z = t * 1.5;
  });

  return (
    <group scale={(hovered ? 1.45 : 1.35) * a.size}>
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
        <meshStandardMaterial color={footColor} roughness={0.7} />
      </mesh>
      <mesh ref={rightFoot} castShadow position={[0.18, 0.08, 0.08]} scale={[1, 0.6, 1.3]}>
        <sphereGeometry args={[0.13, 12, 10]} />
        <meshStandardMaterial color={footColor} roughness={0.7} />
      </mesh>
      <group ref={body}>
        <mesh castShadow position={[0, 0.62, 0]} scale={[1, 1.08, 0.95]}>
          <sphereGeometry args={[0.5, 28, 22]} />
          <meshStandardMaterial color={bodyColor} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.5, 0.33]} scale={[0.75, 0.7, 0.4]}>
          <sphereGeometry args={[0.42, 20, 16]} />
          <meshStandardMaterial color={a.accentColor} roughness={0.6} />
        </mesh>
        {/* face */}
        <group ref={eyes} position={[0, 0.78, 0]}>
          {([-1, 1] as const).map((s) => (
            <group key={s} position={[s * 0.16, 0, 0.43]}>
              <Eye look={face.eyes} side={s} />
            </group>
          ))}
        </group>
        <BrowPair brows={face.brows} />
        {[-0.3, 0.3].map((x) => (
          <mesh key={x} position={[x, 0.64, 0.38]} rotation={[0, x * 1.2, 0]}>
            <circleGeometry args={[0.07, 16]} />
            <meshBasicMaterial color={a.cheekColor} transparent opacity={0.75} />
          </mesh>
        ))}
        <group ref={mouth} position={[0, 0.66, 0.475]}>
          <Mouth look={face.mouth} />
        </group>
        {showEars && <Ears style={a.ears} body={bodyColor} accent={a.accentColor} />}
        <group ref={tail} position={[0, 0.3, -0.45]}>
          <Tail style={a.tail} body={bodyColor} accent={a.accentColor} />
        </group>
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
          {hand && <HeldItem id={hand} />}
        </group>
        {a.wearables.head && <Wearable slot="head" id={a.wearables.head} />}
        {a.wearables.eyes && <Wearable slot="eyes" id={a.wearables.eyes} />}
        {a.wearables.neck && <Wearable slot="neck" id={a.wearables.neck} />}
        {a.wearables.back && <Wearable slot="back" id={a.wearables.back} />}
        {holding && <Scroll />}
        {!moving && anim === "read" && <OpenBook />}
        {!moving && anim === "write" && <Notepad />}
      </group>
      <StateProp anim={moving ? "walk" : anim} carrying={carrying} />
      {!moving && (anim === "work" || anim === "sit-work") && <WorkSparkles color={bodyColor} />}
      {!moving && anim === "celebrate" && <Confetti />}
    </group>
  );
}
