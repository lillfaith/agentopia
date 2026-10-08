/**
 * Camera movement requests from outside the 3D canvas (keyboard and the on-screen
 * camera pad). Inputs are "held" while a key or button is down; the camera rig
 * reads them every frame, so movement is smooth and frame-rate independent.
 */
export type CameraAction = "forward" | "back" | "left" | "right" | "rotateLeft" | "rotateRight" | "tiltUp" | "tiltDown" | "zoomIn" | "zoomOut";

const held = new Map<string, CameraAction>();

export const cameraInput = {
  /** Start or stop one input source (a key code or a button id) driving an action. */
  hold(source: string, action: CameraAction, on: boolean) {
    if (on) held.set(source, action);
    else held.delete(source);
  },
  releaseAll() {
    held.clear();
  },
  active(): Set<CameraAction> {
    return new Set(held.values());
  },
};

const KEYS: Record<string, CameraAction> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyQ: "rotateLeft",
  KeyE: "rotateRight",
  KeyR: "tiltUp",
  KeyF: "tiltDown",
  Equal: "zoomIn",
  NumpadAdd: "zoomIn",
  Minus: "zoomOut",
  NumpadSubtract: "zoomOut",
};

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || !!el.closest?.("input, textarea, select"));
}

/** Installs keyboard listeners; returns a cleanup function. */
export function listenToKeyboard(): () => void {
  const down = (e: KeyboardEvent) => {
    const action = KEYS[e.code];
    if (!action || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    cameraInput.hold(`key:${e.code}`, action, true);
    e.preventDefault();
  };
  const up = (e: KeyboardEvent) => {
    if (KEYS[e.code]) cameraInput.hold(`key:${e.code}`, KEYS[e.code], false);
  };
  const blur = () => cameraInput.releaseAll();
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", blur);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", blur);
  };
}
