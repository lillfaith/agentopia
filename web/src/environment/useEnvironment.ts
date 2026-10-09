import { useEffect, useMemo, useState } from "react";
import { useTown } from "../state/store";
import type { ThemeManifest } from "../theme-engine/types";
import { environmentAt, type EnvironmentState } from "./dayCycle";

/** A clock that ticks every few seconds — lighting changes are minutes-scale, so this is plenty. */
export function useNow(intervalMs = 5000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Current environment (lighting, phase, weather) for the town's timezone and any manual override. */
export function useEnvironment(theme: ThemeManifest): EnvironmentState {
  const now = useNow();
  const timezone = useTown((s) => s.snapshot?.settings.timezone ?? "UTC");
  const override = useTown((s) => s.lightingOverride);
  return useMemo(() => environmentAt({ now, timezone, override, keyframes: theme.world.lightingKeyframes }), [now, timezone, override, theme]);
}
