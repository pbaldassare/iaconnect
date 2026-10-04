import type { Tone } from "@/lib/labels";
import type { PlanLimits } from "@ia-connect/core";

/** Usage versus plan limits. Pure functions, unit tested. */

/** First day of the current month (UTC), the `period` key of `usage_counters`. */
export function usagePeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

const LIMIT_KEYS = [
  "active_flows",
  "messages_per_month",
  "ai_credits_per_month",
  "scrape_runs_per_month",
] as const satisfies readonly (keyof PlanLimits)[];
export type LimitKey = (typeof LIMIT_KEYS)[number];

/** Reads `plans.limits` defensively: anything that is not a number counts as "no limit set". */
export function parsePlanLimits(value: unknown): Partial<PlanLimits> {
  const out: Partial<PlanLimits> = {};
  if (typeof value !== "object" || value === null) return out;
  const record = value as Record<string, unknown>;
  for (const key of LIMIT_KEYS) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return out;
}

export interface UsageRow {
  key: "active_flows" | "messages" | "ai_credits" | "scrape_runs";
  label: string;
  used: number;
  /** null = unlimited (limit missing or negative). */
  limit: number | null;
  /** 0..1, capped; 0 when unlimited. */
  ratio: number;
  tone: Tone;
  /** Short status in Italian, e.g. "Restano 120" or "Limite raggiunto". */
  note: string;
}

export function usageTone(used: number, limit: number | null): Tone {
  if (limit === null) return "neutral";
  if (limit === 0) return used > 0 ? "error" : "neutral";
  const ratio = used / limit;
  if (ratio >= 1) return "error";
  if (ratio >= 0.8) return "warning";
  return "ok";
}

function usageNote(used: number, limit: number | null): string {
  if (limit === null) return "Senza limite";
  if (limit === 0) return "Non incluso nel piano";
  if (used >= limit) return "Limite raggiunto";
  return `Restano ${new Intl.NumberFormat("it-IT", { useGrouping: "always" }).format(limit - used)}`;
}

function row(key: UsageRow["key"], label: string, used: number, rawLimit: number | undefined): UsageRow {
  const limit = rawLimit === undefined || rawLimit < 0 ? null : rawLimit;
  const ratio = limit === null || limit === 0 ? 0 : Math.min(used / limit, 1);
  return { key, label, used, limit, ratio, tone: usageTone(used, limit), note: usageNote(used, limit) };
}

/**
 * Builds the four usage rows shown on Inizio and in the admin organization page.
 * `counters` are this month's `usage_counters` rows; `activeFlows` is counted from `flows`.
 */
export function buildUsage(
  limits: Partial<PlanLimits>,
  counters: readonly { metric: string; value: number }[],
  activeFlows: number,
): UsageRow[] {
  const value = (metric: string) => counters.find((c) => c.metric === metric)?.value ?? 0;
  return [
    row("messages", "Messaggi inviati", value("messages"), limits.messages_per_month),
    row("ai_credits", "Crediti IA", value("ai_credits"), limits.ai_credits_per_month),
    row("scrape_runs", "Letture da siti", value("scrape_runs"), limits.scrape_runs_per_month),
    row("active_flows", "Flussi attivi", activeFlows, limits.active_flows),
  ];
}
