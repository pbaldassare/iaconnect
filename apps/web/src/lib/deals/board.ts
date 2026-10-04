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
}

type Param = string | string[] | undefined;
const first = (value: Param) => ((Array.isArray(value) ? value[0] : value) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseDealFilter(params: { stato?: Param; fase?: Param; assegnata?: Param }): DealFilter {
  const state = first(params.stato);
  const stage = first(params.fase);
  const assignee = first(params.assegnata);
  return {
    state: (DEAL_STATES as readonly string[]).includes(state) ? (state as DealState) : "aperte",
    stageId: UUID.test(stage) ? stage : null,
    assignee: assignee === "nessuno" || UUID.test(assignee) ? assignee : null,
  };
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
