import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Agent } from "../../../shared/types";
import { animForStatus, type CharacterAnim, type NavGraph, type SlotLayout, type ThemeManifest } from "../theme-engine/types";
import { STATUS_LABEL, levelFor, statsFor, useTown, type Errand } from "../state/store";
import { route } from "./navigation";
import { agentPositions } from "./positions";
import { WorldLabel } from "./WorldLabel";

type P = [number, number];

interface Props {
  agent: Agent;
  index: number;
  theme: ThemeManifest;
  nav: NavGraph;
  slotForBuilding: (buildingId: string) => SlotLayout | undefined;
  /** Visual night (from the day cycle). Idle villagers go home and sleep; purely decorative. */
  night: boolean;
}

const BUSY = new Set(["planning", "working", "waiting_approval", "completed", "failed", "delivering"]);
const ERRAND_PAUSE_MS = 2200;
const CHAT_DISTANCE = 1.9;

/** Decorative idle behaviours. They never imply task progress and make no API calls. */
type IdleAnim = Extract<CharacterAnim, "idle" | "rest" | "sleep" | "converse">;

/**
 * Moves one villager around the world. Where it goes is derived ONLY from real
 * system state: its agent status (from the server) and hand-off events. Nothing
 * here fabricates progress. When idle, it shows decorative behaviour only
 * (wandering, resting, chatting with a neighbour, sleeping at night).
 */
