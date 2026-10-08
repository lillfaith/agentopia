import { useState } from "react";
import { LIGHTING_OVERRIDES, PHASE_LABEL, formatClock, phaseForHour } from "../environment/dayCycle";
import { useEnvironment } from "../environment/useEnvironment";
import { useTown } from "../state/store";
import { useTheme } from "../theme-engine/ThemeContext";

const PHASE_ICON: Record<string, string> = { night: "🌙", sunrise: "🌅", morning: "🌤️", daytime: "☀️", golden: "🌇", sunset: "🌆", evening: "🌃" };

/**
 * Small in-game clock. Always shows the REAL local time in the town timezone;
 * the lighting override (for screenshots/testing) only changes the look of the
 * world, never schedules or the clock.
 */
export function TownClock() {
  const theme = useTheme();
  const env = useEnvironment(theme);
  const override = useTown((s) => s.lightingOverride);
  const setOverride = useTown((s) => s.setLightingOverride);
  const [open, setOpen] = useState(false);
  const realPhase = phaseForHour(env.realHour);
  return (
    <div className="town-clock">
      <button className="clock-face" onClick={() => setOpen(!open)} title={`Town time in ${env.timezone}. Click for lighting options.`}>
        <span className="clock-icon">{PHASE_ICON[env.phase]}</span>
        <b>{formatClock(env.realHour)}</b>
        <span className="clock-phase">{PHASE_LABEL[realPhase]}</span>
        {env.isOverride && <span className="clock-override">lighting: {PHASE_LABEL[env.phase]}</span>}
      </button>
      {open && (
        <div className="popover clock-pop">
          <div className="pop-title">Town lighting</div>
          <button className={`pop-row ${override === null ? "on" : ""}`} onClick={() => (setOverride(null), setOpen(false))}>
            🕰️ Live — follow real time <small>{env.timezone}</small>
          </button>
          {LIGHTING_OVERRIDES.map((o) => (
            <button key={o.id} className={`pop-row ${override === o.hour ? "on" : ""}`} onClick={() => (setOverride(o.hour), setOpen(false))}>
              {o.icon} {PHASE_LABEL[o.id]}
            </button>
          ))}
          <small className="muted">Overrides change only how the town looks. Schedules always use real time.</small>
        </div>
      )}
    </div>
  );
}
