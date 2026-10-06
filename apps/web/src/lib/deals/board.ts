/** Deal board: grouping, totals, stage changes, filters. Pure, unit tested. */

export interface StageLike {
  id: string;
  name: string;
  position: number;
  kind: string;
}
export interface DealLike {
  id: string;
  stage_id: string;
  estimated_value_cents: number | null;
  created_at: string;
  closed_at: string | null;
  assignee_user_id: string | null;
}

export function sortStages<S extends StageLike>(stages: readonly S[]): S[] {
  return [...stages].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "it"));
}

export interface BoardColumn<S extends StageLike, D extends DealLike> {
  stage: S;
  deals: D[];
  count: number;
  /** Sum of the estimated values in cents; deals without a value count as 0. */
  valueCents: number;
  /** Deals in the column that have no estimated value. */
  withoutValue: number;
}

/**
 * One column per stage, in pipeline order. Inside a column, open deals are
 * ordered by next action date (the most urgent first, those without a date
 * last); closed ones by closing date, the latest first.
 */
export function buildBoard<S extends StageLike, D extends DealLike & { next_action_at?: string | null }>(
  stages: readonly S[],
  deals: readonly D[],
): BoardColumn<S, D>[] {
  const time = (value: string | null | undefined) => (value ? new Date(value).getTime() : null);
  return sortStages(stages).map((stage) => {
    const inStage = deals.filter((deal) => deal.stage_id === stage.id);
    const sorted = [...inStage].sort((a, b) => {
      if (stage.kind !== "open") {
        return (time(b.closed_at) ?? time(b.created_at)!) - (time(a.closed_at) ?? time(a.created_at)!);
      }
      const an = time(a.next_action_at);
      const bn = time(b.next_action_at);
      if (an !== null && bn !== null && an !== bn) return an - bn;
      if (an !== null && bn === null) return -1;
      if (an === null && bn !== null) return 1;
      return time(b.created_at)! - time(a.created_at)!;
    });
    return {
      stage,
      deals: sorted,
      count: inStage.length,
      valueCents: inStage.reduce((sum, deal) => sum + (deal.estimated_value_cents ?? 0), 0),
      withoutValue: inStage.filter((deal) => deal.estimated_value_cents === null).length,
    };
  });
}

/** Whole days since the deal was created (never negative). */
export function dealAgeDays(createdAt: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(createdAt).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}

export function dealAgeLabel(days: number): string {
  if (days === 0) return "da oggi";
  if (days === 1) return "da 1 giorno";
  return `da ${days} giorni`;
}

export interface StageChange {
  /** Columns to update on the deal. */
  update: { stage_id: string; closed_at: string | null };
  /** Row to insert in `deal_events`. */
  event: {
    organization_id: string;
    deal_id: string;
    type: "stage_changed";
    from_stage_id: string;
    to_stage_id: string;
    actor_type: "user" | "admin";
    actor_id: string;
    data: Record<string, string>;
  };
}

/**
 * Effects of moving a deal to another stage. Moving into a won/lost stage sets
 * `closed_at` (kept if the deal was already closed); moving back to an open
 * stage clears it. Null when the deal is already in that stage.
 */
export function stageChange(input: {
  organizationId: string;
  deal: { id: string; stage_id: string; closed_at: string | null };
  from: Pick<StageLike, "id" | "name" | "kind"> | null;
  to: Pick<StageLike, "id" | "name" | "kind">;
  actor: { id: string; type: "user" | "admin" };
  now?: Date;
}): StageChange | null {
  if (input.deal.stage_id === input.to.id) return null;
  const closed = input.to.kind === "won" || input.to.kind === "lost";
  const wasClosed = input.from ? input.from.kind === "won" || input.from.kind === "lost" : false;
  const closedAt = closed
    ? wasClosed && input.deal.closed_at
      ? input.deal.closed_at
      : (input.now ?? new Date()).toISOString()
    : null;
  return {
    update: { stage_id: input.to.id, closed_at: closedAt },
    event: {
      organization_id: input.organizationId,
      deal_id: input.deal.id,
      type: "stage_changed",
      from_stage_id: input.deal.stage_id,
      to_stage_id: input.to.id,
      actor_type: input.actor.type,
      actor_id: input.actor.id,
      data: { from: input.from?.name ?? "", to: input.to.name },
    },
  };
}

