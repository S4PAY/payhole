import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/rateLimit.js";

describe("RateLimiter", () => {
  it("allows the limit then denies until the window ends", () => {
    const limiter = new RateLimiter(3, 60_000);
    const t0 = 1_000_000;
    expect(limiter.take("a", t0).allowed).toBe(true);
    expect(limiter.take("a", t0 + 1).allowed).toBe(true);
    expect(limiter.take("a", t0 + 2).allowed).toBe(true);
    const denied = limiter.take("a", t0 + 30_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(30);
    expect(limiter.take("b", t0 + 3).allowed).toBe(true);
    expect(limiter.take("a", t0 + 60_000).allowed).toBe(true);
  });
});
