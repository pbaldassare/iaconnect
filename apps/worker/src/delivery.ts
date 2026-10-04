import { type Channel, SendResultSchema, hasValidConsent } from "@ia-connect/core";
import { runAction } from "./connectors.ts";
import {
  CHANNEL_LABELS,
  type ConnectionRow,
  type ContactRow,
  type ConversationRow,
  addUsage,
  consumeQuota,
  toDate,
} from "./db/repo.ts";
import type { Sql } from "./db/sql.ts";
import type { Deps, WorkerConfig } from "./deps.ts";
import { StepError } from "./errors.ts";

export interface Delivery {
  organizationId: string;
  channel: Channel;
  connection: ConnectionRow;
  contact: Pick<ContactRow, "consents">;
  /** Missing for a first message: the WhatsApp window is then closed by definition. */
  conversation?: Pick<ConversationRow, "id" | "window_expires_at" | "external_thread_id">;
  to: string;
  text: string;
  subject?: string;
  /** WhatsApp approved template: the only send allowed outside the 24-hour window. */
  template?: { name: string; language: string; variables: string[] };
  platform?: string;
}

/** In non-production environments every message goes to the test recipient, or nowhere. */
export function overrideRecipient(config: WorkerConfig, channel: Channel, to: string): string {
  const override = config.outboundOverride;
  if (!override) return to;
  const recipient = override[channel];
  if (recipient) return recipient;
  if (override.blockOthers) {
    throw new StepError(
      `Invio bloccato: in questo ambiente di prova non c'è un destinatario di prova per il canale ${CHANNEL_LABELS[channel]}.`,
      "override",
    );
  }
  return to;
}

/** Reasons a send would be refused, in Italian. Empty = allowed (quota excluded: it is consumed, not read). */
export function sendRefusal(
  delivery: Pick<Delivery, "channel" | "contact" | "conversation" | "template">,
  now: Date,
) {
  if (!hasValidConsent(delivery.contact.consents, delivery.channel)) {
    return `Invio rifiutato: il contatto non ha dato il consenso per il canale ${CHANNEL_LABELS[delivery.channel]}.`;
  }
  if (delivery.channel === "whatsapp" && !delivery.template) {
    const expires = toDate(delivery.conversation?.window_expires_at);
    if (!expires || expires.getTime() <= now.getTime()) {
      return "Invio rifiutato: la finestra di 24 ore di WhatsApp è chiusa. Fuori dalla finestra si può inviare solo un modello approvato.";
    }
  }
  return null;
}

/**
 * The one place a message leaves the platform. Order: consent, WhatsApp window,
 * quota (consumed atomically), test-recipient override, connector call.
 */
export async function deliver(deps: Deps, sql: Sql, delivery: Delivery) {
  const refusal = sendRefusal(delivery, deps.now());
  if (refusal) throw new StepError(refusal, "refused");
  const to = overrideRecipient(deps.config, delivery.channel, delivery.to);
  if (!(await consumeQuota(sql, delivery.organizationId, "messages"))) {
    throw new StepError("Invio rifiutato: i messaggi del mese previsti dal piano sono esauriti.", "quota");
  }
  // An answer follows the last message received in the conversation: a mail carries its
  // Message-ID (so the provider threads the reply), a social message goes out on the same platform.
  const answered =
    (delivery.channel === "mail" || delivery.channel === "social") && delivery.conversation
      ? await lastInbound(sql, delivery.organizationId, delivery.conversation.id)
      : undefined;
  try {
    const result = await runAction(deps, delivery.connection, ...actionFor(delivery, to, answered));
    return SendResultSchema.parse(result);
  } catch (error) {
    // Nothing was sent as far as we know: give the message back to the quota.
    await addUsage(sql, delivery.organizationId, "messages", -1).catch(() => undefined);
    throw error;
  }
}

interface Answered {
  external_id: string | null;
  platform: string | null;
}

async function lastInbound(
  sql: Sql,
  organizationId: string,
  conversationId: string,
): Promise<Answered | undefined> {
  const rows = await sql.query<Answered>(
    `select external_id, meta ->> 'platform' as platform from ia_connect.messages
     where conversation_id = $1 and organization_id = $2 and direction = 'in'
     order by created_at desc limit 1`,
    [conversationId, organizationId],
  );
  return rows[0];
}

function actionFor(delivery: Delivery, to: string, answered?: Answered): [string, Record<string, unknown>] {
  switch (delivery.channel) {
    case "whatsapp":
      return delivery.template
        ? [
            "sendTemplate",
            {
              to,
              template: delivery.template.name,
              language: delivery.template.language,
              variables: delivery.template.variables,
              renderedText: delivery.text,
            },
          ]
        : ["sendText", { to, text: delivery.text }];
    case "mail":
      return [
        "send",
        {
          to,
          subject: delivery.subject ?? "",
          text: delivery.text,
          threadId: delivery.conversation?.external_thread_id ?? undefined,
          inReplyTo: answered?.external_id ?? undefined,
        },
      ];
    case "sms":
      return ["send", { to, text: delivery.text }];
    case "social":
      return [
        "sendMessage",
        { to, text: delivery.text, platform: delivery.platform ?? answered?.platform ?? undefined },
      ];
  }
}
