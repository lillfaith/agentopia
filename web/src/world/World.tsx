import { Suspense, useCallback, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import type { Building } from "../../../shared/types";
import type { SlotLayout, ThemeManifest } from "../theme-engine/types";
import { useTown } from "../state/store";
import { AgentActor } from "./AgentActor";
import { CameraRig } from "./CameraRig";
import { useEnvironment } from "../environment/useEnvironment";
import { WorldLabel } from "./WorldLabel";
import { PerformanceMonitor } from "@react-three/drei";
import { RenderStats } from "./RenderStats";

function BuildingNode({ building, layout, theme, glow }: { building: Building; layout: SlotLayout; theme: ThemeManifest; glow: number }) {
  const [hovered, setHovered] = useState(false);
  const selected = useTown((s) => s.selectedBuildingId === building.id);
  const showNames = useTown((s) => s.showNames);
  const selectBuilding = useTown((s) => s.selectBuilding);
  const agents = useTown((s) => s.snapshot?.agents ?? []);
  const activity = agents.filter((a) => a.buildingId === building.id && (a.status === "working" || a.status === "planning")).length;
  const BuildingView = theme.components.Building;
  return (
    <group
      position={layout.position}
      rotation={[0, layout.rotation, 0]}
      onClick={(e) => {
        e.stopPropagation();
        selectBuilding(building.id);
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
      <BuildingView building={building} glow={glow} hovered={hovered} selected={selected} activity={activity} />
      {showNames && (
        <WorldLabel position={[0, 7.6, 0]} reference={34} min={0.45}>
          <div className="world-label building-label" onClick={() => selectBuilding(building.id)}>
            <b>{building.name}</b>
            <span>{building.department}</span>
          </div>
        </WorldLabel>
      )}
    </group>
  );
}

export function World({ theme }: { theme: ThemeManifest }) {
  const snapshot = useTown((s) => s.snapshot);
  const env = useEnvironment(theme);
  const clearSelection = useTown((s) => s.selectAgent);
  const buildings = snapshot?.buildings ?? [];
  const agents = snapshot?.agents ?? [];

  // Data → layout: each building's slot id is mapped to a position by the active theme.
  // Keyed by ids and slots only, so routine snapshot refreshes don't rebuild the town's scenery.
  const plotKey = buildings.map((b) => `${b.id}@${b.slot}`).join("|");
  const layouts = useMemo(() => {
    const map = new Map<string, SlotLayout>();
    // Buildings whose slot this theme doesn't define get the theme's spare plots, in order.
    let spare = 0;
    for (const entry of plotKey ? plotKey.split("|") : []) {
      const [id, slot] = entry.split("@");
      map.set(id, theme.world.slots[slot] ?? theme.world.fallbackSlot(spare++));
    }
    return map;
  }, [plotKey, theme]);
  const occupied = useMemo(() => {
    const o: Record<string, SlotLayout> = {};
    for (const entry of plotKey ? plotKey.split("|") : []) {
      const [id, slot] = entry.split("@");
      const l = layouts.get(id);
      if (l) o[slot] = l;
    }
    return o;
  }, [plotKey, layouts]);
  const slotForBuilding = useCallback((id: string) => layouts.get(id), [layouts]);
  const nav = useMemo(() => theme.world.buildNav(occupied), [theme, occupied]);

  const [dpr, setDpr] = useState(() => Math.min(1.75, window.devicePixelRatio || 1));
  const lighting = env.lighting;
  const look = theme.world.renderer ?? {};
  const toneMapping = look.toneMapping === "neutral" ? THREE.NeutralToneMapping : look.toneMapping === "agx" ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
  const [fogNear, fogFar] = look.fog ?? [70, 190];
  const Environment = theme.components.Environment;
  const Weather = theme.components.Weather;
  const agentIndex = new Map<string, number>();

  return (
    <Canvas
      shadows="percentage"
      dpr={dpr}
      camera={{ fov: theme.world.camera.fov, near: 0.5, far: 500, position: theme.world.camera.overviewPosition }}
      onPointerMissed={() => clearSelection(null)}
      gl={{ antialias: true, toneMapping, toneMappingExposure: look.exposure ?? 1, powerPreference: "high-performance" }}
    >
      <fog attach="fog" args={[lighting.fog, fogNear, fogFar]} />
      {/* Drops resolution on slower GPUs (e.g. a MacBook Air) to keep the frame rate smooth. */}
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(Math.min(1.75, window.devicePixelRatio))} flipflops={3} onFallback={() => setDpr(1)} />
      <RenderStats />
      <Suspense fallback={null}>
        <Environment env={env} slots={occupied} />
        {Weather && <Weather env={env} />}
        {buildings.map((b) => {
          const layout = layouts.get(b.id);
          return layout ? <BuildingNode key={b.id} building={b} layout={layout} theme={theme} glow={lighting.glow} /> : null;
        })}
        {agents
          .filter((a) => a.enabled && !a.archived)
          .map((a) => {
            const i = agentIndex.get(a.buildingId) ?? 0;
            agentIndex.set(a.buildingId, i + 1);
            return <AgentActor key={a.id} agent={a} index={i} theme={theme} nav={nav} slotForBuilding={slotForBuilding} night={env.phase === "night"} />;
          })}
      </Suspense>
      <CameraRig theme={theme} />
    </Canvas>
  );
}
