"use server";
import { errorMessage } from "@/lib/action";
import { issueText } from "@/lib/flows/context";
import { parseDefinitionJson, sanitizeHistory } from "@/lib/flows/runs";
import { insertFlowVersion, loadFlowEnvironment, loadFlowPermissions } from "@/lib/flows/server";
import { buildDiagram } from "@/lib/flows/view";
import { isUuid } from "@/lib/org-selection";
import { requireOrgManager } from "@/lib/session";
import { MissingServiceKeyError, createServiceClient, hasServiceKey } from "@/lib/supabase/service";
import { AiOperationError, type FlowProposal, proposeFlow } from "@ia-connect/ai";
import { type AiUsage, type FlowDefinition, FlowDefinitionSchema, creditsFor } from "@ia-connect/core";
import { revalidatePath } from "next/cache";
import type {
  AssistantReply,
  AssistantRequest,
  SaveProposalReply,
  SaveProposalRequest,
} from "./assistant-types";

const NO_ASSISTANT = "L'assistente dei flussi non è attivo per la tua azienda.";

/** Every AI call is written to `ai_calls` and counted in the month's AI credits (service role: users cannot write either). */
async function recordUsage(organizationId: string, usage: AiUsage): Promise<number> {
  const credits = creditsFor(usage);
  try {
    const service = createServiceClient();
    const { error } = await service.from("ai_calls").insert({
      organization_id: organizationId,
      purpose: "flow_assistant",
      model: usage.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cost_micros: usage.costMicros,
      credits,
    });
    if (error) console.error("[assistant] ai_calls insert failed", error.code);
    const { error: usageError } = await service.rpc("add_usage", {
      p_org: organizationId,
      p_metric: "ai_credits",
      p_amount: credits,
    });
    if (usageError) console.error("[assistant] add_usage failed", usageError.code);
  } catch (error) {
    console.error("[assistant] usage not recorded", (error as Error)?.name ?? "");
  }
  return credits;
}

/**
 * One turn of the flow assistant. Order matters: permission, configuration,
 * quota, then the call; usage is recorded even when the call fails midway.
 * The customer's text is the request to design, never an instruction that
 * changes the assistant's rules (packages/ai keeps it in the user turn).
 */
export async function askAssistant(request: AssistantRequest): Promise<AssistantReply> {
  const context = await requireOrgManager();
  const { supabase, org } = context;
  const orgId = org.organization.id;
  if (!(await loadFlowPermissions(context)).canUseAssistant) return { ok: false, message: NO_ASSISTANT };

  const description = typeof request?.description === "string" ? request.description.trim() : "";
  if (description.length < 5) return { ok: false, message: "Scrivi cosa vuoi che il flusso faccia." };
  if (description.length > 4000) {
    return { ok: false, message: "Il messaggio è troppo lungo: resta sotto i 4000 caratteri." };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      message:
        "L'assistente non è configurato su questo server: manca la chiave ANTHROPIC_API_KEY. Va impostata nell'ambiente del server, poi si può riprovare.",
    };
  }
  // Without the service key the call could not be written to `ai_calls`: do not start it.
  if (!hasServiceKey()) return { ok: false, message: new MissingServiceKeyError().message };

  const { data: left, error: quotaError } = await supabase.rpc("quota_left", {
    p_org: orgId,
    p_metric: "ai_credits",
  });
  if (quotaError) return { ok: false, message: errorMessage(quotaError) };
  if (typeof left === "number" && left <= 0) {
    return {
      ok: false,
      message:
        "I crediti IA di questo mese sono esauriti: l'assistente torna disponibile il mese prossimo o con un piano più ampio.",
    };
  }

  // The flow being modified: the latest proposal of this chat, or the flow's latest version.
  let current: FlowDefinition | undefined;
  let flowId: string | null = null;
  if (request.flowId) {
    if (!isUuid(request.flowId)) return { ok: false, message: "Flusso non trovato." };
    const { data: flow } = await supabase
      .from("flows")
      .select("id")
      .eq("id", request.flowId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!flow) return { ok: false, message: "Flusso non trovato." };
    flowId = flow.id;
  }
  if (typeof request.currentJson === "string" && request.currentJson.length <= 200_000) {
    const parsed = parseDefinitionJson(request.currentJson);
    if (parsed.ok) current = parsed.definition;
  }
  if (!current && flowId) {
    const { data: version } = await supabase
      .from("flow_versions")
      .select("definition")
      .eq("flow_id", flowId)
      .eq("organization_id", orgId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const parsed = FlowDefinitionSchema.safeParse(version?.definition);
    if (parsed.success) current = parsed.data;
  }

  const environment = await loadFlowEnvironment(context, { excludeFlowId: flowId ?? undefined });
  if (environment.error) return { ok: false, message: errorMessage(environment.error) };

  let proposal: FlowProposal;
  try {
    proposal = await proposeFlow({
      apiKey,
      description,
      current,
      history: sanitizeHistory(request.history),
      sector: org.organization.sector,
      connections: environment.connections,
      templates: environment.templates.map((template) => ({
        name: template.name,
        channel: template.channel,
        body: template.body,
        approvalStatus: template.approval_status,
      })),
      stages: environment.stages.map((stage) => stage.key),
      // Activation is checked again later: here the plan's flow count must not block a draft.
      validation: { ...environment.validation, activeFlows: undefined },
    });
  } catch (error) {
    if (error instanceof AiOperationError) await recordUsage(orgId, error.usage);
    console.error("[assistant] proposeFlow failed", (error as Error)?.name ?? "");
    return {
      ok: false,
      message:
        "L'assistente non ha risposto. Riprova tra qualche minuto; se succede ancora, contatta l'assistenza.",
    };
  }
  const credits = await recordUsage(orgId, proposal.usage);

  return {
    ok: true,
    proposal: {
      definitionJson: proposal.definition ? JSON.stringify(proposal.definition, null, 2) : null,
      diagram: proposal.definition
        ? buildDiagram(proposal.definition, proposal.issues, environment.names)
        : null,
      questions: proposal.questions,
      note: proposal.note,
      leftoverIssues: proposal.definition
        ? []
        : proposal.issues.filter((issue) => issue.level === "error").map((issue) => issueText(issue)),
      credits,
    },
  };
}

