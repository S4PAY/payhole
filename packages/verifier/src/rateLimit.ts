/** Fixed-window counter per key. Small and dependency-free; one instance per process. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  take(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    if (this.hits.size > 10_000) this.prune(now);
    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: now });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    entry.count += 1;
    if (entry.count > this.limit) {
      return { allowed: false, retryAfterSeconds: Math.ceil((entry.windowStart + this.windowMs - now) / 1000) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.hits) {
      if (now - entry.windowStart >= this.windowMs) this.hits.delete(key);
    }
  }
}
