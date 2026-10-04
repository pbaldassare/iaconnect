import {
  CONNECTION_STATUSES,
  CONNECTOR_CATEGORIES,
  type ConnectionStatus,
  type ConnectorCategory,
  type FlowIssue,
  type PlanLimits,
  type ValidationContext,
} from "@ia-connect/core";

/**
 * Builds the `ValidationContext` that `validateFlow` needs from plain database
 * rows. Pure, unit tested; the loading is in lib/flows/server.ts.
 */

export interface ValidationInput {
  connections: readonly { id: string; connector_type: string; status: string }[];
  connectorTypes: readonly { key: string; category: string }[];
  templates: readonly { name: string; channel: string; approval_status: string }[];
  stages: readonly { key: string }[];
  /** `plans.limits` as stored. */
  limits: unknown;
  /** Other flows of the organization that are active (the one being checked excluded). */
  activeFlows: number;
  /** Result of `quota_left(org, 'ai_credits')`: null = no limit. */
  aiCreditsLeft: number | null;
}

function isCategory(value: string | undefined): value is ConnectorCategory {
  return CONNECTOR_CATEGORIES.includes(value as ConnectorCategory);
}

function isStatus(value: string): value is ConnectionStatus {
  return CONNECTION_STATUSES.includes(value as ConnectionStatus);
}

/**
 * `plans.limits` → PlanLimits. A missing or negative limit means "no limit"
 * (same rule as the database's `quota_left`), so it becomes Infinity and never
 * blocks. Returns undefined when nothing is stored at all.
 */
export function planLimitsForValidation(value: unknown): PlanLimits | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const read = (key: keyof PlanLimits) => {
    const raw = record[key];
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : Number.POSITIVE_INFINITY;
  };
  return {
    active_flows: read("active_flows"),
    messages_per_month: read("messages_per_month"),
    scrape_runs_per_month: read("scrape_runs_per_month"),
    ai_credits_per_month: read("ai_credits_per_month"),
  };
}

export function buildValidationContext(input: ValidationInput): ValidationContext {
  const categories = new Map(input.connectorTypes.map((type) => [type.key, type.category]));
  const connections: ValidationContext["connections"] = [];
  for (const connection of input.connections) {
    const category = categories.get(connection.connector_type);
    // A connection of an unknown type or status cannot satisfy any block: leave it out.
    if (!isCategory(category) || !isStatus(connection.status)) continue;
    connections.push({ id: connection.id, category, status: connection.status });
  }
  return {
    connections,
    templates: input.templates.map((template) => ({
      name: template.name,
      channel: template.channel,
      approvalStatus: template.approval_status,
    })),
    stages: input.stages.map((stage) => stage.key),
    limits: planLimitsForValidation(input.limits),
    activeFlows: input.activeFlows,
    aiCreditsLeft: input.aiCreditsLeft ?? undefined,
  };
}

export interface GroupedIssues {
  /** Issues not tied to a step (trigger, plan limits, schema). */
  general: FlowIssue[];
  byStep: Map<string, FlowIssue[]>;
  errors: number;
  warnings: number;
}

/** Splits validation issues so each can be shown next to the step it refers to. */
export function groupIssues(issues: readonly FlowIssue[]): GroupedIssues {
  const grouped: GroupedIssues = { general: [], byStep: new Map(), errors: 0, warnings: 0 };
  for (const issue of issues) {
    if (issue.level === "error") grouped.errors += 1;
    else grouped.warnings += 1;
    if (!issue.stepId) {
      grouped.general.push(issue);
      continue;
    }
    const list = grouped.byStep.get(issue.stepId) ?? [];
    list.push(issue);
    grouped.byStep.set(issue.stepId, list);
  }
  return grouped;
}

const CATEGORY_NAMES: Record<string, string> = {
  mail: "Mail",
  whatsapp: "WhatsApp",
  crm: "Gestionale",
  social: "Social",
  scraper: "Siti e portali",
  sms: "SMS",
  calendar: "Calendario",
  payment: "Pagamenti",
  signature: "Firma",
};

const CONNECTION_STATUS_NAMES: Record<string, string> = {
  active: "attivo",
  expired: "scaduto",
  error: "in errore",
  disconnected: "scollegato",
};

/**
 * `validateFlow` writes a few technical words into its Italian messages
 * (category keys, status values). This swaps them for the names the customer sees.
 */
export function issueText(issue: Pick<FlowIssue, "code" | "message">): string {
  if (issue.code === "connection") {
    return issue.message
      .replace(/di tipo "([a-z_]+)"/, (_, key: string) => `di tipo «${CATEGORY_NAMES[key] ?? key}»`)
      .replace(/\(stato: ([a-z_]+)\)/, (_, key: string) => `(è ${CONNECTION_STATUS_NAMES[key] ?? key})`);
  }
  if (issue.code === "quota_flows") {
    return `${issue.message} Metti in pausa un altro flusso o passa a un piano più ampio.`;
  }
  return issue.message;
}
