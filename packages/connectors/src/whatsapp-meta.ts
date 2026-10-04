import {
  type Connector,
  type ConnectorContext,
  ConnectorError,
  type NormalizedEventInput,
  type SendResult,
  WhatsAppSendTemplateInput,
  WhatsAppSendTextInput,
  normalizePhone,
} from "@ia-connect/core";
import { z } from "zod";
import { defineAction } from "./lib/actions.ts";
import { HEALTHY, healthFromError, parseInput, requireString } from "./lib/http.ts";
import { graphRequest, receiveMetaWebhook, verifyMetaSignature } from "./lib/meta.ts";
import {
  type Json,
  asArray,
  asRecord,
  asString,
  compact,
  isoFromEpochSeconds,
  unique,
} from "./lib/values.ts";
import { UNVERIFIED, parseJson } from "./lib/webhook.ts";

const SERVICE = "WhatsApp (Meta)";
const STATUSES = new Set(["sent", "delivered", "read", "failed"]);

export const WhatsAppMetaInput = z.object({
  phoneNumberId: z.string().regex(/^\d+$/).describe("ID del numero di telefono (Phone number ID)"),
  wabaId: z.string().regex(/^\d+$/).describe("ID dell'account WhatsApp Business (WABA ID)"),
  accessToken: z.string().min(1).describe("Token di accesso permanente"),
});

/** Meta wants the number as digits only, with country code and no "+". */
function recipient(to: string): string {
  const normalized = normalizePhone(to);
  if (!normalized) {
    throw new ConnectorError(`${SERVICE}: numero del destinatario non valido`, {
      retryable: false,
      code: "invalid_recipient",
    });
  }
  return normalized.slice(1);
}

async function sendMessage(context: ConnectorContext, body: Json): Promise<SendResult> {
  const phoneNumberId = requireString(context.connection.config, "phoneNumberId", SERVICE);
  const token = requireString(context.secrets, "accessToken", SERVICE);
  const result = await graphRequest(context, SERVICE, token, `${phoneNumberId}/messages`, {
    json: { messaging_product: "whatsapp", ...body },
  });
  return { externalId: asString(asRecord(asArray(result.messages)[0]).id) ?? "", status: "sent" };
}

function messageText(message: Json): string {
  const type = asString(message.type) ?? "";
  if (type === "text") return asString(asRecord(message.text).body) ?? "";
  if (type === "button") return asString(asRecord(message.button).text) ?? "";
  if (type === "interactive") {
    const interactive = asRecord(message.interactive);
    return (
      asString(asRecord(interactive.button_reply).title) ??
      asString(asRecord(interactive.list_reply).title) ??
      ""
    );
  }
  // Media messages: the caption, when there is one.
  return asString(asRecord(message[type]).caption) ?? "";
}

/** Phone number ids a webhook delivery is addressed to. */
export function whatsAppAccountIds(body: Json): string[] {
  if (body.object !== "whatsapp_business_account") return [];
  const ids: string[] = [];
  for (const entry of asArray(body.entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const id = asString(asRecord(asRecord(asRecord(change).value).metadata).phone_number_id);
      if (id) ids.push(id);
    }
  }
  return unique(ids);
}

/** Normalizes the parts of a delivery addressed to one phone number id. */
export function normalizeWhatsAppWebhook(body: Json, phoneNumberId: string): NormalizedEventInput[] {
  const events: NormalizedEventInput[] = [];
  if (body.object !== "whatsapp_business_account") return events;
  for (const entry of asArray(body.entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const value = asRecord(asRecord(change).value);
      if (asRecord(change).field !== "messages") continue;
      if (asString(asRecord(value.metadata).phone_number_id) !== phoneNumberId) continue;

      const names = new Map<string, string>();
      for (const contact of asArray(value.contacts)) {
        const waId = asString(asRecord(contact).wa_id);
        const name = asString(asRecord(asRecord(contact).profile).name);
        if (waId && name) names.set(waId, name);
      }

      for (const item of asArray(value.messages)) {
        const message = asRecord(item);
        const id = asString(message.id);
        const sender = asString(message.from);
        if (!id || !sender) continue;
        const type = asString(message.type) ?? "unknown";
        const from = `+${sender}`;
        const fromName = names.get(sender);
        events.push({
          type: "whatsapp.message.received",
          occurredAt: isoFromEpochSeconds(message.timestamp),
          dedupeKey: `whatsapp_meta:msg:${id}`,
          payload: compact({
            from,
            fromName,
            text: messageText(message),
            messageId: id,
            messageType: type,
            // Media must be downloaded with the access token: only the provider id travels here.
            mediaId: asString(asRecord(message[type]).id),
            replyToMessageId: asString(asRecord(message.context).id),
          }),
          contact: compact({ name: fromName, phone: from }),
        });
      }

      for (const item of asArray(value.statuses)) {
        const status = asRecord(item);
        const id = asString(status.id);
        const state = asString(status.status);
        if (!id || !state || !STATUSES.has(state)) continue;
        const error = asRecord(asArray(status.errors)[0]);
        const recipientId = asString(status.recipient_id);
        events.push({
          type: "whatsapp.status.updated",
          occurredAt: isoFromEpochSeconds(status.timestamp),
          dedupeKey: `whatsapp_meta:status:${id}:${state}`,
          payload: compact({
            messageId: id,
            status: state,
            error: asString(error.title) ?? asString(error.code),
            errorCode: asString(error.code),
            to: recipientId ? `+${recipientId}` : undefined,
          }),
        });
      }
    }
  }
  return events;
}

