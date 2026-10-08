/**
 * Time-zone math shared by the server (schedules) and the browser (town clock
 * and lighting), so both always agree about "local time" — including DST.
 * Dependency-free: uses the platform's Intl time-zone database.
 */
import type { Weekday } from "./types.js";

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface LocalParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  weekday: Weekday;
}

const WEEKDAYS: Record<string, Weekday> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function localParts(date: Date, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: +get("year"), m: +get("month"), d: +get("day"), h: +get("hour"), mi: +get("minute"), s: +get("second"), weekday: WEEKDAYS[get("weekday")] };
}

/** Local wall-clock time in `tz` as fractional hours, 0 ≤ h < 24. */
export function localHour(date: Date, tz: string): number {
  const p = localParts(date, tz);
  return p.h + p.mi / 60 + p.s / 3600;
}

/** Offset (ms) of `tz` from UTC at instant `t`. */
function offsetAt(t: number, tz: string): number {
  const p = localParts(new Date(t), tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(t / 60_000) * 60_000;
}

/**
 * UTC instant for a local wall-clock time. Non-existent local times (spring-forward gap)
 * are shifted forward by the gap (02:30 → 03:30); ambiguous times (fall-back) resolve
 * to the earlier occurrence.
 */
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(first, tz);
  const t = Math.min(first, second);
  const back = localParts(new Date(t), tz);
  if (back.h === h && back.mi === mi) return new Date(t);
  const other = Math.max(first, second);
  const back2 = localParts(new Date(other), tz);
  if (back2.h === h && back2.mi === mi) return new Date(other);
  // In a DST gap: use the later candidate (wall time shifted forward by the gap).
  return new Date(other);
}
