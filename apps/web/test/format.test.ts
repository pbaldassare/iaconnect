import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatMicros,
  formatMoney,
  formatMonth,
  formatNumber,
  formatRelative,
  shortId,
} from "../src/lib/format";

// Intl uses non-breaking spaces before units and currency symbols.
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

describe("formatDate / formatDateTime", () => {
  it("formats in Italian, in the Europe/Rome time zone", () => {
    expect(formatDate("2026-10-04T08:30:00Z")).toBe("4 ott 2026");
    expect(plain(formatDateTime("2026-10-04T08:30:00Z"))).toBe("4 ott 2026, 10:30");
  });

  it("uses the Rome day when UTC is still on the previous day", () => {
    expect(formatDate("2026-12-31T23:30:00Z")).toBe("1 gen 2027");
  });

  it("returns a dash for missing or invalid values", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
  });

  it("formats a month", () => {
    expect(formatMonth("2026-10-01")).toBe("ottobre 2026");
  });
});

describe("formatMoney", () => {
  it("drops decimals for whole amounts", () => {
    expect(plain(formatMoney(9900))).toBe("99 €");
  });
  it("keeps two decimals otherwise and groups thousands", () => {
    expect(plain(formatMoney(123450))).toBe("1.234,50 €");
  });
  it("handles zero and missing values", () => {
    expect(plain(formatMoney(0))).toBe("0 €");
    expect(formatMoney(null)).toBe("—");
  });
});

describe("formatMicros", () => {
  it("shows small AI costs with four decimals", () => {
    expect(plain(formatMicros(12_300))).toBe("0,0123 USD");
  });
  it("shows larger costs with two decimals", () => {
    expect(plain(formatMicros(2_500_000))).toBe("2,50 USD");
  });
});

describe("formatNumber", () => {
  it("groups thousands the Italian way", () => {
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatNumber(1234)).toBe("1.234");
    expect(formatNumber(null)).toBe("—");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  it("says 'adesso' within 45 seconds", () => {
    expect(formatRelative("2026-10-04T11:59:40Z", now)).toBe("adesso");
  });
  it("handles the past", () => {
    expect(formatRelative("2026-10-04T11:55:00Z", now)).toBe("5 minuti fa");
    expect(formatRelative("2026-10-04T09:00:00Z", now)).toBe("3 ore fa");
    expect(formatRelative("2026-10-03T12:00:00Z", now)).toBe("ieri");
    expect(formatRelative("2026-09-20T12:00:00Z", now)).toBe("2 settimane fa");
  });
  it("handles the future", () => {
    expect(formatRelative("2026-10-06T12:00:00Z", now)).toBe("dopodomani");
    expect(formatRelative("2026-10-04T14:00:00Z", now)).toBe("tra 2 ore");
  });
  it("returns a dash for missing values", () => {
    expect(formatRelative(null, now)).toBe("—");
  });
});

describe("shortId", () => {
  it("keeps the first 8 characters", () => {
    expect(shortId("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe("0f8fad5b");
    expect(shortId(null)).toBe("—");
  });
});
