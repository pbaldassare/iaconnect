"use server";
import { type ActionResult, fail, failFromError, ok } from "@/lib/action";
import { stageChange } from "@/lib/deals/board";
import { buildDealCustomFields, parseDealFieldDefs } from "@/lib/deals/stages";
import { isUuid } from "@/lib/org-selection";
import { eurosToCents, parseIsoDate } from "@/lib/parse";
import { type OrgContext, actorOf, requireOrg } from "@/lib/session";
import type { Json } from "@ia-connect/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

function refresh(dealId?: string) {
  revalidatePath("/app/trattative");
  if (dealId) revalidatePath(`/app/trattative/${dealId}`);
}

/**
 * Moves a deal to another stage: updates the deal (with `closed_at` for won/lost
 * stages) and writes the `stage_changed` event with the acting user.
 */
export async function moveDeal(
  dealId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrg();
  const { supabase, org } = context;
  const organizationId = org.organization.id;
  const stageId = text(formData, "stage_id");
  if (!isUuid(dealId) || !isUuid(stageId)) return fail("Scegli la fase in cui spostare la trattativa.");
  const [dealResult, stagesResult] = await Promise.all([
    supabase
      .from("deals")
      .select("id, stage_id, closed_at")
      .eq("id", dealId)
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase.from("deal_stages").select("id, name, kind").eq("organization_id", organizationId),
  ]);
  if (dealResult.error) return failFromError(dealResult.error);
  const deal = dealResult.data;
  if (!deal) return fail("Questa trattativa non esiste più.");
  const stages = stagesResult.data ?? [];
  const to = stages.find((stage) => stage.id === stageId);
  if (!to) return fail("Questa fase non esiste più. Ricarica la pagina.");
  const change = stageChange({
    organizationId,
    deal,
    from: stages.find((stage) => stage.id === deal.stage_id) ?? null,
    to,
    actor: actorOf(context),
  });
  if (!change) return ok(`La trattativa è già in «${to.name}».`);

  // Guarded by the stage we read: a concurrent move makes this a no-op instead of a wrong event.
  const { data: updated, error } = await supabase
    .from("deals")
    .update(change.update)
    .eq("id", deal.id)
    .eq("organization_id", organizationId)
    .eq("stage_id", deal.stage_id)
    .select("id");
  if (error) return failFromError(error);
  if (!updated || updated.length === 0) {
    refresh(deal.id);
    return fail("Nel frattempo qualcun altro ha spostato questa trattativa. Ricarica e riprova.");
  }
  const { error: eventError } = await supabase.from("deal_events").insert(change.event);
  if (eventError) console.error("[deals] stage_changed event", eventError.code, eventError.message);
  refresh(deal.id);
  return ok(`Spostata in «${to.name}».`);
}

interface DealInput {
  title: string;
  estimated_value_cents: number | null;
  next_action: string | null;
  next_action_at: string | null;
  assignee_user_id: string | null;
  custom_fields: Record<string, Json>;
}

async function readDealForm(
  context: OrgContext,
  formData: FormData,
  storedCustomFields: unknown,
  currentAssignee: string | null,
): Promise<{ ok: false; result: ActionResult } | { ok: true; data: DealInput }> {
  const fieldErrors: Record<string, string> = {};
  const title = text(formData, "title").slice(0, 160);
  if (title.length < 2) fieldErrors.title = "Scrivi un titolo.";
  const rawValue = text(formData, "value");
  const value = rawValue === "" ? null : eurosToCents(rawValue);
  if (rawValue !== "" && value === null)
    fieldErrors.value = "Scrivi un importo in euro, per esempio 1500 o 1.500,50.";
  const rawDate = text(formData, "next_action_at");
  const date = rawDate === "" ? null : parseIsoDate(rawDate);
  if (rawDate !== "" && date === null) fieldErrors.next_action_at = "Scegli una data valida.";
  const assignee = text(formData, "assignee_user_id");
  if (assignee !== "" && !isUuid(assignee)) fieldErrors.assignee_user_id = "Scegli una persona dell'elenco.";
  else if (assignee !== "" && assignee !== currentAssignee && assignee !== context.session.user.id) {
    // Only people of this organization: RLS shows a manager every membership, a collaborator only their own.
    const { data: member } = await context.supabase
      .from("memberships")
      .select("id")
      .eq("organization_id", context.org.organization.id)
      .eq("user_id", assignee)
      .limit(1);
    if (!member || member.length === 0) fieldErrors.assignee_user_id = "Scegli una persona dell'elenco.";
  }

  const { data: settings } = await context.supabase
    .from("org_settings")
    .select("deal_custom_fields")
    .eq("organization_id", context.org.organization.id)
    .maybeSingle();
  const defs = parseDealFieldDefs(settings?.deal_custom_fields);
  const input: Record<string, string> = {};
  for (const def of defs) input[def.key] = text(formData, `cf_${def.key}`);
  const custom = buildDealCustomFields(defs, input, storedCustomFields);
  for (const [key, message] of Object.entries(custom.errors)) fieldErrors[`cf_${key}`] = message;

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, result: fail("Controlla i campi evidenziati.", fieldErrors) };
  }
  return {
    ok: true,
    data: {
      title,
      estimated_value_cents: value,
      next_action: text(formData, "next_action").slice(0, 300) || null,
      // A day, not an hour: noon UTC falls on the same day in Italy all year round.
      next_action_at: date ? `${date}T12:00:00.000Z` : null,
      assignee_user_id: assignee || null,
      custom_fields: custom.fields,
    },
  };
}

