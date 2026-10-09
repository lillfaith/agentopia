/**
 * Fixed-window rate limiter kept in memory. Agentopia runs as one container, so
 * a process-local limiter is exact; a multi-instance deployment would move this
 * to a shared store.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = Date.now();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  /** Count one hit for `key`. */
  hit(key: string, now = Date.now()): { ok: boolean; retryAfterSec: number } {
    this.sweep(now);
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    return { ok: entry.count <= this.limit, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }

  /** Is `key` currently over the limit (without counting a hit)? */
  blocked(key: string, now = Date.now()): { blocked: boolean; retryAfterSec: number } {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) return { blocked: false, retryAfterSec: 0 };
    return { blocked: entry.count >= this.limit, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
