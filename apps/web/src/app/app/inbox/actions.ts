"use server";
import { type ActionResult, fail, failFromError, ok } from "@/lib/action";
import { grantConsent, hasConsent, parseConsents } from "@/lib/contacts/consents";
import { channelLabel } from "@/lib/customer-labels";
import { isDemoReadOnly } from "@/lib/demo/client";
import { parseDirectPhone } from "@/lib/inbox/direct-send";
import {
  type OutgoingResult,
  buildFreeMessage,
  buildTemplateMessage,
  outgoingMessageRow,
  usesTemplate,
} from "@/lib/inbox/outgoing";
import { sendMessageJob } from "@/lib/job-requests";
import { requestJob } from "@/lib/jobs";
import { isUuid } from "@/lib/org-selection";
import { actorOf, requireOrg } from "@/lib/session";
import type { Json } from "@ia-connect/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function refresh(conversationId: string) {
  revalidatePath("/app/inbox");
  revalidatePath(`/app/inbox/${conversationId}`);
}

async function loadConversation(conversationId: string) {
  const context = await requireOrg();
  if (!isUuid(conversationId)) return { context, conversation: null };
  const { data: conversation } = await context.supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("organization_id", context.org.organization.id)
    .maybeSingle();
  return { context, conversation };
}

const NOT_FOUND = "Questa conversazione non esiste più. Torna all'elenco e ricarica.";

/** The conversation goes to the signed-in person: the automation stops answering it. */
export async function takeOver(conversationId: string, _prev: ActionResult): Promise<ActionResult> {
  const { context, conversation } = await loadConversation(conversationId);
  if (!conversation) return fail(NOT_FOUND);
  const { error } = await context.supabase
    .from("conversations")
    .update({ assignee_type: "user", assignee_user_id: context.session.user.id, status: "open" })
    .eq("id", conversation.id)
    .eq("organization_id", context.org.organization.id);
  if (error) return failFromError(error);
  refresh(conversation.id);
  return ok("Conversazione presa in carico: l'automazione non risponde più finché non la riaffidi.");
}

export async function releaseToAutomation(
  conversationId: string,
  _prev: ActionResult,
): Promise<ActionResult> {
  const { context, conversation } = await loadConversation(conversationId);
  if (!conversation) return fail(NOT_FOUND);
  const { error } = await context.supabase
    .from("conversations")
    .update({ assignee_type: "automation", assignee_user_id: null })
    .eq("id", conversation.id)
    .eq("organization_id", context.org.organization.id);
  if (error) return failFromError(error);
  refresh(conversation.id);
  return ok(
    "Conversazione riaffidata all'automazione: dal prossimo messaggio del contatto rispondono i flussi.",
  );
}

export async function setConversationStatus(
  conversationId: string,
  status: "open" | "closed",
  _prev: ActionResult,
): Promise<ActionResult> {
  const { context, conversation } = await loadConversation(conversationId);
  if (!conversation) return fail(NOT_FOUND);
  const { error } = await context.supabase
    .from("conversations")
    .update(status === "closed" ? { status, unread_count: 0 } : { status })
    .eq("id", conversation.id)
    .eq("organization_id", context.org.organization.id);
  if (error) return failFromError(error);
  refresh(conversation.id);
  return ok(status === "closed" ? "Conversazione chiusa." : "Conversazione riaperta.");
}

/** Called when a thread is opened: the unread counter goes back to zero. */
export async function markConversationRead(conversationId: string): Promise<void> {
  const { context, conversation } = await loadConversation(conversationId);
  if (!conversation || conversation.unread_count === 0) return;
  const { error } = await context.supabase
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", conversation.id)
    .eq("organization_id", context.org.organization.id);
  // In the public demo the write is refused by design: nothing to log.
  if (error && !isDemoReadOnly(error))
    console.error("[inbox] markConversationRead", error.code, error.message);
  else refresh(conversation.id);
}

