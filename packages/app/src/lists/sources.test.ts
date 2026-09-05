import { describe, expect, it } from "vitest";

import { fetchLastUpdated, formatAge, LIST_SOURCES, parseCommitDate } from "./sources";

describe("parseCommitDate", () => {
  it("reads the committer date from a commits payload", () => {
    const payload = [{ commit: { committer: { date: "2026-09-04T03:00:00Z" } } }];
    expect(parseCommitDate(payload)?.toISOString()).toBe("2026-09-04T03:00:00.000Z");
  });

  it("falls back to the author date and rejects anything else", () => {
    expect(parseCommitDate([{ commit: { author: { date: "2026-09-01T00:00:00Z" } } }])?.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(parseCommitDate([])).toBeNull();
    expect(parseCommitDate({ message: "rate limited" })).toBeNull();
    expect(parseCommitDate([{ commit: { committer: { date: "not a date" } } }])).toBeNull();
  });
});

describe("fetchLastUpdated", () => {
  const source = LIST_SOURCES[0];
  if (source === undefined) throw new Error("no list sources");

  it("asks GitHub for the last commit touching the list file", async () => {
    let seen = "";
    const date = await fetchLastUpdated(source, (input) => {
      seen = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(Response.json([{ commit: { committer: { date: "2026-09-04T03:00:00Z" } } }]));
    });
    expect(seen).toBe(
      "https://api.github.com/repos/scamsniffer/scam-database/commits?path=blacklist%2Fdomains.json&per_page=1",
    );
    expect(date?.toISOString()).toBe("2026-09-04T03:00:00.000Z");
  });

  it("returns null when offline or rate limited", async () => {
    expect(await fetchLastUpdated(source, () => Promise.reject(new Error("offline")))).toBeNull();
    expect(await fetchLastUpdated(source, () => Promise.resolve(new Response("{}", { status: 403 })))).toBeNull();
  });
});

describe("formatAge", () => {
  const now = new Date("2026-09-05T12:00:00Z");
  it("describes the distance in whole days", () => {
    expect(formatAge(new Date("2026-09-05T03:00:00Z"), now)).toBe("today");
    expect(formatAge(new Date("2026-09-04T03:00:00Z"), now)).toBe("yesterday");
    expect(formatAge(new Date("2026-08-30T03:00:00Z"), now)).toBe("6 days ago");
  });
});
