"use server";
import { type ActionResult, fail, failFromError, ok } from "@/lib/action";
import { writeAudit } from "@/lib/audit";
import { parseRequirements, parseTemplateDefinition, planTemplateInstall } from "@/lib/flows/install";
import { parseDefinitionJson } from "@/lib/flows/runs";
import { insertFlowVersion, loadFlowEnvironment, loadFlowPermissions } from "@/lib/flows/server";
import {
  INBOUND_TEST_EVENT_NOTE,
  buildTestEvent,
  testEventMode,
  testEventProblem,
} from "@/lib/flows/test-event";
import { simulateFlowJob, simulateSampleJob } from "@/lib/job-requests";
import { requestJob } from "@/lib/jobs";
import { isUuid } from "@/lib/org-selection";
import { type OrgContext, actorOf, requireOrgManager } from "@/lib/session";
import { FlowDefinitionSchema, type Json, type Row, isKnownEventType, validateFlow } from "@ia-connect/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const BASE = "/app/flussi";
const NO_EDIT = "La modifica dei flussi non è attiva per la tua azienda: puoi solo consultarli.";

function refresh(flowId?: string) {
  revalidatePath(BASE);
  if (flowId) revalidatePath(`${BASE}/${flowId}`);
}

async function loadFlow(context: OrgContext, flowId: string): Promise<Row<"flows"> | null> {
  if (!isUuid(flowId)) return null;
  const { data } = await context.supabase
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .eq("organization_id", context.org.organization.id)
    .maybeSingle();
  return data;
}

async function loadVersion(
  context: OrgContext,
  flowId: string,
  versionId: string | null,
): Promise<Row<"flow_versions"> | null> {
  const query = context.supabase
    .from("flow_versions")
    .select("*")
    .eq("flow_id", flowId)
    .eq("organization_id", context.org.organization.id);
  if (versionId) {
    if (!isUuid(versionId)) return null;
    const { data } = await query.eq("id", versionId).maybeSingle();
    return data;
  }
  const { data } = await query.order("version", { ascending: false }).limit(1).maybeSingle();
  return data;
}

/**
 * Activates a version: only when `validateFlow` finds no errors against the
 * organization's real connections, templates, stages and plan. With
 * `versionId` null it (re)activates the current version, or the latest one.
 */
export async function activateFlow(
  flowId: string,
  versionId: string | null,
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrgManager();
  if (!(await loadFlowPermissions(context)).canEdit) return fail(NO_EDIT);
  const flow = await loadFlow(context, flowId);
  if (!flow) return fail("Flusso non trovato.");
  const version = await loadVersion(context, flow.id, versionId ?? flow.active_version_id);
  if (!version) return fail("Questo flusso non ha ancora una versione da attivare.");

  const environment = await loadFlowEnvironment(context, { excludeFlowId: flow.id });
  if (environment.error) return failFromError(environment.error);
  const result = validateFlow(version.definition, environment.validation);
  if (!result.ok || !result.definition) {
    const errors = result.issues.filter((issue) => issue.level === "error").length;
    return fail(
      `Il flusso non si può attivare: ${errors === 1 ? "c'è un errore" : `ci sono ${errors} errori`} da correggere. Li trovi nella scheda «Controlli».`,
    );
  }
  const { error } = await context.supabase
    .from("flows")
    .update({
      status: "active",
      active_version_id: version.id,
      trigger_event: result.definition.trigger.event,
    })
    .eq("id", flow.id)
    .eq("organization_id", context.org.organization.id);
  if (error) return failFromError(error);
  refresh(flow.id);
  return ok(`Flusso attivo con la versione ${version.version}: da adesso parte a ogni nuovo evento.`);
}

