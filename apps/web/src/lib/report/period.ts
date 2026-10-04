/**
 * Report periods. Days and months are in UTC, like the usage counters
 * (`usage_period()` in the database). Pure, unit tested.
 */
export const PERIOD_KEYS = ["questo-mese", "mese-scorso", "7-giorni", "30-giorni", "90-giorni"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  "questo-mese": "Questo mese",
  "mese-scorso": "Mese scorso",
  "7-giorni": "Ultimi 7 giorni",
  "30-giorni": "Ultimi 30 giorni",
  "90-giorni": "Ultimi 90 giorni",
};

export function parsePeriod(value: string | string[] | undefined): PeriodKey {
  const raw = (Array.isArray(value) ? value[0] : value) ?? "";
  return (PERIOD_KEYS as readonly string[]).includes(raw) ? (raw as PeriodKey) : "questo-mese";
}

export interface PeriodRange {
  key: PeriodKey;
  /** Inclusive start, ISO. */
  from: string;
  /** Exclusive end, ISO. */
  to: string;
  /** Every UTC day of the range as `YYYY-MM-DD` (days in the future included, so a month is always whole). */
  days: string[];
  /** How many months of plan price the period corresponds to (1 for a month, days / 30 for "last N days"). */
  months: number;
}

const DAY = 86_400_000;
const startOfDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

export function periodRange(key: PeriodKey, now: Date = new Date()): PeriodRange {
  let from: number;
  let to: number;
  let months: number;
  if (key === "questo-mese") {
    from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    months = 1;
  } else if (key === "mese-scorso") {
    from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
    to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    months = 1;
  } else {
    const count = key === "7-giorni" ? 7 : key === "30-giorni" ? 30 : 90;
    // Today included: the last `count` days end at the next midnight.
    to = startOfDay(now) + DAY;
    from = to - count * DAY;
    months = count / 30;
  }
  const days: string[] = [];
  for (let t = from; t < to; t += DAY) days.push(new Date(t).toISOString().slice(0, 10));
  return { key, from: new Date(from).toISOString(), to: new Date(to).toISOString(), days, months };
}

/** True when the ISO timestamp falls inside the range. */
export function inRange(value: string | null | undefined, range: Pick<PeriodRange, "from" | "to">): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time >= new Date(range.from).getTime() && time < new Date(range.to).getTime();
}
