import { Suspense, useCallback, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import type { Building } from "../../../shared/types";
import type { SlotLayout, ThemeManifest } from "../theme-engine/types";
import { useTown } from "../state/store";
import { AgentActor } from "./AgentActor";
import { CameraRig } from "./CameraRig";
import { WorldLabel } from "./WorldLabel";

function BuildingNode({ building, layout, theme }: { building: Building; layout: SlotLayout; theme: ThemeManifest }) {
  const [hovered, setHovered] = useState(false);
  const selected = useTown((s) => s.selectedBuildingId === building.id);
  const timeOfDay = useTown((s) => s.timeOfDay);
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
      <BuildingView building={building} glow={theme.world.lighting[timeOfDay].glow} hovered={hovered} selected={selected} activity={activity} />
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
  const timeOfDay = useTown((s) => s.timeOfDay);
  const clearSelection = useTown((s) => s.selectAgent);
  const buildings = snapshot?.buildings ?? [];
  const agents = snapshot?.agents ?? [];

  // Data → layout: each building's slot id is mapped to a position by the active theme.
  const layouts = useMemo(() => {
    const map = new Map<string, SlotLayout>();
    buildings.forEach((b, i) => map.set(b.id, theme.world.slots[b.slot] ?? theme.world.fallbackSlot(i)));
    return map;
  }, [buildings, theme]);
  const occupied = useMemo(() => {
    const o: Record<string, SlotLayout> = {};
    for (const b of buildings) {
      const l = layouts.get(b.id);
      if (l) o[b.slot] = l;
    }
    return o;
  }, [buildings, layouts]);
  const slotForBuilding = useCallback((id: string) => layouts.get(id), [layouts]);
  const nav = useMemo(() => theme.world.buildNav(occupied), [theme, occupied]);

  const lighting = theme.world.lighting[timeOfDay];
  const Environment = theme.components.Environment;
  const Weather = theme.components.Weather;
  const agentIndex = new Map<string, number>();

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ fov: theme.world.camera.fov, near: 0.5, far: 500, position: theme.world.camera.overviewPosition }}
      onPointerMissed={() => clearSelection(null)}
      gl={{ antialias: true }}
    >
      <fog attach="fog" args={[lighting.fog, 70, 190]} />
      <Suspense fallback={null}>
        <Environment timeOfDay={timeOfDay} lighting={lighting} slots={occupied} />
        {Weather && <Weather timeOfDay={timeOfDay} />}
        {buildings.map((b) => {
          const layout = layouts.get(b.id);
          return layout ? <BuildingNode key={b.id} building={b} layout={layout} theme={theme} /> : null;
        })}
        {agents
          .filter((a) => a.enabled && !a.archived)
          .map((a) => {
            const i = agentIndex.get(a.buildingId) ?? 0;
            agentIndex.set(a.buildingId, i + 1);
            return <AgentActor key={a.id} agent={a} index={i} theme={theme} nav={nav} slotForBuilding={slotForBuilding} />;
          })}
      </Suspense>
      <CameraRig theme={theme} />
    </Canvas>
  );
}