export async function pauseFlow(
  flowId: string,
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrgManager();
  if (!(await loadFlowPermissions(context)).canEdit) return fail(NO_EDIT);
  const flow = await loadFlow(context, flowId);
  if (!flow) return fail("Flusso non trovato.");
  if (flow.status !== "active") return fail("Il flusso non è attivo.");
  const { error } = await context.supabase
    .from("flows")
    .update({ status: "paused" })
    .eq("id", flow.id)
    .eq("organization_id", context.org.organization.id);
  if (error) return failFromError(error);
  refresh(flow.id);
  return ok("Flusso in pausa: non parte per i nuovi eventi. Le esecuzioni già avviate proseguono.");
}

/** Installs a library template: the flow as a draft, version 1 by "system", missing message templates as drafts. */
export async function installTemplate(
  templateId: string,
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrgManager();
  if (!(await loadFlowPermissions(context)).canEdit) return fail(NO_EDIT);
  if (!isUuid(templateId)) return fail("Modello non valido.");
  const { supabase, org } = context;
  const orgId = org.organization.id;

  const { data: template, error: templateError } = await supabase
    .from("flow_templates")
    .select("*")
    .eq("id", templateId)
    .eq("is_published", true)
    .maybeSingle();
  if (templateError) return failFromError(templateError);
  if (!template) return fail("Questo modello non è più in libreria.");
  const definition = parseTemplateDefinition(template.definition);
  if (!definition) return fail("Questo modello ha una definizione non valida. Segnalalo all'assistenza.");
  const requirements = parseRequirements(template.requirements);

  const { data: existingTemplates, error: readError } = await supabase
    .from("message_templates")
    .select("channel, name, approval_status")
    .eq("organization_id", orgId)
    .limit(500);
  if (readError) return failFromError(readError);
  const plan = planTemplateInstall(requirements, { templates: existingTemplates ?? [], connections: [] });

  const { data: flow, error: flowError } = await supabase
    .from("flows")
    .insert({
      organization_id: orgId,
      name: template.name,
      description: template.description,
      status: "draft",
      template_key: template.key,
      trigger_event: definition.trigger.event,
    })
    .select("id")
    .single();
  if (flowError) return failFromError(flowError);

  const version = await insertFlowVersion(supabase, {
    organizationId: orgId,
    flowId: flow.id,
    definition,
    authorType: "system",
    authorId: null,
    note: `Installato dal modello «${template.name}».`,
  });
  if (!version.data) {
    await supabase.from("flows").delete().eq("id", flow.id).eq("organization_id", orgId);
    return failFromError(version.error);
  }

  let templatesFailed = false;
  for (const wanted of plan.templatesToCreate) {
    const { error } = await supabase.from("message_templates").insert({
      organization_id: orgId,
      channel: wanted.channel,
      name: wanted.name,
      body: wanted.body,
      approval_status: "draft",
    });
    // 23505: someone created it meanwhile, which is what we wanted anyway.
    if (error && error.code !== "23505") templatesFailed = true;
  }

  refresh(flow.id);
  redirect(`${BASE}/${flow.id}?installato=${templatesFailed ? "parziale" : "1"}`);
}

