import { describe, expect, it } from "vitest";
import { describeReport, sendReport } from "./client";

const fake = (status: number, body: unknown): typeof fetch => () => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

describe("report client", () => {
  it("posts JSON and returns the result, or explains the failure", async () => {
    let sentBody = "";
    const spy: typeof fetch = ((_url: string, init?: RequestInit) => {
      sentBody = typeof init?.body === "string" ? init.body : "";
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: "hinted", domain: "scam.example", hints: 2 }) } as Response);
    }) as typeof fetch;
    const result = await sendReport("https://dns.example/report", { name: "scam.example", category: "drainer" }, spy);
    expect(result).toEqual({ status: "hinted", domain: "scam.example", hints: 2 });
    expect(JSON.parse(sentBody)).toEqual({ name: "scam.example", category: "drainer" });
    await expect(sendReport("https://dns.example/report", {}, fake(429, ""))).rejects.toThrow(/rate limiting/);
    await expect(sendReport("https://dns.example/report", {}, fake(200, { nope: 1 }))).rejects.toThrow(/not a report result/);
    expect(await sendReport("https://dns.example/report", {}, fake(403, { status: "rejected", detail: "tier_too_low: tier 0 is below 1" }))).toEqual({ status: "rejected", detail: "tier_too_low: tier 0 is below 1" });
  });

  it("describes every outcome", () => {
    expect(describeReport({ status: "hinted", domain: "a.example", hints: 1 }, false)).toBe("Counted. First report. Link a tier to flag.");
    expect(describeReport({ status: "hinted", domain: "a.example", hints: 3 }, true)).toBe("Counted. 3 reports so far.");
    expect(describeReport({ status: "flagged", domain: "a.example", reporters: 1 }, true)).toBe("Flagged. 1 reporter so far.");
    expect(describeReport({ status: "confirmed", domain: "a.example", reporters: 2 }, true)).toBe("Confirmed. Blocked on every node.");
    expect(describeReport({ status: "already_blocked", domain: "a.example" }, false)).toBe("Already blocked.");
    expect(describeReport({ status: "rejected", detail: "no" }, false)).toBe("no");
  });
});
