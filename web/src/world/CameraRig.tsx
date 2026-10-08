import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import * as THREE from "three";
import type { MapControls as MapControlsImpl } from "three-stdlib";
import type { ThemeManifest } from "../theme-engine/types";
import { useTown } from "../state/store";
import { agentPositions } from "./positions";

/** Angled isometric-style camera: drag to pan, right-drag to rotate, scroll to zoom. */
export function CameraRig({ theme }: { theme: ThemeManifest }) {
  const controls = useRef<MapControlsImpl>(null);
  const { camera } = useThree();
  const cam = theme.world.camera;
  const fly = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const overviewRequest = useTown((s) => s.overviewRequest);
  const selectedAgentId = useTown((s) => s.selectedAgentId);
  const follow = useTown((s) => s.follow);

  useEffect(() => {
    camera.position.set(...cam.overviewPosition);
  }, [camera, cam]);

  useEffect(() => {
    if (overviewRequest === 0) return;
    fly.current = { pos: new THREE.Vector3(...cam.overviewPosition), target: new THREE.Vector3(...cam.overviewTarget) };
  }, [overviewRequest, cam]);

  // Selecting an agent glides the camera towards it.
  useEffect(() => {
    if (!selectedAgentId) return;
    const p = agentPositions.get(selectedAgentId);
    if (!p || !controls.current) return;
    const target = p.clone();
    const offset = camera.position.clone().sub(controls.current.target).setLength(26);
    fly.current = { pos: target.clone().add(offset), target };
  }, [selectedAgentId, camera]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const k = Math.min(1, dt * 3);
    if (follow && selectedAgentId) {
      const p = agentPositions.get(selectedAgentId);
      if (p) {
        const delta = p.clone().sub(c.target).multiplyScalar(k);
        c.target.add(delta);
        camera.position.add(delta);
      }
    } else if (fly.current) {
      camera.position.lerp(fly.current.pos, k);
      c.target.lerp(fly.current.target, k);
      if (camera.position.distanceTo(fly.current.pos) < 0.05) fly.current = null;
    }
    c.update();
  });

  return (
    <MapControls
      ref={controls}
      makeDefault
      target={cam.overviewTarget}
      enableDamping
      dampingFactor={0.12}
      minDistance={cam.minDistance}
      maxDistance={cam.maxDistance}
      minPolarAngle={cam.minPolar}
      maxPolarAngle={cam.maxPolar}
      screenSpacePanning={false}
      onStart={() => (fly.current = null)}
    />
  );
}
