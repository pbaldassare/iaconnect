import "server-only";
import { isFeatureEnabled } from "@/lib/features";
import { buildValidationContext } from "@/lib/flows/context";
import type { DescribeNames } from "@/lib/flows/describe";
import { nextVersionNumber } from "@/lib/flows/runs";
import type { OrgContext } from "@/lib/session";
import type { Db } from "@/lib/supabase/types";
import {
  CONNECTION_STATUSES,
  CONNECTOR_CATEGORIES,
  type ConnectionStatus,
  type ConnectorCategory,
  type FlowDefinition,
  type Json,
  type Row,
  type ValidationContext,
} from "@ia-connect/core";

/** Server-side loading for the Flussi section. Everything reads through the session client (RLS). */

export interface FlowEnvironment {
  /** Real context for `validateFlow`. */
  validation: ValidationContext;
  /** Connections with their category, for the assistant and the "what is missing" lists. */
  connections: { id: string; name: string; category: ConnectorCategory; status: ConnectionStatus }[];
  templates: { name: string; channel: string; body: string; approval_status: string }[];
  stages: { key: string; name: string }[];
  names: DescribeNames;
  /** First read error, if any: the page shows it and the checks may be incomplete. */
  error: unknown;
}

/**
 * Connections, message templates, stages, plan limits, other active flows and
 * AI credits left: what a flow is checked against before simulation or activation.
 */
export async function loadFlowEnvironment(
  context: Pick<OrgContext, "supabase" | "org">,
  options: { excludeFlowId?: string } = {},
): Promise<FlowEnvironment> {
  const { supabase, org } = context;
  const orgId = org.organization.id;
  const [connections, connectorTypes, templates, stages, plan, activeFlows, credits] = await Promise.all([
    supabase.from("connections").select("id, name, connector_type, status").eq("organization_id", orgId),
    supabase.from("connector_types").select("key, category"),
    supabase
      .from("message_templates")
      .select("name, channel, body, approval_status")
      .eq("organization_id", orgId)
      .limit(500),
    supabase.from("deal_stages").select("key, name, position").eq("organization_id", orgId).order("position"),
    supabase.from("plans").select("limits").eq("id", org.organization.plan_id).maybeSingle(),
    supabase.from("flows").select("id").eq("organization_id", orgId).eq("status", "active").limit(1000),
    supabase.rpc("quota_left", { p_org: orgId, p_metric: "ai_credits" }),
  ]);
  const error =
    connections.error ??
    connectorTypes.error ??
    templates.error ??
    stages.error ??
    plan.error ??
    activeFlows.error ??
    credits.error ??
    null;

  const categories = new Map((connectorTypes.data ?? []).map((type) => [type.key, type.category]));
  const withCategory: FlowEnvironment["connections"] = [];
  for (const connection of connections.data ?? []) {
    const category = categories.get(connection.connector_type);
    if (!CONNECTOR_CATEGORIES.includes(category as ConnectorCategory)) continue;
    if (!CONNECTION_STATUSES.includes(connection.status as ConnectionStatus)) continue;
    withCategory.push({
      id: connection.id,
      name: connection.name,
      category: category as ConnectorCategory,
      status: connection.status as ConnectionStatus,
    });
  }

  return {
    validation: buildValidationContext({
      connections: connections.data ?? [],
      connectorTypes: connectorTypes.data ?? [],
      templates: templates.data ?? [],
      stages: stages.data ?? [],
      limits: plan.data?.limits,
      activeFlows: (activeFlows.data ?? []).filter((flow) => flow.id !== options.excludeFlowId).length,
      aiCreditsLeft: typeof credits.data === "number" ? credits.data : null,
    }),
    connections: withCategory,
    templates: templates.data ?? [],
    stages: (stages.data ?? []).map((stage) => ({ key: stage.key, name: stage.name })),
    names: {
      stages: new Map((stages.data ?? []).map((stage) => [stage.key, stage.name])),
      connections: new Map((connections.data ?? []).map((connection) => [connection.id, connection.name])),
    },
    error,
  };
}

export interface FlowPermissions {
  /** May create, change, activate and pause flows. */
  canEdit: boolean;
  /** May use the AI assistant. */
  canUseAssistant: boolean;
  editorEnabled: boolean;
  assistantEnabled: boolean;
}

/** Feature flags `flow_editor` and `flow_assistant` combined with `canManage`. Support staff is never blocked by a flag. */
export async function loadFlowPermissions(
  context: Pick<OrgContext, "supabase" | "org">,
): Promise<FlowPermissions> {
  const { data } = await context.supabase
    .from("org_features")
    .select("feature_key, enabled")
    .eq("organization_id", context.org.organization.id);
  const support = context.org.mode === "support";
  const editorEnabled = isFeatureEnabled(data ?? [], "flow_editor");
  const assistantEnabled = isFeatureEnabled(data ?? [], "flow_assistant");
  const canEdit = context.org.canManage && (editorEnabled || support);
  return {
    canEdit,
    canUseAssistant: canEdit && (assistantEnabled || support),
    editorEnabled,
    assistantEnabled,
  };
}

/**
 * Adds a version to a flow. `flow_versions` rows are immutable: every change
 * is a new row with `version = max + 1`. Two saves at once collide on the
 * unique (flow_id, version): the loser retries with the next number.
 */
export async function insertFlowVersion(
  supabase: Db,
  input: {
    organizationId: string;
    flowId: string;
    definition: FlowDefinition;
    authorType: "user" | "ai" | "system";
    authorId: string | null;
    note: string;
  },
): Promise<{ data: Row<"flow_versions">; error: null } | { data: null; error: unknown }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: existing, error: readError } = await supabase
      .from("flow_versions")
      .select("version")
      .eq("flow_id", input.flowId)
      .eq("organization_id", input.organizationId)
      .order("version", { ascending: false })
      .limit(1);
    if (readError) return { data: null, error: readError };
    const { data, error } = await supabase
      .from("flow_versions")
      .insert({
        organization_id: input.organizationId,
        flow_id: input.flowId,
        version: nextVersionNumber(existing ?? []),
        definition: input.definition as unknown as Json,
        author_type: input.authorType,
        author_id: input.authorId,
        note: input.note.slice(0, 2000),
      })
      .select("*")
      .single();
    if (!error) return { data, error: null };
    lastError = error;
    if (error.code !== "23505") break;
  }
  return { data: null, error: lastError };
}
