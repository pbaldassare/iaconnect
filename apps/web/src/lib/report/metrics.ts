/**
 * Report figures. Every function takes plain rows and returns plain numbers,
 * so each metric is tested on fixtures. A ratio with a zero denominator is
 * `null` ("—" on the page), never NaN or 0.
 */
import { CHANNEL_KEYS, type ChannelKey } from "../customer-labels";

/** `part / total`, or null when there is nothing to divide by. */
export function ratio(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

/** "42%" / "4,5%" / "—". */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const percent = value * 100;
  const digits = percent > 0 && percent < 10 && !Number.isInteger(percent) ? 1 : 0;
  return `${percent.toFixed(digits).replace(".", ",")}%`;
}

/** Seconds → "45 sec", "12 min", "3 h 20 min", "2 g 4 h". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} sec`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days} g` : `${days} g ${hours % 24} h`;
}

// ── Flow runs ────────────────────────────────────────────────────────────

export interface RunStats {
  total: number;
  completed: number;
  failed: number;
  /** running + waiting */
  inProgress: number;
  cancelled: number;
  /** failed / (completed + failed) */
  failureRate: number | null;
}

/** Simulations are not results: only live runs are counted. */
export function runStats(runs: readonly { status: string; mode: string }[]): RunStats {
  const live = runs.filter((run) => run.mode === "live");
  const count = (...statuses: string[]) => live.filter((run) => statuses.includes(run.status)).length;
  const completed = count("completed");
  const failed = count("failed");
  return {
    total: live.length,
    completed,
    failed,
    inProgress: count("running", "waiting"),
    cancelled: count("cancelled"),
    failureRate: ratio(failed, completed + failed),
  };
}

// ── Messages ─────────────────────────────────────────────────────────────

export interface MessageRow {
  conversation_id: string;
  direction: string;
  channel: string;
  delivery_status: string;
  created_at: string;
  ai_generated?: boolean;
  sent_by_user_id?: string | null;
}

/** A message that really left: not queued, not failed, not simulated. */
export function wasSent(message: Pick<MessageRow, "direction" | "delivery_status">): boolean {
  return message.direction === "out" && ["sent", "delivered", "read"].includes(message.delivery_status);
}
export function wasReceived(message: Pick<MessageRow, "direction" | "delivery_status">): boolean {
  return message.direction === "in" && message.delivery_status !== "simulated";
}

export interface ChannelMessageStats {
  channel: ChannelKey;
  sent: number;
  received: number;
}
export interface MessageStats {
  sent: number;
  received: number;
  /** Outbound messages the worker refused or could not deliver. */
  failed: number;
  /** Sent messages written by the AI. */
  sentByAi: number;
  /** Sent messages typed by a person in the inbox. */
  sentByPeople: number;
  byChannel: ChannelMessageStats[];
}

export function messageStats(messages: readonly MessageRow[]): MessageStats {
  const byChannel = CHANNEL_KEYS.map((channel) => ({ channel, sent: 0, received: 0 }));
  const stats: MessageStats = { sent: 0, received: 0, failed: 0, sentByAi: 0, sentByPeople: 0, byChannel };
  for (const message of messages) {
    const bucket = byChannel.find((row) => row.channel === message.channel);
    if (wasSent(message)) {
      stats.sent++;
      if (bucket) bucket.sent++;
      if (message.ai_generated) stats.sentByAi++;
      if (message.sent_by_user_id) stats.sentByPeople++;
    } else if (wasReceived(message)) {
      stats.received++;
      if (bucket) bucket.received++;
    } else if (message.direction === "out" && message.delivery_status === "failed") stats.failed++;
  }
  return stats;
}

