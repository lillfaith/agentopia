import { Suspense, useEffect, useMemo, useState, type ComponentType } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Agent } from "../../../shared/types";
import {
  EAR_STYLES,
  EXPRESSIONS,
  EYE_STYLES,
  TAIL_STYLES,
  WEARABLES,
  WEARABLE_SLOTS,
  type Appearance,
  type WearableSlot,
} from "../../../shared/cosmetics";
import { api } from "../api/client";
import { useTown } from "../state/store";
import { useTheme } from "../theme-engine/ThemeContext";
import type { CharacterAnim, CharacterProps } from "../theme-engine/types";
import { Drawer } from "./common";

type Tab = "identity" | "colors" | "face" | "features" | "wardrobe";
const TABS: { id: Tab; label: string }[] = [
  { id: "identity", label: "Identity" },
  { id: "colors", label: "Colours" },
  { id: "face", label: "Face" },
  { id: "features", label: "Features" },
  { id: "wardrobe", label: "Wardrobe" },
];

const SLOT_LABEL: Record<WearableSlot, string> = { head: "Head", eyes: "Eyes", neck: "Neck", back: "Back", hand: "Hand" };
const EYE_LABEL: Record<string, string> = { round: "Round", sparkle: "Sparkly", sleepy: "Sleepy", happy: "Happy", dot: "Dot", wink: "Wink" };
const MOUTH_LABEL: Record<string, string> = { smile: "Smile", grin: "Grin", calm: "Calm", cat: "Cat", surprised: "Ooh" };
const EAR_LABEL: Record<string, string> = { none: "None", bear: "Bear", bunny: "Bunny", cat: "Cat", floppy: "Floppy", horns: "Horns", antenna: "Antennae" };
const TAIL_LABEL: Record<string, string> = { none: "None", puff: "Puff", cat: "Cat", fox: "Fox", curly: "Curly" };
const SWATCHES = ["#f59ab8", "#ffb4a2", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#8ccbf2", "#a0c4ff", "#b9a7fa", "#ffc6ff", "#e8d5c4", "#c9c9d9"];
const POSES: { anim: CharacterAnim; label: string; moving?: boolean }[] = [
  { anim: "idle", label: "Idle" },
  { anim: "walk", label: "Walk", moving: true },
  { anim: "work", label: "Work" },
  { anim: "read", label: "Read" },
  { anim: "celebrate", label: "Cheer" },
  { anim: "sleep", label: "Sleep" },
];

/** Turntable preview. Rendering only: poses here never touch the agent's real state. */
export function CharacterPreview({ Character, appearance, anim, moving }: { Character: ComponentType<CharacterProps>; appearance: Appearance; anim: CharacterAnim; moving?: boolean }) {
  return (
    <Canvas className="wardrobe-canvas" dpr={[1, 2]} camera={{ position: [0, 1.7, 4.4], fov: 34 }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.9} />
      <hemisphereLight args={["#fff6fb", "#cdb8e8", 0.6]} />
      <directionalLight position={[3, 5, 4]} intensity={1.6} />
      <Suspense fallback={null}>
        <group position={[0, -0.85, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
            <circleGeometry args={[1.3, 40]} />
            <meshStandardMaterial color="#e9f6dc" />
          </mesh>
          <Character appearance={appearance} anim={anim} moving={!!moving} carrying={false} selected={false} hovered={false} />
        </group>
      </Suspense>
      <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={1.6} minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI / 2.1} target={[0, 0.2, 0]} />
    </Canvas>
  );
}

function Options<T extends string>({ value, options, label, onChange }: { value: T; options: readonly T[]; label: Record<string, string>; onChange: (v: T) => void }) {
  return (
    <div className="opt-grid" role="radiogroup">
      {options.map((o) => (
        <button key={o} role="radio" aria-checked={o === value} className={`opt ${o === value ? "on" : ""}`} onClick={() => onChange(o)}>
          {label[o] ?? o}
        </button>
      ))}
    </div>
  );
}

export function Wardrobe({ agentId }: { agentId: string }) {
  const agent = useTown((s) => s.snapshot?.agents.find((a) => a.id === agentId));
  const close = useTown((s) => s.openWardrobe);
  if (!agent) return null;
  return <WardrobeInner key={agent.id} agent={agent} onClose={() => close(null)} />;
}

function WardrobeInner({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const theme = useTheme();
  const push = useTown((s) => s.pushToast);
  const [tab, setTab] = useState<Tab>("wardrobe");
  const [look, setLook] = useState<Appearance>(() => structuredClone(agent.appearance));
  const [name, setName] = useState(agent.name);
  const [personality, setPersonality] = useState(agent.personality);
  const [pose, setPose] = useState(0);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Appearance>(k: K, v: Appearance[K]) => setLook((l) => ({ ...l, [k]: v }));
  const wear = (slot: WearableSlot, id: string | null) =>
    setLook((l) => {
      const w = { ...l.wearables };
      if (id) w[slot] = id;
      else delete w[slot];
      return { ...l, wearables: w };
    });

  const lookChanged = JSON.stringify(look) !== JSON.stringify(agent.appearance);
  const identityChanged = name.trim() !== agent.name || personality.trim() !== agent.personality;
  const dirty = lookChanged || identityChanged;
  useEffect(() => setBusy(false), [agent.updatedAt]);

  const bySlot = useMemo(() => Object.fromEntries(WEARABLE_SLOTS.map((s) => [s, WEARABLES.filter((w) => w.slot === s)])), []);

  const save = async () => {
    setBusy(true);
    try {
      const body: Partial<Agent> = {};
      if (lookChanged) body.appearance = look;
      if (name.trim() !== agent.name) body.name = name.trim();
      if (personality.trim() !== agent.personality) body.personality = personality.trim();
      await api.updateAgent(agent.id, body);
      push({ tone: "good", text: `${name.trim() || agent.name} saved` });
    } catch (err) {
      push({ tone: "bad", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const p = POSES[pose];
  return (
    <Drawer side="left" icon="👗" title={`${agent.name}'s wardrobe`} onClose={onClose}>
      <div className="wardrobe-stage">
        <CharacterPreview Character={theme.components.Character} appearance={look} anim={p.anim} moving={p.moving} />
        <div className="pose-row" aria-label="Preview pose">
          {POSES.map((x, i) => (
            <button key={x.label} className={`pose ${i === pose ? "on" : ""}`} onClick={() => setPose(i)}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small">Looks are cosmetic only: they never change what {agent.name} can do, which tools they use, or what work costs. Outfit changes don't interrupt running tasks.</p>
      <div className="tabs tabs-scroll">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "identity" && (
        <div className="stack form">
          <label>
            Name
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Personality
            <textarea rows={3} value={personality} onChange={(e) => setPersonality(e.target.value)} />
          </label>
          <p className="muted small">
            Name and personality are part of {agent.name}'s instructions to the AI. Their job ({agent.role}), skills and model are set separately under Configure.
          </p>
          <label>
            Size <small className="muted">{Math.round(look.size * 100)}%</small>
            <input type="range" min={0.85} max={1.2} step={0.01} value={look.size} onChange={(e) => set("size", Number(e.target.value))} />
          </label>
        </div>
      )}

      {tab === "colors" && (
        <div className="stack form">
          <div className="field-label">Body</div>
          <div className="swatches">
            {SWATCHES.map((c) => (
              <button key={c} className={`swatch ${look.bodyColor === c ? "on" : ""}`} style={{ background: c }} aria-label={`Body colour ${c}`} onClick={() => set("bodyColor", c)} />
            ))}
          </div>
          <div className="grid3">
            <label>
              Body
              <input type="color" value={look.bodyColor} onChange={(e) => set("bodyColor", e.target.value)} />
            </label>
            <label>
              Belly & ears
              <input type="color" value={look.accentColor} onChange={(e) => set("accentColor", e.target.value)} />
            </label>
            <label>
              Cheeks
              <input type="color" value={look.cheekColor} onChange={(e) => set("cheekColor", e.target.value)} />
            </label>
          </div>
        </div>
      )}

      {tab === "face" && (
        <div className="stack form">
          <div className="field-label">Eyes</div>
          <Options value={look.eyes} options={EYE_STYLES} label={EYE_LABEL} onChange={(v) => set("eyes", v)} />
          <div className="field-label">Resting expression</div>
          <Options value={look.expression} options={EXPRESSIONS} label={MOUTH_LABEL} onChange={(v) => set("expression", v)} />
          <p className="muted small">Faces react to real events: a grin when a task completes, a worried look when one fails.</p>
        </div>
      )}

      {tab === "features" && (
        <div className="stack form">
          <div className="field-label">Ears & horns</div>
          <Options value={look.ears} options={EAR_STYLES} label={EAR_LABEL} onChange={(v) => set("ears", v)} />
          <div className="field-label">Tail</div>
          <Options value={look.tail} options={TAIL_STYLES} label={TAIL_LABEL} onChange={(v) => set("tail", v)} />
        </div>
      )}

      {tab === "wardrobe" && (
        <div className="stack form">
          {WEARABLE_SLOTS.map((slot) => (
            <div key={slot} className="slot-row">
              <div className="field-label">{SLOT_LABEL[slot]}</div>
              <div className="item-grid">
                <button className={`item ${!look.wearables[slot] ? "on" : ""}`} onClick={() => wear(slot, null)} title="Nothing">
                  <span className="item-icon">∅</span>
                  <span>None</span>
                </button>
                {bySlot[slot].map((w) => (
                  <button key={w.id} className={`item ${look.wearables[slot] === w.id ? "on" : ""}`} onClick={() => wear(slot, w.id)} title={w.description}>
                    <span className="item-icon">{w.icon}</span>
                    <span>{w.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="wardrobe-actions">
        <button
          className="btn"
          disabled={!dirty || busy}
          onClick={() => {
            setLook(structuredClone(agent.appearance));
            setName(agent.name);
            setPersonality(agent.personality);
          }}
        >
          Reset
        </button>
        <button className="btn primary" disabled={!dirty || busy || !name.trim()} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Drawer>
  );
}
