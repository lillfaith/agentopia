import * as THREE from "three";

/** Live world positions of agents (written by actors each frame, read by the camera). */
export const agentPositions = new Map<string, THREE.Vector3>();