export async function createDeal(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const context = await requireOrg();
  const { supabase, org } = context;
  const organizationId = org.organization.id;
  const contactId = text(formData, "contact_id");
  const stageId = text(formData, "stage_id");
  if (!isUuid(contactId)) return fail("Scegli il contatto.", { contact_id: "Scegli il contatto." });
  if (!isUuid(stageId)) return fail("Scegli la fase.", { stage_id: "Scegli la fase." });
  const parsed = await readDealForm(context, formData, null, null);
  if (!parsed.ok) return parsed.result;

  const [contact, stage] = await Promise.all([
    supabase
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("deal_stages")
      .select("id, kind")
      .eq("id", stageId)
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);
  if (!contact.data)
    return fail("Questo contatto non esiste più.", { contact_id: "Scegli un altro contatto." });
  if (!stage.data) return fail("Questa fase non esiste più.", { stage_id: "Scegli un'altra fase." });

  const now = new Date().toISOString();
  const { data: deal, error } = await supabase
    .from("deals")
    .insert({
      organization_id: organizationId,
      contact_id: contactId,
      stage_id: stageId,
      closed_at: stage.data.kind === "open" ? null : now,
      ...parsed.data,
    })
    .select("id")
    .single();
  if (error) return failFromError(error);
  const actor = actorOf(context);
  const { error: eventError } = await supabase.from("deal_events").insert({
    organization_id: organizationId,
    deal_id: deal.id,
    type: "created",
    to_stage_id: stageId,
    actor_type: actor.type,
    actor_id: actor.id,
    data: { manual: true },
  });
  if (eventError) console.error("[deals] created event", eventError.code, eventError.message);
  refresh();
  redirect(`/app/trattative/${deal.id}`);
}

export async function updateDeal(
  dealId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireOrg();
  const { supabase, org } = context;
  const organizationId = org.organization.id;
  if (!isUuid(dealId)) return fail("Trattativa non valida.");
  const { data: deal, error: readError } = await supabase
    .from("deals")
    .select("id, title, estimated_value_cents, next_action, next_action_at, assignee_user_id, custom_fields")
    .eq("id", dealId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (readError) return failFromError(readError);
  if (!deal) return fail("Questa trattativa non esiste più.");
  const parsed = await readDealForm(context, formData, deal.custom_fields, deal.assignee_user_id);
  if (!parsed.ok) return parsed.result;

  const next = parsed.data;
  const changed: string[] = [];
  if (next.title !== deal.title) changed.push("title");
  if (next.estimated_value_cents !== deal.estimated_value_cents) changed.push("estimated_value_cents");
  if ((next.next_action ?? "") !== (deal.next_action ?? "")) changed.push("next_action");
  if ((next.next_action_at ?? "").slice(0, 10) !== (deal.next_action_at ?? "").slice(0, 10))
    changed.push("next_action_at");
  if (next.assignee_user_id !== deal.assignee_user_id) changed.push("assignee_user_id");
  if (JSON.stringify(next.custom_fields) !== JSON.stringify(deal.custom_fields ?? {}))
    changed.push("custom_fields");
  if (changed.length === 0) return ok("Nessuna modifica da salvare.");
  // Keep the stored hour when the day did not change.
  if (!changed.includes("next_action_at")) next.next_action_at = deal.next_action_at;

  const { error } = await supabase
    .from("deals")
    .update(next)
    .eq("id", deal.id)
    .eq("organization_id", organizationId);
  if (error) return failFromError(error);
  const actor = actorOf(context);
  const { error: eventError } = await supabase.from("deal_events").insert({
    organization_id: organizationId,
    deal_id: deal.id,
    type: "updated",
    actor_type: actor.type,
    actor_id: actor.id,
    data: { changed },
  });
  if (eventError) console.error("[deals] updated event", eventError.code, eventError.message);
  refresh(deal.id);
  return ok("Trattativa salvata.");
}
