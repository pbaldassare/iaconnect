"use server";
import { type ActionResult, fail, failFromError, ok } from "@/lib/action";
import { parseConsents } from "@/lib/contacts/consents";
import { hasConsent } from "@/lib/contacts/consents";
import { channelLabel } from "@/lib/customer-labels";
import { composerMode, whatsappWindow } from "@/lib/inbox/window";
import { requestJob } from "@/lib/jobs";
import { checkVariables, renderTemplate, variableCount } from "@/lib/message-templates";
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
  if (error) console.error("[inbox] markConversationRead", error.code, error.message);
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
  const windowState = whatsappWindow(channel, conversation.window_expires_at);
  const templateId = text("template_id");
  const useTemplate =
    channel === "whatsapp" && (text("mode") === "template" || composerMode(windowState) === "template_only");

  let content = text("content");
  let meta: Record<string, Json> = {};
  let storedTemplateId: string | null = null;

  if (useTemplate) {
    if (!isUuid(templateId))
      return fail("Scegli un modello approvato.", { template_id: "Scegli un modello." });
    const { data: template, error } = await supabase
      .from("message_templates")
      .select("id, body, channel, approval_status")
      .eq("id", templateId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) return failFromError(error);
    if (!template || template.channel !== "whatsapp")
      return fail("Questo modello non esiste più. Scegline un altro.");
    if (template.approval_status !== "approved") {
      return fail(
        "Questo modello non è ancora approvato da Meta: fuori dalle 24 ore si possono inviare solo modelli approvati.",
      );
    }
    const variables = formData
      .getAll("variables")
      .map((value) => (typeof value === "string" ? value.trim().slice(0, 500) : ""))
      .slice(0, variableCount(template.body));
    const problem = checkVariables(template.body, variables);
    if (problem) return fail(problem);
    content = renderTemplate(template.body, variables);
    meta = { variables };
    storedTemplateId = template.id;
  } else {
    if (content === "") return fail("Scrivi il messaggio.", { content: "Scrivi il messaggio." });
    if (content.length > 4000) return fail("Il messaggio è troppo lungo: al massimo 4.000 caratteri.");
    if (channel === "mail") {
      const subject = text("subject").slice(0, 200);
      if (subject) meta = { subject };
    }
  }

  const { data: message, error: insertError } = await supabase
    .from("messages")
    .insert({
      organization_id: organizationId,
      conversation_id: conversation.id,
      direction: "out",
      channel,
      content,
      meta,
      template_id: storedTemplateId,
      delivery_status: "queued",
      sent_by_user_id: session.user.id,
    })
    .select("id")
    .single();
  if (insertError) return failFromError(insertError);

  const job = await requestJob(supabase, {
    organizationId,
    kind: "send_message",
    payload: { message_id: message.id },
    dedupeKey: `send_message:${message.id}`,
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