/** "Salva come bozza": a new `flow_versions` row by "ai" (and the flow itself, when new). Never activates. */
export async function saveProposal(request: SaveProposalRequest): Promise<SaveProposalReply> {
  const context = await requireOrgManager();
  const { supabase, org, session } = context;
  const orgId = org.organization.id;
  if (!(await loadFlowPermissions(context)).canUseAssistant) return { ok: false, message: NO_ASSISTANT };

  if (typeof request?.definitionJson !== "string" || request.definitionJson.length > 200_000) {
    return { ok: false, message: "La proposta non è valida. Chiedi all'assistente di rigenerarla." };
  }
  const parsed = parseDefinitionJson(request.definitionJson);
  if (!parsed.ok)
    return { ok: false, message: "La proposta non è valida. Chiedi all'assistente di rigenerarla." };
  const note = typeof request.note === "string" ? request.note.trim().slice(0, 2000) : "";

  let flowId: string;
  let created = false;
  if (request.flowId) {
    if (!isUuid(request.flowId)) return { ok: false, message: "Flusso non trovato." };
    const { data: flow } = await supabase
      .from("flows")
      .select("id, active_version_id, trigger_event")
      .eq("id", request.flowId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!flow) return { ok: false, message: "Flusso non trovato." };
    flowId = flow.id;
    // A flow never activated shows the trigger of its latest draft.
    if (!flow.active_version_id && flow.trigger_event !== parsed.definition.trigger.event) {
      await supabase
        .from("flows")
        .update({ trigger_event: parsed.definition.trigger.event })
        .eq("id", flow.id)
        .eq("organization_id", orgId);
    }
  } else {
    const name = typeof request.name === "string" ? request.name.trim() : "";
    if (name.length < 2) return { ok: false, message: "Dai un nome al flusso (almeno 2 caratteri)." };
    const { data: flow, error } = await supabase
      .from("flows")
      .insert({
        organization_id: orgId,
        name: name.slice(0, 120),
        description: note,
        status: "draft",
        trigger_event: parsed.definition.trigger.event,
      })
      .select("id")
      .single();
    if (error) return { ok: false, message: errorMessage(error) };
    flowId = flow.id;
    created = true;
  }

  const version = await insertFlowVersion(supabase, {
    organizationId: orgId,
    flowId,
    definition: parsed.definition,
    authorType: "ai",
    authorId: session.user.id,
    note: note || "Proposta dell'assistente.",
  });
  if (!version.data) {
    if (created) await supabase.from("flows").delete().eq("id", flowId).eq("organization_id", orgId);
    return { ok: false, message: errorMessage(version.error) };
  }
  revalidatePath("/app/flussi");
  revalidatePath(`/app/flussi/${flowId}`);
  return { ok: true, flowId, versionId: version.data.id };
}
