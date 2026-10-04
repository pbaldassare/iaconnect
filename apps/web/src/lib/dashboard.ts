/** Aggregations for the Inizio page and the admin organization page. Pure, unit tested. */

export function countByStatus<T extends { status: string }>(rows: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.status] = (out[row.status] ?? 0) + 1;
  return out;
}

/** Connections the customer must act on: expired or in error. */
export function connectionsNeedingAttention<T extends { status: string }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.status === "expired" || row.status === "error");
}

export interface StageSummary {
  stageId: string;
  name: string;
  kind: string;
  count: number;
  /** Sum of the estimated values, in cents (deals without a value count as 0). */
  valueCents: number;
}

/** Open deals grouped by stage, in pipeline order. Only stages of kind "open" are listed. */
export function dealsByStage(
  stages: readonly { id: string; name: string; position: number; kind: string }[],
  deals: readonly { stage_id: string; estimated_value_cents: number | null }[],
): StageSummary[] {
  return [...stages]
    .filter((stage) => stage.kind === "open")
    .sort((a, b) => a.position - b.position)
    .map((stage) => {
      const inStage = deals.filter((deal) => deal.stage_id === stage.id);
      return {
        stageId: stage.id,
        name: stage.name,
        kind: stage.kind,
        count: inStage.length,
        valueCents: inStage.reduce((sum, deal) => sum + (deal.estimated_value_cents ?? 0), 0),
      };
    });
}

export interface OnboardingStep {
  key: "mail" | "whatsapp" | "flow";
  title: string;
  description: string;
  href: string;
  done: boolean;
}

/**
 * First steps for a new customer: connect mail and WhatsApp, then install a flow.
 * `connections` carry the connector category (joined from connector_types).
 */
export function onboardingSteps(
  connections: readonly { status: string; category: string | null }[],
  flows: readonly { status: string }[],
): OnboardingStep[] {
  const connected = (category: string) =>
    connections.some((c) => c.category === category && c.status === "active");
  return [
    {
      key: "mail",
      title: "Collega la mail",
      description: "Le richieste che arrivano in casella fanno partire i flussi.",
      href: "/app/collegamenti",
      done: connected("mail"),
    },
    {
      key: "whatsapp",
      title: "Collega WhatsApp",
      description: "È il canale con cui i flussi rispondono ai tuoi clienti.",
      href: "/app/collegamenti",
      done: connected("whatsapp"),
    },
    {
      key: "flow",
      title: "Installa un flusso",
      description: "Scegli un modello pronto per il tuo settore, provalo in simulazione e attivalo.",
      href: "/app/flussi",
      done: flows.some((f) => f.status === "active"),
    },
  ];
}

export interface AiSpendRow {
  organizationId: string;
  purpose: string;
  calls: number;
  costMicros: number;
  credits: number;
}

/** AI spend grouped by organization and purpose, most expensive first. */
export function aggregateAiSpend(
  calls: readonly { organization_id: string; purpose: string; cost_micros: number; credits: number }[],
): AiSpendRow[] {
  const groups = new Map<string, AiSpendRow>();
  for (const call of calls) {
    const key = `${call.organization_id}|${call.purpose}`;
    const row = groups.get(key) ?? {
      organizationId: call.organization_id,
      purpose: call.purpose,
      calls: 0,
      costMicros: 0,
      credits: 0,
    };
    row.calls += 1;
    row.costMicros += call.cost_micros;
    row.credits += call.credits;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.costMicros - a.costMicros || b.calls - a.calls);
}
