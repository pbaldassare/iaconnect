import { randomUUID } from "node:crypto";
import { type Channel, type ContactConsents, normalizePhone } from "@ia-connect/core";
import {
  CHANNEL_LABELS,
  type ContactRow,
  type ConversationRow,
  audit,
  findContact,
  findOrCreateConversation,
  getContact,
  getConversation,
  getSettings,
  insertOutboundMessage,
  resolveConnection,
} from "../db/repo.ts";
import { deliver, sendRefusal } from "../delivery.ts";
import { StepError } from "../errors.ts";
import type { StepContext } from "./types.ts";

export interface FlowMessage {
  channel: Channel;
  text: string;
  subject?: string;
  to?: string;
  connectionId?: string;
  template?: { id: string; name: string; language: string; variables: string[] };
  aiGenerated?: boolean;
  aiModel?: string;
}

const ACTION_BY_CHANNEL: Record<Channel, string> = {
  whatsapp: "sendText",
  mail: "send",
  sms: "send",
  social: "sendMessage",
};

export function addressOf(contact: Pick<ContactRow, "phones" | "emails" | "external_ids">, channel: Channel) {
  if (channel === "mail") return contact.emails[0];
  if (channel === "social") {
    const id = contact.external_ids?.social;
    return typeof id === "string" ? id : undefined;
  }
  return contact.phones[0];
}

function ownsAddress(contact: ContactRow, to: string): boolean {
  const lowered = to.trim().toLowerCase();
  return (
    contact.emails.includes(lowered) ||
    contact.phones.includes(normalizePhone(to) ?? "") ||
    contact.external_ids?.social === to
  );
}

/** Adds the "automatic message" notice to the first automatic message of a conversation. */
async function withDisclosure(ctx: StepContext, conversation: ConversationRow | undefined, text: string) {
  const { ai_disclosure: disclosure } = await getSettings(ctx.sql, ctx.org.id);
  if (!disclosure || /automatic/i.test(text) || text.includes(disclosure)) return text;
  if (conversation) {
    const sent = await ctx.sql.query(
      `select 1 from ia_connect.messages where conversation_id = $1 and direction = 'out' and sent_by_user_id is null
       limit 1`,
      [conversation.id],
    );
    if (sent.length) return text;
  }
  return `${text}\n\n${disclosure}`;
}

/** Who receives a flow message: the run's contact, or the contact that owns the explicit `to`. */
async function recipient(ctx: StepContext, message: FlowMessage) {
  let contact = ctx.run.contact_id ? await getContact(ctx.sql, ctx.org.id, ctx.run.contact_id) : undefined;
  if (message.to && (!contact || !ownsAddress(contact, message.to))) {
    contact = await findContact(ctx.sql, ctx.org.id, {
      phone: message.to.includes("@") ? null : normalizePhone(message.to),
      email: message.to.includes("@") ? message.to.trim().toLowerCase() : null,
      socialId: message.to,
    });
  }
  return contact;
}

/** Sends a message from a flow step and stores it in the conversation. */
export async function sendFromFlow(ctx: StepContext, message: FlowMessage) {
  const { deps, sql, org } = ctx;
  const label = CHANNEL_LABELS[message.channel];
  const contact = await recipient(ctx, message);
  if (!contact) {
    throw new StepError(
      'Nessun contatto a cui inviare: prima di un invio serve il passo "Crea o aggiorna contatto".',
      "contact",
    );
  }
  const phoneChannel = message.channel === "whatsapp" || message.channel === "sms";
  const to =
    (phoneChannel && message.to ? normalizePhone(message.to) : message.to) ??
    addressOf(contact, message.channel);
  if (!to) throw new StepError(`Il contatto non ha un recapito per il canale ${label}.`, "address");

  const current = ctx.run.conversation_id
    ? await getConversation(sql, org.id, ctx.run.conversation_id)
    : undefined;
  const sameThread = current && current.channel === message.channel && current.contact_id === contact.id;
  const connection = await resolveConnection(
    sql,
    org.id,
    message.channel,
    message.connectionId,
    sameThread ? current.connection_id : null,
    (row) => Boolean(deps.connectors.get(row.connector_type)?.actions[ACTION_BY_CHANNEL[message.channel]]),
  );
  const conversation =
    sameThread && current.connection_id === connection.id
      ? current
      : await findOrCreateConversation(sql, {
          organizationId: org.id,
          contactId: contact.id,
          channel: message.channel,
          connectionId: connection.id,
        });

  // An approved template is sent as approved; free text gets the notice when it is the first automatic message.
  const text = message.template ? message.text : await withDisclosure(ctx, conversation, message.text);
  const sent = await deliver(deps, sql, {
    organizationId: org.id,
    channel: message.channel,
    connection,
    contact,
    conversation,
    to,
    text,
    subject: message.subject,
    template: message.template,
  });

  const messageId = randomUUID();
  await insertOutboundMessage(sql, {
    id: messageId,
    organizationId: org.id,
    conversationId: conversation.id,
    channel: message.channel,
    content: text,
    meta: message.subject ? { subject: message.subject } : {},
    templateId: message.template?.id,
    aiGenerated: message.aiGenerated,
    aiModel: message.aiModel,
    externalId: sent.externalId,
    deliveryStatus: sent.status,
    flowRunId: ctx.run.id,
    at: deps.now(),
  });
  await audit(
    sql,
    org.id,
    "message.sent",
    { type: "message", id: messageId },
    {
      channel: message.channel,
      flow_run_id: ctx.run.id,
      step_id: ctx.step.id,
    },
  );
  ctx.run.contact_id ??= contact.id;
  ctx.run.conversation_id = conversation.id;
  return { messageId, externalId: sent.externalId, conversationId: conversation.id, text };
}

/** Simulation: what would be sent and to whom, plus the reasons a real send would be refused. */
export async function previewFromFlow(ctx: StepContext, message: FlowMessage) {
  const virtual = ctx.state._sim?.contact as
    | { phone?: string | null; email?: string | null; consents?: ContactConsents }
    | undefined;
  const contact = await recipient(ctx, message);
  const to =
    message.to ??
    (message.channel === "mail" ? virtual?.email : virtual?.phone) ??
    (contact ? addressOf(contact, message.channel) : undefined);
  const consents = { ...(contact?.consents ?? {}), ...(virtual?.consents ?? {}) };
  const conversation =
    contact && ctx.run.conversation_id
      ? await getConversation(ctx.sql, ctx.org.id, ctx.run.conversation_id)
      : undefined;
  const warnings: string[] = [];
  if (!to) warnings.push(`Il contatto non ha un recapito per il canale ${CHANNEL_LABELS[message.channel]}.`);
  const refusal = sendRefusal(
    { channel: message.channel, contact: { consents }, conversation, template: message.template },
    ctx.deps.now(),
  );
  if (refusal) warnings.push(refusal);
  const text = message.template ? message.text : await withDisclosure(ctx, conversation, message.text);
  return {
    simulated: true,
    messageId: null,
    channel: message.channel,
    to: to ?? null,
    text,
    ...(message.subject ? { subject: message.subject } : {}),
    ...(message.template ? { template: message.template.name } : {}),
    warnings,
  };
}
