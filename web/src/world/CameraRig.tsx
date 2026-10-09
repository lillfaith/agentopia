import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import * as THREE from "three";
import type { MapControls as MapControlsImpl } from "three-stdlib";
import type { ThemeManifest } from "../theme-engine/types";
import { useTown } from "../state/store";
import { agentPositions } from "./positions";
import { cameraInput, listenToKeyboard } from "./cameraInput";

/** How far from the centre the camera may look (keeps the view over the town). */
const MAX_TARGET_RADIUS = 24;
const _offset = new THREE.Vector3();
const _sph = new THREE.Spherical();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Free camera over the town.
 * Mouse: drag to pan, right-drag or Shift-drag to rotate, scroll to zoom.
 * Touch: one finger pans, two fingers pinch-zoom and rotate.
 * Keyboard: WASD/arrows move, Q/E rotate, R/F tilt, +/− zoom (plus the on-screen pad).
 */
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
    // `?cam=x,y,z,tx,ty,tz` opens on a specific viewpoint (screenshots, sharing a view).
    const v = new URLSearchParams(window.location.search).get("cam")?.split(",").map(Number);
    if (v && v.length === 6 && v.every(Number.isFinite)) {
      camera.position.set(v[0], v[1], v[2]);
      const t = setTimeout(() => controls.current?.target.set(v[3], v[4], v[5]), 0);
      return () => clearTimeout(t);
    }
  }, [camera, cam]);

  useEffect(() => listenToKeyboard(), []);

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
    // Real elapsed time (capped only for long stalls, e.g. a backgrounded tab) so speed is the same at any frame rate.
    const step = Math.min(dt, 0.25);

    // Keyboard / on-screen pad input.
    const act = cameraInput.active();
    if (act.size) {
      fly.current = null;
      _offset.copy(camera.position).sub(c.target);
      _sph.setFromVector3(_offset);
      // Pan along the ground, relative to where the camera faces; faster when zoomed out.
      const panSpeed = (8 + _sph.radius * 0.45) * step;
      _fwd.set(-_offset.x, 0, -_offset.z).normalize();
      _right.crossVectors(_fwd, _up).normalize();
      const move = new THREE.Vector3();
      if (act.has("forward")) move.add(_fwd);
      if (act.has("back")) move.sub(_fwd);
      if (act.has("right")) move.add(_right);
      if (act.has("left")) move.sub(_right);
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(panSpeed);
        c.target.add(move);
        if (follow) useTown.setState({ follow: false });
      }
      if (act.has("rotateLeft")) _sph.theta -= 1.4 * step;
      if (act.has("rotateRight")) _sph.theta += 1.4 * step;
      if (act.has("tiltUp")) _sph.phi -= 0.9 * step;
      if (act.has("tiltDown")) _sph.phi += 0.9 * step;
      if (act.has("zoomIn")) _sph.radius *= Math.exp(-1.6 * step);
      if (act.has("zoomOut")) _sph.radius *= Math.exp(1.6 * step);
      _sph.phi = THREE.MathUtils.clamp(_sph.phi, cam.minPolar, cam.maxPolar);
      _sph.radius = THREE.MathUtils.clamp(_sph.radius, cam.minDistance, cam.maxDistance);
      camera.position.copy(c.target).add(_offset.setFromSpherical(_sph));
    }

    // Keep the view over the island however it was moved (drag, keys or pad).
    const r = Math.hypot(c.target.x, c.target.z);
    if (r > MAX_TARGET_RADIUS) {
      const back = (r - MAX_TARGET_RADIUS) / r;
      const dx = c.target.x * back;
      const dz = c.target.z * back;
      c.target.x -= dx;
      c.target.z -= dz;
      camera.position.x -= dx;
      camera.position.z -= dz;
    }
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
      zoomSpeed={1.1}
      rotateSpeed={0.7}
      zoomToCursor
      onStart={() => (fly.current = null)}
    />
  );
}
