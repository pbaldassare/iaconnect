import { describe, expect, it } from "vitest";
import { chunk, fetchAllRows } from "../src/lib/report/fetch";
import {
  type DealRow,
  type MessageRow,
  aiSpendMicros,
  countPerDay,
  dealStats,
  dealsByFlow,
  economicReturn,
  firstReplyTime,
  formatDuration,
  formatPercent,
  funnel,
  messageStats,
  messagesPerDay,
  ratio,
  replyRate,
  runStats,
} from "../src/lib/report/metrics";
import { inRange, parsePeriod, periodRange } from "../src/lib/report/period";

const now = new Date("2026-10-04T10:30:00Z");

describe("periodRange", () => {
  it("this month: the whole UTC month", () => {
    const range = periodRange("questo-mese", now);
    expect(range.from).toBe("2026-10-01T00:00:00.000Z");
    expect(range.to).toBe("2026-11-01T00:00:00.000Z");
    expect(range.days).toHaveLength(31);
    expect(range.days[0]).toBe("2026-10-01");
    expect(range.months).toBe(1);
  });
  it("last month, also across the year", () => {
    expect(periodRange("mese-scorso", now)).toMatchObject({
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
      months: 1,
    });
    const january = periodRange("mese-scorso", new Date("2027-01-15T00:00:00Z"));
    expect(january.from).toBe("2026-12-01T00:00:00.000Z");
    expect(january.days).toHaveLength(31);
    expect(periodRange("mese-scorso", new Date("2026-03-31T12:00:00Z")).days).toHaveLength(28);
  });
  it("last N days include today", () => {
    const week = periodRange("7-giorni", now);
    expect(week.from).toBe("2026-09-28T00:00:00.000Z");
    expect(week.to).toBe("2026-10-05T00:00:00.000Z");
    expect(week.days).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(periodRange("30-giorni", now).days).toHaveLength(30);
    expect(periodRange("30-giorni", now).months).toBe(1);
    expect(periodRange("90-giorni", now).months).toBe(3);
  });
  it("parses the param and checks membership", () => {
    expect(parsePeriod("30-giorni")).toBe("30-giorni");
    expect(parsePeriod("boh")).toBe("questo-mese");
    expect(parsePeriod(undefined)).toBe("questo-mese");
    const range = periodRange("questo-mese", now);
    expect(inRange("2026-10-01T00:00:00Z", range)).toBe(true);
    expect(inRange("2026-11-01T00:00:00Z", range)).toBe(false);
    expect(inRange(null, range)).toBe(false);
  });
});

const range = periodRange("questo-mese", now);

describe("ratios and formats", () => {
  it("never divides by zero", () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0.25)).toBe("25%");
    expect(formatPercent(0.045)).toBe("4,5%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
  });
  it("formats durations", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(45)).toBe("45 sec");
    expect(formatDuration(720)).toBe("12 min");
    expect(formatDuration(3 * 3600 + 20 * 60)).toBe("3 h 20 min");
    expect(formatDuration(7200)).toBe("2 h");
    expect(formatDuration(52 * 3600)).toBe("2 g 4 h");
  });
});

describe("runStats", () => {
  it("counts live runs only", () => {
    expect(
      runStats([
        { status: "completed", mode: "live" },
        { status: "completed", mode: "live" },
        { status: "completed", mode: "live" },
        { status: "failed", mode: "live" },
        { status: "waiting", mode: "live" },
        { status: "running", mode: "live" },
        { status: "cancelled", mode: "live" },
        { status: "completed", mode: "simulation" },
      ]),
    ).toEqual({ total: 7, completed: 3, failed: 1, inProgress: 2, cancelled: 1, failureRate: 0.25 });
  });
  it("is all zeros on an empty period", () => {
    expect(runStats([])).toEqual({
      total: 0,
      completed: 0,
      failed: 0,
      inProgress: 0,
      cancelled: 0,
      failureRate: null,
    });
  });
});

const msg = (
  conversation: string,
  direction: "in" | "out",
  at: string,
  extra: Partial<MessageRow> = {},
): MessageRow => ({
  conversation_id: conversation,
  direction,
  channel: "whatsapp",
  delivery_status: direction === "in" ? "received" : "delivered",
  created_at: at,
  ...extra,
});

