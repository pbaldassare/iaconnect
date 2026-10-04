import { describe, expect, it } from "vitest";
import { buildUsage, parsePlanLimits, usagePeriod, usageTone } from "../src/lib/usage";

describe("usagePeriod", () => {
  it("is the first day of the month in UTC", () => {
    expect(usagePeriod(new Date("2026-10-04T08:00:00Z"))).toBe("2026-10-01");
    expect(usagePeriod(new Date("2026-01-31T23:59:59Z"))).toBe("2026-01-01");
  });
});

describe("parsePlanLimits", () => {
  it("keeps numeric limits and ignores the rest", () => {
    expect(
      parsePlanLimits({ active_flows: 3, messages_per_month: "1000", ai_credits_per_month: 500, other: 1 }),
    ).toEqual({ active_flows: 3, ai_credits_per_month: 500 });
  });
  it("tolerates null and non-objects", () => {
    expect(parsePlanLimits(null)).toEqual({});
    expect(parsePlanLimits("x")).toEqual({});
  });
});

describe("usageTone", () => {
  it("is ok below 80%, warning from 80%, error at the limit", () => {
    expect(usageTone(79, 100)).toBe("ok");
    expect(usageTone(80, 100)).toBe("warning");
    expect(usageTone(100, 100)).toBe("error");
    expect(usageTone(140, 100)).toBe("error");
  });
  it("is neutral when unlimited or not included and unused", () => {
    expect(usageTone(999, null)).toBe("neutral");
    expect(usageTone(0, 0)).toBe("neutral");
    expect(usageTone(1, 0)).toBe("error");
  });
});

describe("buildUsage", () => {
  const limits = {
    active_flows: 3,
    messages_per_month: 1000,
    scrape_runs_per_month: 0,
    ai_credits_per_month: -1,
  };
  const rows = buildUsage(
    limits,
    [
      { metric: "messages", value: 850 },
      { metric: "ai_credits", value: 40 },
      { metric: "flow_runs", value: 12 },
    ],
    3,
  );
  const by = (key: string) => rows.find((r) => r.key === key)!;

  it("returns the four rows in display order", () => {
    expect(rows.map((r) => r.key)).toEqual(["messages", "ai_credits", "scrape_runs", "active_flows"]);
  });
  it("computes ratio, tone and note against the limit", () => {
    expect(by("messages")).toMatchObject({
      used: 850,
      limit: 1000,
      ratio: 0.85,
      tone: "warning",
      note: "Restano 150",
    });
  });
  it("treats a negative limit as unlimited", () => {
    expect(by("ai_credits")).toMatchObject({
      used: 40,
      limit: null,
      ratio: 0,
      tone: "neutral",
      note: "Senza limite",
    });
  });
  it("marks a zero limit as not included in the plan", () => {
    expect(by("scrape_runs")).toMatchObject({ used: 0, limit: 0, ratio: 0, note: "Non incluso nel piano" });
  });
  it("uses the active flow count and flags a reached limit", () => {
    expect(by("active_flows")).toMatchObject({
      used: 3,
      limit: 3,
      ratio: 1,
      tone: "error",
      note: "Limite raggiunto",
    });
  });
  it("counts missing counters as zero and missing limits as unlimited", () => {
    const empty = buildUsage({}, [], 0);
    expect(empty.every((r) => r.used === 0 && r.limit === null)).toBe(true);
  });
  it("caps the ratio at 1 when usage exceeds the limit", () => {
    expect(buildUsage({ messages_per_month: 10 }, [{ metric: "messages", value: 25 }], 0)[0]!.ratio).toBe(1);
  });
});
