import { type OperatorMessageMeta, OperatorMessageMetaSchema } from "@ia-connect/core";
import { checkVariables, renderTemplate, variableCount } from "../message-templates";
import { composerMode, whatsappWindow } from "./window";

/**
 * The `messages` row of a message written by an operator. Pure (no `server-only`, no `@/`
 * imports): the worker's tests import it and send exactly what the inbox inserts.
 *
 * What the worker's `send_message` handler reads from the row:
 * - `content`: the text to send (for a template: the body already filled in);
 * - `template_id`: set only for an approved WhatsApp template; the worker looks the
 *   template up again and refuses anything not approved;
 * - `meta.variables`: the template values in order ({{1}}, {{2}}…);
 * - `meta.subject`: mail only;
 * - `delivery_status = 'queued'`: anything else is left alone.
 * The shape of `meta` is `OperatorMessageMetaSchema` in packages/core.
 */
export interface OutgoingMessage {
  content: string;
  meta: OperatorMessageMeta;
  template_id: string | null;
}

export type OutgoingResult =
  | { ok: true; message: OutgoingMessage }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** WhatsApp sends a template when the operator chose it or when the 24-hour window is closed. */
export function usesTemplate(
  channel: string,
  windowExpiresAt: string | null | undefined,
  mode: string,
  now: Date = new Date(),
): boolean {
  if (channel !== "whatsapp") return false;
  return (
    mode === "template" || composerMode(whatsappWindow(channel, windowExpiresAt, now)) === "template_only"
  );
}

export function buildTemplateMessage(
  template: { id: string; body: string; channel: string; approval_status: string } | null | undefined,
  rawVariables: readonly unknown[],
): OutgoingResult {
  if (!template || template.channel !== "whatsapp") {
    return { ok: false, error: "Questo modello non esiste più. Scegline un altro." };
  }
  if (template.approval_status !== "approved") {
    return {
      ok: false,
      error:
        "Questo modello non è ancora approvato da Meta: fuori dalle 24 ore si possono inviare solo modelli approvati.",
    };
  }
  const variables = rawVariables
    .map((value) => (typeof value === "string" ? value.trim().slice(0, 500) : ""))
    .slice(0, variableCount(template.body));
  const problem = checkVariables(template.body, variables);
  if (problem) return { ok: false, error: problem };
  return {
    ok: true,
    message: {
      content: renderTemplate(template.body, variables),
      meta: { variables },
      template_id: template.id,
    },
  };
}

export function buildFreeMessage(channel: string, content: string, subject = ""): OutgoingResult {
  const text = content.trim();
  if (text === "") {
    return { ok: false, error: "Scrivi il messaggio.", fieldErrors: { content: "Scrivi il messaggio." } };
  }
  if (text.length > 4000) {
    return { ok: false, error: "Il messaggio è troppo lungo: al massimo 4.000 caratteri." };
  }
  const meta: OperatorMessageMeta = {};
  const cleanSubject = subject.trim().slice(0, 200);
  if (channel === "mail" && cleanSubject) meta.subject = cleanSubject;
  return { ok: true, message: { content: text, meta, template_id: null } };
}

/** The row inserted in `messages`: queued, outbound, written by `userId`. */
export function outgoingMessageRow(input: {
  organizationId: string;
  conversationId: string;
  channel: string;
  userId: string;
  message: OutgoingMessage;
}) {
  return {
    organization_id: input.organizationId,
    conversation_id: input.conversationId,
    direction: "out" as const,
    channel: input.channel,
    content: input.message.content,
    meta: OperatorMessageMetaSchema.parse(input.message.meta) as OperatorMessageMeta,
    template_id: input.message.template_id,
    delivery_status: "queued" as const,
    sent_by_user_id: input.userId,
  };
}