/** Asks the worker to simulate a version over the latest matching events. Nothing is sent. */
export async function requestSimulation(
  flowId: string,
  versionId: string,
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrgManager();
  const flow = await loadFlow(context, flowId);
  if (!flow) return fail("Flusso non trovato.");
  const version = await loadVersion(context, flow.id, versionId);
  if (!version) return fail("Versione non trovata.");
  if (!FlowDefinitionSchema.safeParse(version.definition).success) {
    return fail("Questa versione ha una definizione non valida e non si può simulare.");
  }
  const { error } = await requestJob(context.supabase, {
    organizationId: context.org.organization.id,
    // A double click within ten seconds is one request.
    ...simulateFlowJob(version.id),
    actor: actorOf(context),
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") return ok("La simulazione è già stata richiesta.");
    return failFromError(error);
  }
  refresh(flow.id);
  return ok("Simulazione richiesta: il risultato compare qui sotto tra qualche secondo.");
}

/** "Ripristina": a new version that copies an older one. It becomes active only when activated. */
export async function restoreVersion(
  flowId: string,
  versionId: string,
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrgManager();
  if (!(await loadFlowPermissions(context)).canEdit) return fail(NO_EDIT);
  const flow = await loadFlow(context, flowId);
  if (!flow) return fail("Flusso non trovato.");
  const source = await loadVersion(context, flow.id, versionId);
  if (!source) return fail("Versione non trovata.");
  const parsed = FlowDefinitionSchema.safeParse(source.definition);
  if (!parsed.success)
    return fail("Questa versione ha una definizione non valida e non si può ripristinare.");
  const created = await insertFlowVersion(context.supabase, {
    organizationId: context.org.organization.id,
    flowId: flow.id,
    definition: parsed.data,
    authorType: "user",
    authorId: context.session.user.id,
    note: `Ripristino della versione ${source.version}.`,
  });
  if (!created.data) return failFromError(created.error);
  await syncDraftTrigger(context, flow, parsed.data.trigger.event);
  refresh(flow.id);
  redirect(`${BASE}/${flow.id}?scheda=controlli&versione=${created.data.id}&esito=ripristinata`);
}

/** A draft that was never activated shows the trigger of its latest version; active and paused flows keep theirs. */
async function syncDraftTrigger(context: OrgContext, flow: Row<"flows">, triggerEvent: string) {
  if (flow.active_version_id || flow.trigger_event === triggerEvent) return;
  await context.supabase
    .from("flows")
    .update({ trigger_event: triggerEvent })
    .eq("id", flow.id)
    .eq("organization_id", context.org.organization.id);
}

/** Manual JSON edit for advanced users: schema-checked, then saved as a new version by "user". */
export async function saveManualVersion(
  flowId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrgManager();
  if (!(await loadFlowPermissions(context)).canEdit) return fail(NO_EDIT);
  const flow = await loadFlow(context, flowId);
  if (!flow) return fail("Flusso non trovato.");
  const text = formData.get("definition");
  const note = formData.get("note");
  if (typeof text !== "string" || !text.trim()) return fail("Incolla la definizione del flusso.");
  if (text.length > 200_000) return fail("La definizione è troppo lunga.");

  const parsed = parseDefinitionJson(text);
  if (!parsed.ok) {
    return fail([parsed.message, ...parsed.details].join(" · "), { definition: parsed.message });
  }
  const environment = await loadFlowEnvironment(context, { excludeFlowId: flow.id });
  const result = validateFlow(parsed.definition, environment.validation);
  // Problems of the flow itself block the save; missing connections, templates or quota only block activation.
  const structural = result.issues.filter(
    (issue) =>
      issue.level === "error" &&
      [
        "schema",
        "duplicate_step",
        "unknown_block",
        "params",
        "outlet",
        "target",
        "self_loop",
        "reference",
      ].includes(issue.code),
  );
  if (structural.length > 0) {
    return fail(
      `La definizione ha ${structural.length === 1 ? "un errore" : `${structural.length} errori`}: ${structural
        .slice(0, 5)
        .map((issue) => (issue.stepId ? `[${issue.stepId}] ${issue.message}` : issue.message))
        .join(" · ")}`,
      { definition: "Correggi gli errori indicati sotto." },
    );
  }
  const created = await insertFlowVersion(context.supabase, {
    organizationId: context.org.organization.id,
    flowId: flow.id,
    definition: parsed.definition,
    authorType: "user",
    authorId: context.session.user.id,
    note: typeof note === "string" && note.trim() ? note.trim() : "Modifica manuale.",
  });
  if (!created.data) return failFromError(created.error);
  await syncDraftTrigger(context, flow, parsed.definition.trigger.event);
  refresh(flow.id);
  redirect(`${BASE}/${flow.id}?scheda=controlli&versione=${created.data.id}&esito=salvata`);
}

/**
 * Test event: `manual.test` or the flow's trigger type. The open types are inserted as real
 * events (active flows with that trigger run for real); the types reserved to connectors
 * run the flow in simulation over the given content (see lib/flows/test-event.ts).
 */
export async function sendTestEvent(
  flowId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrgManager();
  const flow = await loadFlow(context, flowId);
  if (!flow) return fail("Flusso non trovato.");
  const type = formData.get("type");
  const payloadText = formData.get("payload");
  const allowed = new Set(["manual.test", ...(flow.trigger_event ? [flow.trigger_event] : [])]);
  if (typeof type !== "string" || !allowed.has(type) || !isKnownEventType(type)) {
    return fail("Scegli un tipo di evento tra quelli proposti.", { type: "Tipo non valido." });
  }
  if (typeof payloadText !== "string" || payloadText.length > 20_000) {
    return fail("Il contenuto dell'evento è troppo lungo.", { payload: "Troppo lungo." });
  }
  let payload: unknown;
  try {
    payload = payloadText.trim() ? JSON.parse(payloadText) : {};
  } catch {
    return fail("Il contenuto non è un JSON valido.", {
      payload: "Controlla virgole, virgolette e parentesi.",
    });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fail('Il contenuto deve essere un oggetto JSON, ad esempio { "subject": "Preventivo" }.', {
      payload: "Serve un oggetto JSON.",
    });
  }
  const problem = testEventProblem(type, payload as Record<string, unknown>);
  if (problem) return fail(problem, { payload: "Manca il mittente." });
  const orgId = context.org.organization.id;
  // A trigger limited to one connection only matches events of that connection.
  const version = await loadVersion(context, flow.id, flow.active_version_id);
  const definition = FlowDefinitionSchema.safeParse(version?.definition);
  if (testEventMode(type) === "simulation") {
    // Reserved to connectors: a made-up inbound message or payment would be taken as true.
    // The flow runs in simulation over this content instead; nothing is stored or sent.
    if (!version || !definition.success) {
      return fail("Salva prima una versione valida del flusso: la prova la esegue in simulazione.");
    }
    const { error } = await requestJob(context.supabase, {
      organizationId: orgId,
      ...simulateSampleJob(version.id, payload as Record<string, unknown>),
      actor: actorOf(context),
    });
    if (error) {
      if ((error as { code?: string }).code === "23505") return ok("La prova è già stata richiesta.");
      return failFromError(error);
    }
    refresh(flow.id);
    return ok(
      `Prova avviata in simulazione: il risultato compare nella scheda «Simulazione» tra qualche secondo. ${INBOUND_TEST_EVENT_NOTE}`,
    );
  }
  const { data: connections } = await context.supabase
    .from("connections")
    .select("id")
    .eq("organization_id", orgId);
  const row = buildTestEvent({
    organizationId: orgId,
    type,
    payload: payload as Record<string, unknown>,
    trigger: definition.success ? definition.data.trigger : null,
    connectionIds: (connections ?? []).map((connection) => connection.id),
    id: crypto.randomUUID(),
  });
  const { data: event, error } = await context.supabase
    .from("events")
    .insert({ ...row, payload: row.payload as Json })
    .select("id")
    .single();
  if (error) return failFromError(error);
  const actor = actorOf(context);
  await writeAudit(context.supabase, {
    organizationId: orgId,
    actorId: actor.id,
    actorType: actor.type,
    action: "flow.test_event",
    entityType: "events",
    entityId: event.id,
    data: { flow_id: flow.id, type },
    isSupportAccess: actor.type === "admin",
  });
  refresh(flow.id);
  return ok(
    flow.status === "active"
      ? "Evento di prova inserito. Se corrisponde al trigger, l'esecuzione compare qui tra poco: è un'esecuzione vera, i messaggi partono davvero."
      : "Evento di prova inserito. Il flusso non è attivo, quindi non partirà: puoi usarlo per la simulazione.",
  );
}