export function AgentActor({ agent, index, theme, nav, slotForBuilding, night }: Props) {
  const group = useRef<THREE.Group>(null);
  const facing = useRef<THREE.Group>(null);
  const home = slotForBuilding(agent.buildingId);
  const start: P = home ? home.idleSpots[index % home.idleSpots.length] : [index * 1.5, 4];
  const pos = useRef(new THREE.Vector3(start[0], 0, start[1]));
  const path = useRef<P[]>([]);
  const goalKey = useRef("");
  const idleUntil = useRef(0);
  const idleGoal = useRef<P>(start);
  const errandQueue = useRef<Errand[]>([]);
  const lastErrandId = useRef(0);
  const errand = useRef<{ e: Errand; stage: "going" | "there" | "returning"; until: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const [carrying, setCarrying] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [idleAnim, setIdleAnim] = useState<IdleAnim>("idle");
  const wantsRest = useRef(false);

  const selected = useTown((s) => s.selectedAgentId === agent.id);
  const showNames = useTown((s) => s.showNames);
  const showBubbles = useTown((s) => s.showBubbles);
  const errands = useTown((s) => s.errands);
  const activity = useTown((s) => s.activity[agent.id]);
  const snapshot = useTown((s) => s.snapshot);
  const selectAgent = useTown((s) => s.selectAgent);
  const agents = snapshot?.agents ?? [];

  useEffect(() => {
    agentPositions.set(agent.id, pos.current);
    return () => void agentPositions.delete(agent.id);
  }, [agent.id]);

  // Queue new real hand-offs that this agent initiated.
  useEffect(() => {
    for (const e of errands) {
      if (e.fromAgentId === agent.id && e.id > lastErrandId.current) {
        errandQueue.current.push(e);
        lastErrandId.current = e.id;
      }
    }
  }, [errands, agent.id]);

  const workSpot = useMemo<P | null>(() => {
    if (!home) return null;
    // Stand just in front of the door, offset per agent so villagers sharing a building don't overlap.
    const [dx, dz] = home.door;
    const off = (index % 3) - 1;
    const [bx, , bz] = home.position;
    const len = Math.hypot(dx - bx, dz - bz) || 1;
    const px = -(dz - bz) / len;
    const pz = (dx - bx) / len;
    return [dx + px * off * 0.9, dz + pz * off * 0.9];
  }, [home, index]);

  useFrame(({ clock }, dt) => {
    const now = performance.now();
    const p = pos.current;
    let goal: P | null = null;
    let key = "";

    // 1) Errands (real hand-off events) take priority.
    if (!errand.current && errandQueue.current.length) {
      const e = errandQueue.current.shift()!;
      if (now - e.ts < 60_000) errand.current = { e, stage: "going", until: 0 };
    }
    const er = errand.current;
    if (er) {
      const target = agents.find((a) => a.id === er.e.toAgentId);
      const targetSlot = target ? slotForBuilding(target.buildingId) : undefined;
      if (!targetSlot || !workSpot) {
        errand.current = null;
      } else if (er.stage === "going") {
        goal = [targetSlot.door[0] + 0.8, targetSlot.door[1] + 0.4];
        key = `errand:${er.e.id}:go`;
      } else if (er.stage === "there") {
        goal = [targetSlot.door[0] + 0.8, targetSlot.door[1] + 0.4];
        key = `errand:${er.e.id}:go`;
        if (now > er.until) er.stage = "returning";
      } else {
        goal = workSpot;
        key = `errand:${er.e.id}:back`;
      }
    }

    // 2) Otherwise, real status decides: busy → at own building, idle → wander nearby.
    if (!goal) {
      if (BUSY.has(agent.status) && workSpot) {
        goal = workSpot;
        key = "work";
      } else if (home && night) {
        goal = start;
        key = "sleep";
      } else if (home) {
        if (now > idleUntil.current) {
          const spots = home.idleSpots;
          const r = Math.random();
          // Sometimes stroll over to another idle villager for a (decorative) chat.
          const friend = agents.find((o) => o.id !== agent.id && o.status === "idle" && o.enabled && !o.archived && Math.random() < 0.5);
          const fp = friend ? agentPositions.get(friend.id) : undefined;
          if (fp && r < 0.3) idleGoal.current = [fp.x + 1.1, fp.z + 0.5];
          else {
            // Wander to one of the theme's hangouts (benches, a pier, a picnic…) or stay near home.
            const hangouts = nav.hangouts?.length ? nav.hangouts : Object.values(nav.nodes);
            idleGoal.current = r < 0.5 ? hangouts[Math.floor(Math.random() * hangouts.length)] : spots[Math.floor(Math.random() * spots.length)];
          }
          wantsRest.current = Math.random() < 0.35;
          idleUntil.current = now + 7000 + Math.random() * 9000;
        }
        goal = idleGoal.current;
        key = `idle:${goal[0].toFixed(2)},${goal[1].toFixed(2)}`;
      }
    }

    // Nearby idle neighbour → decorative conversation (both face each other).
    let partner: THREE.Vector3 | null = null;
    if (agent.status === "idle" && !er && !night) {
      for (const o of agents) {
        if (o.id === agent.id || o.status !== "idle") continue;
        const op = agentPositions.get(o.id);
        if (op && op.distanceTo(p) < CHAT_DISTANCE) {
          partner = op;
          break;
        }
      }
    }

    if (goal && key !== goalKey.current) {
      goalKey.current = key;
      path.current = route(nav, [p.x, p.z], goal);
    }

    // 3) Walk the path.
    let isMoving = false;
    const next = path.current[0];
    if (next) {
      const dx = next[0] - p.x;
      const dz = next[1] - p.z;
      const d = Math.hypot(dx, dz);
      // Cap the step only for long stalls (e.g. a backgrounded tab), not ordinary low frame rates.
      const step = theme.world.walkSpeed * Math.min(dt, 0.25);
      if (d <= step) {
        p.x = next[0];
        p.z = next[1];
        path.current.shift();
      } else {
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        isMoving = true;
        if (facing.current) {
          const target = Math.atan2(dx, dz);
          let delta = target - facing.current.rotation.y;
          delta = Math.atan2(Math.sin(delta), Math.cos(delta));
          facing.current.rotation.y += delta * Math.min(1, dt * 10);
        }
      }
    } else if (facing.current && home) {
      // Chatting: face the partner. Idle: face the plaza. Working: face the building.
      const [bx, , bz] = home.position;
      const target = partner
        ? Math.atan2(partner.x - p.x, partner.z - p.z)
        : BUSY.has(agent.status) && !er
          ? Math.atan2(bx - p.x, bz - p.z)
          : Math.atan2(-p.x, -p.z);
      let delta = target - facing.current.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      facing.current.rotation.y += delta * Math.min(1, dt * 3);
    }

    if (er && !path.current.length) {
      if (er.stage === "going") {
        er.stage = "there";
        er.until = now + ERRAND_PAUSE_MS;
      } else if (er.stage === "returning") {
        errand.current = null;
      }
    }

    if (group.current) group.current.position.copy(p);
    if (isMoving !== moving) setMoving(isMoving);
    const isCarrying = !!er && er.stage === "going";
    if (isCarrying !== carrying) setCarrying(isCarrying);
    const deco: IdleAnim = isMoving || agent.status !== "idle" || er ? "idle" : night ? "sleep" : partner ? "converse" : wantsRest.current ? "rest" : "idle";
    if (deco !== idleAnim) setIdleAnim(deco);
    void clock;
  });

  const stats = statsFor(snapshot, agent.id);
  const { level } = levelFor(stats);
  const Character = theme.components.Character;
  // Real states come only from the server status; idle flavour is decorative.
  const anim: CharacterAnim = moving ? "walk" : agent.status === "idle" ? idleAnim : animForStatus(agent.status);

  const recentActivity = activity && activity.taskId === agent.currentTaskId && Date.now() - activity.ts < 120_000 ? activity.text : null;
  let bubble: string | null = null;
  if (agent.status === "waiting_approval" || agent.status === "failed") bubble = agent.statusDetail ?? STATUS_LABEL[agent.status];
  else if (carrying && errand.current) bubble = `📨 ${errand.current.e.label}`;
  else if (agent.status === "working" || agent.status === "planning") bubble = recentActivity ?? agent.statusDetail;
  else if (agent.status !== "idle") bubble = agent.statusDetail ?? STATUS_LABEL[agent.status];

  return (
    <group
      ref={group}
      onClick={(e) => {
        e.stopPropagation();
        selectAgent(agent.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "";
      }}
    >
      <group ref={facing}>
        <Character appearance={agent.appearance} anim={anim} moving={moving} carrying={carrying} selected={selected} hovered={hovered} />
      </group>
      {/* invisible, larger hit target for easy clicking */}
      <mesh position={[0, 0.7, 0]} visible={false}>
        <cylinderGeometry args={[0.7, 0.7, 1.6, 8]} />
      </mesh>
      {(showNames || showBubbles) && (
        <WorldLabel position={[0, theme.world.labelHeight, 0]} zIndex={20} min={0.62}>
          <div className="world-label agent-label" onClick={() => selectAgent(agent.id)}>
            {showBubbles && bubble && <div className={`bubble status-${agent.status}`}>{bubble.length > 90 ? bubble.slice(0, 89) + "…" : bubble}</div>}
            {showNames && (
              <div className={`name-chip ${selected ? "selected" : ""}`}>
                <span className={`dot status-${agent.status}`} />
                <b>{agent.name}</b>
                <span className="role">{agent.role}</span>
                <span className="lv">Lv{level}</span>
              </div>
            )}
          </div>
        </WorldLabel>
      )}
    </group>
  );
}