function byConversation(messages: readonly MessageRow[]): Map<string, MessageRow[]> {
  const map = new Map<string, MessageRow[]>();
  for (const message of messages) {
    if (!wasSent(message) && !wasReceived(message)) continue;
    const list = map.get(message.conversation_id) ?? [];
    list.push(message);
    map.set(message.conversation_id, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  return map;
}

export interface ReplyRate {
  /** Conversations where the business wrote at least once in the period. */
  contacted: number;
  /** Of those, the ones where the contact wrote after the first outbound message. */
  replied: number;
  rate: number | null;
}

export function replyRate(messages: readonly MessageRow[]): ReplyRate {
  let contacted = 0;
  let replied = 0;
  for (const list of byConversation(messages).values()) {
    const firstOut = list.findIndex((message) => message.direction === "out");
    if (firstOut === -1) continue;
    contacted++;
    if (list.slice(firstOut + 1).some((message) => message.direction === "in")) replied++;
  }
  return { contacted, replied, rate: ratio(replied, contacted) };
}

export interface FirstReplyTime {
  /** Conversations where a contact wrote and the business answered afterwards. */
  answered: number;
  /** Conversations where a contact wrote and nobody answered within the data read. */
  unanswered: number;
  averageSeconds: number | null;
}

/**
 * Average time between the first message of a contact in the period and the
 * first answer of the business (automation or person) after it, per conversation.
 */
export function firstReplyTime(messages: readonly MessageRow[]): FirstReplyTime {
  let answered = 0;
  let unanswered = 0;
  let totalSeconds = 0;
  for (const list of byConversation(messages).values()) {
    const firstIn = list.findIndex((message) => message.direction === "in");
    if (firstIn === -1) continue;
    const reply = list.slice(firstIn + 1).find((message) => message.direction === "out");
    if (!reply) {
      unanswered++;
      continue;
    }
    answered++;
    totalSeconds +=
      (new Date(reply.created_at).getTime() - new Date(list[firstIn]!.created_at).getTime()) / 1000;
  }
  return { answered, unanswered, averageSeconds: answered > 0 ? totalSeconds / answered : null };
}

// ── Deals ────────────────────────────────────────────────────────────────

export interface DealRow {
  id: string;
  stage_id: string;
  estimated_value_cents: number | null;
  created_at: string;
  closed_at: string | null;
  origin_flow_run_id: string | null;
}
export interface StageRow {
  id: string;
  name: string;
  position: number;
  kind: string;
}
interface Range {
  from: string;
  to: string;
}

const within = (value: string | null, range: Range) => {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time >= new Date(range.from).getTime() && time < new Date(range.to).getTime();
};
const sumValue = (deals: readonly DealRow[]) =>
  deals.reduce((sum, deal) => sum + (deal.estimated_value_cents ?? 0), 0);

export interface DealStats {
  created: number;
  won: number;
  lost: number;
  wonValueCents: number;
  /** won / (won + lost), among the deals closed in the period. */
  conversionRate: number | null;
  /** Deals still in an open stage (whenever they were created) and their value. */
  open: number;
  openValueCents: number;
  /** Won deals without an estimated value: their value is missing from the totals. */
  wonWithoutValue: number;
}

/** `deals` must contain the deals created or closed in the period and every open deal. */
export function dealStats(deals: readonly DealRow[], stages: readonly StageRow[], range: Range): DealStats {
  const kind = new Map(stages.map((stage) => [stage.id, stage.kind]));
  const closedIn = (wanted: string) =>
    deals.filter((deal) => kind.get(deal.stage_id) === wanted && within(deal.closed_at, range));
  const won = closedIn("won");
  const lost = closedIn("lost");
  const open = deals.filter((deal) => kind.get(deal.stage_id) === "open");
  return {
    created: deals.filter((deal) => within(deal.created_at, range)).length,
    won: won.length,
    lost: lost.length,
    wonValueCents: sumValue(won),
    conversionRate: ratio(won.length, won.length + lost.length),
    open: open.length,
    openValueCents: sumValue(open),
    wonWithoutValue: won.filter((deal) => deal.estimated_value_cents === null).length,
  };
}

export interface FunnelStep {
  stageId: string;
  name: string;
  kind: string;
  count: number;
  valueCents: number;
  /** Width of the bar, 0..1, relative to the fullest stage. */
  share: number;
}

/**
 * Deals by stage, in pipeline order: open stages show the deals in them now,
 * won and lost stages the deals closed in the period.
 */
export function funnel(deals: readonly DealRow[], stages: readonly StageRow[], range: Range): FunnelStep[] {
  const steps = [...stages]
    .sort((a, b) => a.position - b.position)
    .map((stage) => {
      const inStage = deals.filter(
        (deal) => deal.stage_id === stage.id && (stage.kind === "open" || within(deal.closed_at, range)),
      );
      return {
        stageId: stage.id,
        name: stage.name,
        kind: stage.kind,
        count: inStage.length,
        valueCents: sumValue(inStage),
        share: 0,
      };
    });
  const max = Math.max(0, ...steps.map((step) => step.count));
  return steps.map((step) => ({ ...step, share: max > 0 ? step.count / max : 0 }));
}

export interface FlowResult {
  /** null = deals created by hand or whose flow no longer exists. */
  flowId: string | null;
  name: string;
  created: number;
  won: number;
  wonValueCents: number;
  openValueCents: number;
}

/**
 * Which flow brings results: deals grouped by the flow of their originating run.
 * Counts deals created in the period, deals won in the period and the value still open.
 * Sorted by won value, then by deals created.
 */
export function dealsByFlow(input: {
  deals: readonly DealRow[];
  stages: readonly StageRow[];
  /** run id → flow id */
  runFlow: ReadonlyMap<string, string>;
  /** flow id → name */
  flowNames: ReadonlyMap<string, string>;
  range: Range;
}): FlowResult[] {
  const kind = new Map(input.stages.map((stage) => [stage.id, stage.kind]));
  const groups = new Map<string, FlowResult>();
  for (const deal of input.deals) {
    const flowId = deal.origin_flow_run_id ? (input.runFlow.get(deal.origin_flow_run_id) ?? null) : null;
    const key = flowId ?? "";
    const group = groups.get(key) ?? {
      flowId,
      name: flowId ? (input.flowNames.get(flowId) ?? "Flusso eliminato") : "Create a mano o senza flusso",
      created: 0,
      won: 0,
      wonValueCents: 0,
      openValueCents: 0,
    };
    const stageKind = kind.get(deal.stage_id);
    const value = deal.estimated_value_cents ?? 0;
    let counted = false;
    if (within(deal.created_at, input.range)) {
      group.created++;
      counted = true;
    }
    if (stageKind === "won" && within(deal.closed_at, input.range)) {
      group.won++;
      group.wonValueCents += value;
      counted = true;
    }
    if (stageKind === "open") {
      group.openValueCents += value;
      counted = true;
    }
    if (counted) groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.wonValueCents - a.wonValueCents || b.created - a.created || a.name.localeCompare(b.name, "it"),
  );
}

// ── Economic return ──────────────────────────────────────────────────────

/** Sum of `ai_calls.cost_micros` (millionths of a US dollar, as billed by the AI provider). */
export function aiSpendMicros(calls: readonly { cost_micros: number }[]): number {
  return calls.reduce((sum, call) => sum + (call.cost_micros ?? 0), 0);
}

export interface EconomicReturn {
  wonValueCents: number;
  /** Plan price for the length of the period. */
  planCostCents: number;
  /** Won value for every euro of plan price; null when the plan is free. */
  multiple: number | null;
  /** wonValue − planCost */
  netCents: number;
}

export function economicReturn(input: {
  wonValueCents: number;
  planPriceMonthlyCents: number;
  /** Months covered by the period (see PeriodRange.months). */
  months: number;
}): EconomicReturn {
  const planCostCents = Math.round(Math.max(0, input.planPriceMonthlyCents) * Math.max(0, input.months));
  return {
    wonValueCents: input.wonValueCents,
    planCostCents,
    multiple: planCostCents > 0 ? input.wonValueCents / planCostCents : null,
    netCents: input.wonValueCents - planCostCents,
  };
}

// ── Series for the charts ────────────────────────────────────────────────

export interface DayPoint {
  day: string;
  sent: number;
  received: number;
}

/** Messages per UTC day; days without messages are present with zeros. */
export function messagesPerDay(messages: readonly MessageRow[], days: readonly string[]): DayPoint[] {
  const index = new Map(days.map((day, i) => [day, i]));
  const points = days.map((day) => ({ day, sent: 0, received: 0 }));
  for (const message of messages) {
    const i = index.get(message.created_at.slice(0, 10));
    if (i === undefined) continue;
    if (wasSent(message)) points[i]!.sent++;
    else if (wasReceived(message)) points[i]!.received++;
  }
  return points;
}

/** Rows per UTC day for any table with a timestamp. */
export function countPerDay(timestamps: readonly string[], days: readonly string[]): number[] {
  const index = new Map(days.map((day, i) => [day, i]));
  const counts = days.map(() => 0);
  for (const timestamp of timestamps) {
    const i = index.get(timestamp.slice(0, 10));
    if (i !== undefined) counts[i]!++;
  }
  return counts;
}
