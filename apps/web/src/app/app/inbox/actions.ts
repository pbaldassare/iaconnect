"use server";
import { type ActionResult, fail, failFromError, ok } from "@/lib/action";
import { parseConsents } from "@/lib/contacts/consents";
import { hasConsent } from "@/lib/contacts/consents";
import { channelLabel } from "@/lib/customer-labels";
import { isDemoReadOnly } from "@/lib/demo/client";
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
    // Without the job nobody would ever send it: say so on the message itself.
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

  // Writing by hand means a person is following the conversation: the automation steps aside.
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
