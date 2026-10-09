import { useEffect, useState } from "react";
import { cameraInput, type CameraAction } from "../world/cameraInput";
import { useTown } from "../state/store";

const PREF = "agentopia.cameraPad";

/** A press-and-hold button that drives one camera action. */
function HoldButton({ id, action, label, children }: { id: string; action: CameraAction; label: string; children: React.ReactNode }) {
  const set = (on: boolean) => cameraInput.hold(`pad:${id}`, action, on);
  return (
    <button
      type="button"
      className="cam-btn"
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          set(true);
        }
      }}
      onKeyUp={() => set(false)}
      onBlur={() => set(false)}
    >
      {children}
    </button>
  );
}

/** On-screen camera controls: move, rotate, tilt and zoom (also on the keyboard). */
export function CameraPad() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(PREF) !== "closed";
    } catch {
      return true;
    }
  });
  const overview = useTown((s) => s.requestOverview);
  useEffect(() => {
    try {
      localStorage.setItem(PREF, open ? "open" : "closed");
    } catch {
      /* storage unavailable */
    }
    if (!open) cameraInput.releaseAll();
  }, [open]);

  if (!open)
    return (
      <button type="button" className="panel cam-toggle" onClick={() => setOpen(true)} title="Show camera controls">
        🎥
      </button>
    );
  return (
    <div className="panel cam-pad" role="group" aria-label="Camera controls">
      <div className="cam-grid">
        <HoldButton id="rl" action="rotateLeft" label="Rotate left (Q)">
          ⟲
        </HoldButton>
        <HoldButton id="f" action="forward" label="Move forward (W / ↑)">
          ▲
        </HoldButton>
        <HoldButton id="rr" action="rotateRight" label="Rotate right (E)">
          ⟳
        </HoldButton>
        <HoldButton id="l" action="left" label="Move left (A / ←)">
          ◀
        </HoldButton>
        <button type="button" className="cam-btn cam-home" onClick={overview} title="Back to the overview">
          ⌂
        </button>
        <HoldButton id="r" action="right" label="Move right (D / →)">
          ▶
        </HoldButton>
        <HoldButton id="tu" action="tiltUp" label="Tilt to look down (R)">
          ⤒
        </HoldButton>
        <HoldButton id="b" action="back" label="Move back (S / ↓)">
          ▼
        </HoldButton>
        <HoldButton id="td" action="tiltDown" label="Tilt toward the horizon (F)">
          ⤓
        </HoldButton>
      </div>
      <div className="cam-zoom">
        <HoldButton id="zi" action="zoomIn" label="Zoom in (+)">
          ＋
        </HoldButton>
        <HoldButton id="zo" action="zoomOut" label="Zoom out (−)">
          －
        </HoldButton>
        <button type="button" className="cam-btn cam-hide" onClick={() => setOpen(false)} title="Hide camera controls">
          ✕
        </button>
      </div>
      <p className="cam-hint">Drag to move · right-drag or ⇧-drag to rotate · scroll to zoom · WASD QE RF</p>
    </div>
  );
}