async function queueOperatorMessage(
  context: Awaited<ReturnType<typeof requireOrg>>,
  conversation: NonNullable<Awaited<ReturnType<typeof loadConversation>>["conversation"]>,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase, org, session } = context;
  const organizationId = org.organization.id;
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const channel = conversation.channel;
  let built: OutgoingResult;
  if (usesTemplate(channel, conversation.window_expires_at, text("mode"))) {
    const templateId = text("template_id");
    if (!isUuid(templateId))
      return fail("Scegli un modello approvato.", { template_id: "Scegli un modello." });
    const { data: template, error } = await supabase
      .from("message_templates")
      .select("id, body, channel, approval_status")
      .eq("id", templateId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) return failFromError(error);
    built = buildTemplateMessage(template, formData.getAll("variables"));
  } else {
    built = buildFreeMessage(channel, text("content"), text("subject"));
  }
  if (!built.ok) return fail(built.error, built.fieldErrors);

  const row = outgoingMessageRow({
    organizationId,
    conversationId: conversation.id,
    channel,
    userId: session.user.id,
    message: built.message,
  });
  const { data: message, error: insertError } = await supabase
    .from("messages")
    .insert({ ...row, meta: row.meta as Json })
    .select("id")
    .single();
  if (insertError) return failFromError(insertError);

  const job = await requestJob(supabase, {
    organizationId,
    ...sendMessageJob(message.id),
    actor: actorOf(context),
  });
  if (job.error) {
    await supabase
      .from("messages")
      .update({
        delivery_status: "failed",
        error: "La richiesta di invio non è partita. Riscrivi il messaggio.",
      })
      .eq("id", message.id)
      .eq("organization_id", organizationId);
    refresh(conversation.id);
    return failFromError(job.error);
  }

  const patch =
    conversation.assignee_type === "user" && conversation.status === "open"
      ? { last_message_at: new Date().toISOString() }
      : {
          last_message_at: new Date().toISOString(),
          status: "open",
          assignee_type: "user",
          assignee_user_id: conversation.assignee_user_id ?? session.user.id,
        };
  const { error: patchError } = await supabase
    .from("conversations")
    .update(patch)
    .eq("id", conversation.id)
    .eq("organization_id", organizationId);
  if (patchError) console.error("[inbox] sendMessage conversation", patchError.code, patchError.message);

  refresh(conversation.id);
  const { data: contact } = await supabase
    .from("contacts")
    .select("consents")
    .eq("id", conversation.contact_id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (contact && !hasConsent(parseConsents(contact.consents), channel)) {
    return ok(
      `Messaggio messo in coda, ma il contatto non ha un consenso valido per ${channelLabel(channel)}: l'invio verrà rifiutato. Registra il consenso nella scheda del contatto e riscrivi.`,
    );
  }
  return ok("Messaggio in coda: parte tra pochi secondi. Lo stato si aggiorna qui sotto.");
}

/**
 * Operator send path: a `messages` row with `delivery_status = 'queued'`, then a
 * `send_message` job. The worker checks consent, quota and the WhatsApp window and
 * writes the outcome on the message (`sent`… or `failed` + `error`).
 */
export async function sendMessage(
  conversationId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { context, conversation } = await loadConversation(conversationId);
  if (!conversation) return fail(NOT_FOUND);
  return queueOperatorMessage(context, conversation, formData);
}

const WHATSAPP_CONNECTORS = ["whatsapp_meta", "whatsapp_wawebapi"];

/**
 * Starts (or reuses) a conversation for a number not yet in the rubric, then queues the message.
 */
export async function sendDirectMessage(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const context = await requireOrg();
  const { supabase, org, session } = context;
  const organizationId = org.organization.id;
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const phone = parseDirectPhone(text("phone"));
  if (!phone) return fail("Scrivi un numero di cellulare valido.", { phone: "Numero non valido." });
  const channel = text("channel") || "whatsapp";
  if (channel !== "whatsapp") {
    return fail("Per ora è disponibile solo WhatsApp.");
  }
  const fullName = text("full_name").slice(0, 120);
  const registerConsent = text("register_consent") === "1";

  let contactId: string | null = null;
  const { data: byPhone, error: findError } = await supabase
    .from("contacts")
    .select("id, full_name, consents, phones")
    .eq("organization_id", organizationId)
    .contains("phones", [phone])
    .limit(1)
    .maybeSingle();
  if (findError) return failFromError(findError);
  if (byPhone) {
    contactId = byPhone.id;
    if (fullName && !byPhone.full_name.trim()) {
      await supabase
        .from("contacts")
        .update({ full_name: fullName })
        .eq("id", contactId)
        .eq("organization_id", organizationId);
    }
    if (registerConsent) {
      const consents = grantConsent(byPhone.consents, "whatsapp", "Invio manuale da inbox");
      await supabase
        .from("contacts")
        .update({ consents: consents as Json })
        .eq("id", contactId)
        .eq("organization_id", organizationId);
    }
  } else {
    const consents = registerConsent ? grantConsent({}, "whatsapp", "Invio manuale da inbox") : {};
    const { data: created, error: createError } = await supabase
      .from("contacts")
      .insert({
        organization_id: organizationId,
        full_name: fullName || `Contatto ${phone}`,
        phones: [phone],
        emails: [],
        consents: consents as Json,
        custom_fields: {},
      })
      .select("id")
      .single();
    if (createError) return failFromError(createError);
    contactId = created.id;
  }

  const { data: connections } = await supabase
    .from("connections")
    .select("id, connector_type, status")
    .eq("organization_id", organizationId)
    .eq("status", "active");
  const whatsappConnection =
    connections?.find((row) => WHATSAPP_CONNECTORS.includes(row.connector_type)) ?? null;

  const { data: existingConv } = await supabase
    .from("conversations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .eq("channel", channel)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversation = existingConv;
  if (!conversation) {
    const { data: inserted, error: convError } = await supabase
      .from("conversations")
      .insert({
        organization_id: organizationId,
        contact_id: contactId,
        channel,
        connection_id: whatsappConnection?.id ?? null,
        status: "open",
        assignee_type: "user",
        assignee_user_id: session.user.id,
      })
      .select("*")
      .single();
    if (convError) return failFromError(convError);
    conversation = inserted;
  } else if (conversation.status === "closed") {
    await supabase
      .from("conversations")
      .update({ status: "open", assignee_type: "user", assignee_user_id: session.user.id })
      .eq("id", conversation.id)
      .eq("organization_id", organizationId);
  }

  if (!text("mode")) formData.set("mode", "template");
  const result = await queueOperatorMessage(context, conversation, formData);
  if (!result.ok) return result;
  redirect(`/app/inbox/${conversation.id}`);
}