const messages: MessageRow[] = [
  // c1: the business writes, the contact replies
  msg("c1", "out", "2026-10-01T09:00:00Z", { ai_generated: true }),
  msg("c1", "in", "2026-10-01T09:10:00Z"),
  msg("c1", "out", "2026-10-01T09:12:00Z", { sent_by_user_id: "u1" }),
  // c2: the business writes, no reply
  msg("c2", "out", "2026-10-02T09:00:00Z", { channel: "mail", delivery_status: "sent" }),
  // c3: the contact writes first, answered after 10 minutes
  msg("c3", "in", "2026-10-02T10:00:00Z", { channel: "mail" }),
  msg("c3", "out", "2026-10-02T10:10:00Z", { channel: "mail", delivery_status: "read" }),
  // c4: the contact writes, nobody answers; a failed and a simulated send do not count
  msg("c4", "in", "2026-10-03T10:00:00Z"),
  msg("c4", "out", "2026-10-03T10:01:00Z", { delivery_status: "failed" }),
  msg("c4", "out", "2026-10-03T10:02:00Z", { delivery_status: "simulated" }),
  msg("c4", "out", "2026-10-03T10:03:00Z", { delivery_status: "queued" }),
];

describe("message metrics", () => {
  it("counts sent and received per channel", () => {
    const stats = messageStats(messages);
    expect(stats).toMatchObject({ sent: 4, received: 3, failed: 1, sentByAi: 1, sentByPeople: 1 });
    expect(stats.byChannel).toEqual([
      { channel: "whatsapp", sent: 2, received: 2 },
      { channel: "mail", sent: 2, received: 1 },
      { channel: "sms", sent: 0, received: 0 },
      { channel: "social", sent: 0, received: 0 },
    ]);
  });
  it("reply rate: conversations with an inbound after an outbound", () => {
    // contacted: c1, c2, c3 (c4 has no real outbound); replied: only c1
    expect(replyRate(messages)).toEqual({ contacted: 3, replied: 1, rate: 1 / 3 });
    expect(replyRate([])).toEqual({ contacted: 0, replied: 0, rate: null });
  });
  it("average time to the first reply of the business", () => {
    // c1: in 09:10 → out 09:12 = 120 s; c3: 600 s; c4 unanswered
    expect(firstReplyTime(messages)).toEqual({ answered: 2, unanswered: 1, averageSeconds: 360 });
    expect(firstReplyTime([])).toEqual({ answered: 0, unanswered: 0, averageSeconds: null });
    expect(firstReplyTime([msg("c9", "out", "2026-10-01T09:00:00Z")]).averageSeconds).toBeNull();
  });
  it("does not depend on the order of the rows", () => {
    expect(firstReplyTime([...messages].reverse())).toEqual(firstReplyTime(messages));
    expect(replyRate([...messages].reverse())).toEqual(replyRate(messages));
  });
  it("builds a point per day, zeros included", () => {
    const points = messagesPerDay(messages, ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(points).toEqual([
      { day: "2026-10-01", sent: 2, received: 1 },
      { day: "2026-10-02", sent: 2, received: 1 },
      { day: "2026-10-03", sent: 0, received: 1 },
      { day: "2026-10-04", sent: 0, received: 0 },
    ]);
    expect(messagesPerDay([], ["2026-10-01"])).toEqual([{ day: "2026-10-01", sent: 0, received: 0 }]);
    expect(
      countPerDay(
        ["2026-10-01T23:59:59Z", "2026-10-01T00:00:00Z", "2026-09-30T10:00:00Z"],
        ["2026-10-01", "2026-10-02"],
      ),
    ).toEqual([2, 0]);
  });
});

const stages = [
  { id: "new", name: "Nuova", position: 0, kind: "open" },
  { id: "neg", name: "In trattativa", position: 1, kind: "open" },
  { id: "won", name: "Chiusa", position: 2, kind: "won" },
  { id: "lost", name: "Persa", position: 3, kind: "lost" },
];
const deal = (
  id: string,
  stage: string,
  value: number | null,
  created: string,
  closed: string | null,
  run: string | null = null,
): DealRow => ({
  id,
  stage_id: stage,
  estimated_value_cents: value,
  created_at: created,
  closed_at: closed,
  origin_flow_run_id: run,
});
const deals: DealRow[] = [
  deal("d1", "won", 300_000, "2026-09-10T10:00:00Z", "2026-10-02T10:00:00Z", "r1"),
  deal("d2", "won", null, "2026-10-01T10:00:00Z", "2026-10-03T10:00:00Z", "r2"),
  deal("d3", "lost", 100_000, "2026-10-01T10:00:00Z", "2026-10-03T10:00:00Z", "r1"),
  deal("d4", "new", 50_000, "2026-10-02T10:00:00Z", null, "r3"),
  deal("d5", "neg", 70_000, "2026-08-01T10:00:00Z", null),
  deal("d6", "won", 900_000, "2026-08-01T10:00:00Z", "2026-09-15T10:00:00Z", "r1"),
];

describe("deal metrics", () => {
  it("counts created, won, lost, conversion and open value", () => {
    expect(dealStats(deals, stages, range)).toEqual({
      created: 3,
      won: 2,
      lost: 1,
      wonValueCents: 300_000,
      conversionRate: 2 / 3,
      open: 2,
      openValueCents: 120_000,
      wonWithoutValue: 1,
    });
  });
  it("is zero, with no conversion rate, on an empty period", () => {
    expect(dealStats([], stages, range)).toEqual({
      created: 0,
      won: 0,
      lost: 0,
      wonValueCents: 0,
      conversionRate: null,
      open: 0,
      openValueCents: 0,
      wonWithoutValue: 0,
    });
    expect(
      dealStats(deals, stages, periodRange("mese-scorso", new Date("2026-03-10T00:00:00Z"))).conversionRate,
    ).toBeNull();
  });
  it("builds the funnel in pipeline order with relative widths", () => {
    expect(funnel(deals, stages, range)).toEqual([
      { stageId: "new", name: "Nuova", kind: "open", count: 1, valueCents: 50_000, share: 0.5 },
      { stageId: "neg", name: "In trattativa", kind: "open", count: 1, valueCents: 70_000, share: 0.5 },
      { stageId: "won", name: "Chiusa", kind: "won", count: 2, valueCents: 300_000, share: 1 },
      { stageId: "lost", name: "Persa", kind: "lost", count: 1, valueCents: 100_000, share: 0.5 },
    ]);
    expect(funnel([], stages, range).every((step) => step.count === 0 && step.share === 0)).toBe(true);
  });
  it("groups results by originating flow", () => {
    const result = dealsByFlow({
      deals,
      stages,
      range,
      runFlow: new Map([
        ["r1", "f1"],
        ["r2", "f2"],
      ]),
      flowNames: new Map([["f1", "Preventivi"]]),
    });
    expect(result).toEqual([
      { flowId: "f1", name: "Preventivi", created: 1, won: 1, wonValueCents: 300_000, openValueCents: 0 },
      {
        flowId: null,
        name: "Create a mano o senza flusso",
        created: 1,
        won: 0,
        wonValueCents: 0,
        openValueCents: 120_000,
      },
      { flowId: "f2", name: "Flusso eliminato", created: 1, won: 1, wonValueCents: 0, openValueCents: 0 },
    ]);
    expect(dealsByFlow({ deals: [], stages, range, runFlow: new Map(), flowNames: new Map() })).toEqual([]);
  });
});

describe("economic return", () => {
  it("compares won value with the plan price for the period", () => {
    expect(economicReturn({ wonValueCents: 300_000, planPriceMonthlyCents: 24_900, months: 1 })).toEqual({
      wonValueCents: 300_000,
      planCostCents: 24_900,
      multiple: 300_000 / 24_900,
      netCents: 275_100,
    });
    expect(economicReturn({ wonValueCents: 0, planPriceMonthlyCents: 24_900, months: 3 })).toMatchObject({
      planCostCents: 74_700,
      multiple: 0,
      netCents: -74_700,
    });
    expect(
      economicReturn({ wonValueCents: 100, planPriceMonthlyCents: 9900, months: 7 / 30 }).planCostCents,
    ).toBe(2310);
  });
  it("has no multiple when the plan is free", () => {
    expect(economicReturn({ wonValueCents: 100, planPriceMonthlyCents: 0, months: 1 }).multiple).toBeNull();
  });
  it("sums the AI spend", () => {
    expect(aiSpendMicros([{ cost_micros: 1200 }, { cost_micros: 300 }])).toBe(1500);
    expect(aiSpendMicros([])).toBe(0);
  });
});

describe("fetchAllRows", () => {
  const source = (total: number) => {
    const calls: [number, number][] = [];
    const page = async (from: number, to: number) => {
      calls.push([from, to]);
      const data = Array.from(
        { length: Math.max(0, Math.min(to, total - 1) - from + 1) },
        (_, i) => from + i,
      );
      return { data, error: null };
    };
    return { page, calls };
  };
  it("reads page after page until a short page", async () => {
    const { page, calls } = source(25);
    const result = await fetchAllRows(page, 100, 10);
    expect(result.rows).toHaveLength(25);
    expect(result.truncated).toBe(false);
    expect(calls).toEqual([
      [0, 9],
      [10, 19],
      [20, 29],
    ]);
  });
  it("says when the cap cut the result, and when it fitted exactly", async () => {
    const cut = await fetchAllRows(source(45).page, 30, 10);
    expect(cut.rows).toHaveLength(30);
    expect(cut.truncated).toBe(true);
    const exact = await fetchAllRows(source(30).page, 30, 10);
    expect(exact.rows).toHaveLength(30);
    expect(exact.truncated).toBe(false);
  });
  it("stops at the first error and handles no rows", async () => {
    const failing = await fetchAllRows(async () => ({ data: null, error: { code: "X" } }), 30, 10);
    expect(failing).toEqual({ rows: [], truncated: false, error: { code: "X" } });
    expect((await fetchAllRows(source(0).page, 30, 10)).rows).toEqual([]);
  });
  it("chunks ids", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});