export const whatsappMetaConnector: Connector = {
  key: "whatsapp_meta",
  category: "whatsapp",
  name: "WhatsApp Business (Meta)",
  description: "API ufficiale di Meta con modelli approvati.",
  connectMode: "api_key",
  inputSchema: WhatsAppMetaInput,
  emits: ["whatsapp.message.received", "whatsapp.status.updated"],

  async connect(input, deps) {
    const { phoneNumberId, wabaId, accessToken } = parseInput(WhatsAppMetaInput, input);
    const phone = await graphRequest(deps, SERVICE, accessToken, phoneNumberId, {
      query: { fields: "display_phone_number,verified_name" },
    });
    // Without this subscription Meta does not deliver the account's webhooks to our app.
    await graphRequest(deps, SERVICE, accessToken, `${wabaId}/subscribed_apps`, { method: "POST" });
    return {
      config: compact({
        phoneNumberId,
        wabaId,
        displayPhoneNumber: asString(phone.display_phone_number),
        verifiedName: asString(phone.verified_name),
      }),
      secrets: { accessToken },
      externalAccountId: phoneNumberId,
    };
  },

  async verify(context) {
    try {
      const phoneNumberId = requireString(context.connection.config, "phoneNumberId", SERVICE);
      const token = requireString(context.secrets, "accessToken", SERVICE);
      await graphRequest(context, SERVICE, token, phoneNumberId, { query: { fields: "id" } });
      return HEALTHY;
    } catch (error) {
      return healthFromError(error);
    }
  },

  receiveProviderWebhook(request, env) {
    return receiveMetaWebhook(request, env, whatsAppAccountIds);
  },

  async handleWebhook(context, request) {
    if (request.method.toUpperCase() !== "POST") return UNVERIFIED;
    if (!(await verifyMetaSignature(request, context.env))) return UNVERIFIED;
    const phoneNumberId = asString(context.connection.config.phoneNumberId);
    if (!phoneNumberId) return { verified: true, events: [] };
    return {
      verified: true,
      events: normalizeWhatsAppWebhook(asRecord(parseJson(request.rawBody)), phoneNumberId),
    };
  },

  actions: {
    sendTemplate: defineAction({
      key: "sendTemplate",
      title: "Invia un modello WhatsApp approvato",
      input: WhatsAppSendTemplateInput,
      execute(context, input) {
        const components =
          input.variables.length > 0
            ? [{ type: "body", parameters: input.variables.map((text) => ({ type: "text", text })) }]
            : [];
        return sendMessage(context, {
          to: recipient(input.to),
          type: "template",
          template: { name: input.template, language: { code: input.language }, components },
        });
      },
    }),
    sendText: defineAction({
      key: "sendText",
      title: "Invia un messaggio WhatsApp libero (entro 24 ore dall'ultimo messaggio del cliente)",
      input: WhatsAppSendTextInput,
      execute(context, input) {
        return sendMessage(context, {
          recipient_type: "individual",
          to: recipient(input.to),
          type: "text",
          text: { preview_url: false, body: input.text },
        });
      },
    }),
  },

  async disconnect() {
    // The app subscription belongs to the whole WhatsApp Business account, which may
    // serve other numbers: it is left in place. The token is removed with the secrets.
  },
};