export const DEAL_STATES = ["aperte", "vinte", "perse", "tutte"] as const;
export type DealState = (typeof DEAL_STATES)[number];
export const DEAL_STATE_LABELS: Record<DealState, string> = {
  aperte: "Aperte",
  vinte: "Vinte",
  perse: "Perse",
  tutte: "Tutte",
};
const STATE_KIND: Record<DealState, string | null> = {
  aperte: "open",
  vinte: "won",
  perse: "lost",
  tutte: null,
};

export interface DealFilter {
  state: DealState;
  stageId: string | null;
  /** A user id, "nessuno" for unassigned, or null for everyone. */
  assignee: string | null;
  /** "Scadenze": only open deals with the `scadenza` custom field, ordered by that date. */
  dueOnly: boolean;
}

/** Key of the deal custom field the "Scadenze" view reads (the renewal templates write it). */
export const DUE_FIELD = "scadenza";

type Param = string | string[] | undefined;
const first = (value: Param) => ((Array.isArray(value) ? value[0] : value) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseDealFilter(params: {
  stato?: Param;
  fase?: Param;
  assegnata?: Param;
  scadenze?: Param;
}): DealFilter {
  const state = first(params.stato);
  const stage = first(params.fase);
  const assignee = first(params.assegnata);
  const dueOnly = first(params.scadenze) === "1";
  return {
    // The due view is about what is still to be renewed: it always reads the open deals.
    state: dueOnly
      ? "aperte"
      : (DEAL_STATES as readonly string[]).includes(state)
        ? (state as DealState)
        : "aperte",
    stageId: UUID.test(stage) ? stage : null,
    assignee: assignee === "nessuno" || UUID.test(assignee) ? assignee : null,
    dueOnly,
  };
}

/** The `scadenza` custom field as a calendar day, or null when missing or not a date. */
export function dueDateOf(customFields: unknown): string | null {
  if (typeof customFields !== "object" || customFields === null || Array.isArray(customFields)) return null;
  const raw = (customFields as Record<string, unknown>)[DUE_FIELD];
  if (typeof raw !== "string") return null;
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = new Date(`${day}T00:00:00Z`).getTime();
  // A day that does not exist (30 February) rolls over in JavaScript: refuse it.
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day ? null : day;
}

/** Whole days from today (UTC) to the given day: negative when already past. */
export function daysUntil(day: string, now: Date = new Date()): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((new Date(`${day}T00:00:00Z`).getTime() - today) / 86_400_000);
}

export function daysLeftLabel(days: number): string {
  if (days === 0) return "oggi";
  if (days === 1) return "domani";
  if (days === -1) return "scaduta ieri";
  if (days < 0) return `scaduta da ${-days} giorni`;
  return `tra ${days} giorni`;
}

/** Open deals that carry a due date, the nearest first (ties: the oldest deal first). */
export function dueDeals<D extends DealLike & { custom_fields: unknown }>(
  deals: readonly D[],
  stages: readonly StageLike[],
  filter: DealFilter,
): (D & { dueDate: string })[] {
  return filterDeals(deals, stages, { ...filter, state: "aperte" })
    .flatMap((deal) => {
      const dueDate = dueDateOf(deal.custom_fields);
      return dueDate ? [{ ...deal, dueDate }] : [];
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.created_at.localeCompare(b.created_at));
}

/** Stage ids a filter selects; used to build the database query of the list view. */
export function stageIdsForFilter(stages: readonly StageLike[], filter: DealFilter): string[] {
  const kind = STATE_KIND[filter.state];
  return stages
    .filter(
      (stage) => (kind === null || stage.kind === kind) && (!filter.stageId || stage.id === filter.stageId),
    )
    .map((stage) => stage.id);
}

export function filterDeals<D extends DealLike>(
  deals: readonly D[],
  stages: readonly StageLike[],
  filter: DealFilter,
): D[] {
  const ids = new Set(stageIdsForFilter(stages, filter));
  return deals.filter((deal) => {
    if (!ids.has(deal.stage_id)) return false;
    if (filter.assignee === "nessuno") return deal.assignee_user_id === null;
    if (filter.assignee) return deal.assignee_user_id === filter.assignee;
    return true;
  });
}
