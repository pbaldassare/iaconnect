/**
 * WhatsApp through waWebApi (Infinity Digital), as served by Futureflow.
 *
 * Contract: OpenAPI 1.0, project wawebapi on Stoplight (node bkaibnti9tysr).
 * The live route is POST /api/message/text — the documented {paramsPath} segment
 * is not implemented by the server. Inbound events follow the webhook-* schemas.
 * There is no call to register the webhook URL: the customer pastes it in the panel.
 */
import {
  type Connector,
  type ConnectorContext,
  ConnectorError,
  type HostResolver,
  type NormalizedEventInput,
  type SendResult,
  WhatsAppSendTemplateInput,
  WhatsAppSendTextInput,
  normalizePhone,
} from "@ia-connect/core";
import { z } from "zod";
import { defineAction } from "./lib/actions.ts";
import {
  type HttpOptions,
  healthFromError,
  parseInput,
  requestJson,
  requireEnv,
  requireString,
} from "./lib/http.ts";
import { assertPublicHttpUrl, assertPublicTarget, guardedFetch, joinUrl } from "./lib/url.ts";
import { type Json, asRecord, asString, compact, isoFromEpochSeconds } from "./lib/values.ts";
import { UNVERIFIED, parseJson } from "./lib/webhook.ts";

const SERVICE = "WhatsApp (waWebApi)";

/** Paths and fields from the waWebApi 1.0 specification. */
export const WAWEBAPI = {
  sendText: "/api/message/text",
  /** Webhook `type` values. A message may also arrive with the type omitted. */
  events: { message: "message", status: "message_update", connection: "connection" },
  /** `body.update.status` on message_update. 1 (PENDING) is not a delivery event. */
  deliveryStatus: { 0: "failed", 2: "sent", 3: "delivered", 4: "read", 5: "read" } as Record<
    number,
    "sent" | "delivered" | "read" | "failed"
  >,
} as const;

export const WaWebApiInput = z.object({
  apiKey: z.string().trim().min(1).describe("Token Bearer waWebApi"),
  instanceId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{3,64}$/)
    .describe("Id istanza"),
  baseUrl: z.string().trim().min(1).optional().describe("Indirizzo del server (facoltativo)"),
});

interface GatewayDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  resolveHost?: HostResolver;
}

/** Origin of the gateway. A customer-supplied address is checked; otherwise the platform one is. */
async function gatewayOrigin(raw: string | undefined, deps: GatewayDeps): Promise<string> {
  const configured = raw?.trim() || requireEnv(deps.env, "WAWEBAPI_BASE_URL");
  const url = assertPublicHttpUrl(configured, SERVICE);
  await assertPublicTarget(url.hostname, SERVICE, deps.resolveHost);
  return url.origin;
}

async function call(
  deps: GatewayDeps,
  apiKey: string,
  baseUrl: string | undefined,
  path: string,
  options: HttpOptions = {},
): Promise<Json> {
  const origin = await gatewayOrigin(baseUrl, deps);
  try {
    return await requestJson(
      guardedFetch(deps.fetch, SERVICE, deps.resolveHost),
      SERVICE,
      joinUrl(origin, path),
      {
        ...options,
        headers: { ...options.headers, authorization: `Bearer ${apiKey}` },
      },
    );
  } catch (error) {
    if (error instanceof ConnectorError && error.options.status === 503) {
      throw new ConnectorError(`${SERVICE}: dispositivo non connesso`, {
        retryable: true,
        code: "device_offline",
        status: 503,
      });
    }
    throw error;
  }
}

function session(context: ConnectorContext): { instanceId: string; apiKey: string; baseUrl?: string } {
  return {
    instanceId: requireString(context.connection.config, "instanceId", SERVICE),
    apiKey: requireString(context.secrets, "apiKey", SERVICE),
    baseUrl: asString(context.connection.config.baseUrl),
  };
}

function messageIdOf(result: Json): string {
  const data = asRecord(result.data);
  const id = asString(asRecord(data.key).id);
  if (!id) {
    throw new ConnectorError(`${SERVICE}: risposta senza identificativo del messaggio`, {
      retryable: false,
      code: "missing_id",
    });
  }
  return id;
}

async function sendText(context: ConnectorContext, to: string, text: string): Promise<SendResult> {
  const { instanceId, apiKey, baseUrl } = session(context);
  const phone = normalizePhone(to);
  if (!phone) {
    throw new ConnectorError(`${SERVICE}: numero del destinatario non valido`, {
      retryable: false,
      code: "invalid_recipient",
    });
  }
  const result = await call(context, apiKey, baseUrl, WAWEBAPI.sendText, {
    json: { instanceId, recipient: phone.slice(1), message: text },
  });
  return { externalId: messageIdOf(result), status: "sent" };
}

/** Digits before "@" on a WhatsApp jid. A linked-id (`@lid`) is not a phone number. */
export function phoneFromJid(jid: string | undefined): string | null {
  if (!jid) return null;
  const trimmed = jid.trim();
  if (trimmed.toLowerCase().endsWith("@lid")) return null;
  const local = trimmed.split("@")[0]?.split(":")[0] ?? "";
  const digits = local.replace(/\D/g, "");
  if (!digits) return null;
  return normalizePhone(`+${digits}`);
}

function messageText(message: Json): string {
  const conversation = asString(message.conversation);
  if (conversation) return conversation;
  const extended = asString(asRecord(message.extendedTextMessage).text);
  if (extended) return extended;
  for (const key of ["imageMessage", "videoMessage", "documentMessage"] as const) {
    const caption = asString(asRecord(message[key]).caption);
    if (caption) return caption;
  }
  const reaction = asString(asRecord(message.reactionMessage).text);
  if (reaction) return reaction;
  return asString(asRecord(message.contactMessage).displayName) ?? "";
}

function mediaUrlOf(message: Json): string | undefined {
  for (const key of ["imageMessage", "videoMessage", "audioMessage", "documentMessage"] as const) {
    const url = asString(asRecord(message[key]).url);
    if (url) return url;
  }
  return undefined;
}

function deliveryStatus(value: unknown): "sent" | "delivered" | "read" | "failed" | undefined {
  const code = typeof value === "number" ? value : Number(asString(value));
  return WAWEBAPI.deliveryStatus[code];
}

function statusEvents(body: unknown): NormalizedEventInput[] {
  const items = Array.isArray(body) ? body : [body];
  const events: NormalizedEventInput[] = [];
  for (const item of items) {
    const record = asRecord(item);
    const id = asString(asRecord(record.key).id);
    const status = deliveryStatus(asRecord(record.update).status);
    if (!id || !status) continue;
    events.push({
      type: "whatsapp.status.updated",
      dedupeKey: `whatsapp_wawebapi:status:${id}:${status}`,
      payload: { messageId: id, status },
    });
  }
  return events;
}

function messageEvents(body: Json): NormalizedEventInput[] {
  const key = asRecord(body.key);
  if (key.fromMe === true) return [];
  const id = asString(key.id);
  const from = phoneFromJid(asString(key.remoteJid));
  if (!id || !from) return [];
  const message = asRecord(body.message);
  const fromName = asString(body.pushName);
  return [
    {
      type: "whatsapp.message.received",
      occurredAt: isoFromEpochSeconds(body.messageTimestamp),
      dedupeKey: `whatsapp_wawebapi:msg:${id}`,
      payload: compact({
        from,
        fromName,
        text: messageText(message),
        messageId: id,
        mediaUrl: mediaUrlOf(message),
      }),
      contact: compact({ name: fromName, phone: from }),
    },
  ];
}

/** Maps a waWebApi webhook body to normalized events. `connection` is handled by the caller. */
export function normalizeWaWebApiWebhook(payload: Json): NormalizedEventInput[] {
  const type = (asString(payload.type) ?? "").toLowerCase();
  if (type === WAWEBAPI.events.connection) return [];
  if (type === WAWEBAPI.events.status) return statusEvents(payload.body);
  if (Array.isArray(payload.body)) return statusEvents(payload.body);
  return messageEvents(asRecord(payload.body));
}

function linkHealth(state: string | undefined): { status: "active" | "expired" | "error"; message: string } {
  if (state === "close") {
    return {
      status: "expired",
      message: "Il numero non è più collegato: sul telefono apri WhatsApp e ricollega il dispositivo.",
    };
  }
  if (state === "connecting") return { status: "error", message: "Il numero si sta riconnettendo." };
  return { status: "active", message: "Numero collegato." };
}

export const whatsappWaWebApiConnector: Connector = {
  key: "whatsapp_wawebapi",
  category: "whatsapp",
  name: "WhatsApp via QR (waWebApi)",
  description: "Numero già collegato su waWebApi: id istanza e token Bearer.",
  connectMode: "qr",
  inputSchema: WaWebApiInput,
  emits: ["whatsapp.message.received", "whatsapp.status.updated"],

  async connect(input, deps) {
    const parsed = parseInput(WaWebApiInput, input);
    const baseUrl = await gatewayOrigin(parsed.baseUrl, deps);
    return {
      config: { instanceId: parsed.instanceId, baseUrl },
      secrets: { apiKey: parsed.apiKey },
      externalAccountId: parsed.instanceId,
    };
  },

  async verify(context) {
    try {
      session(context);
      return linkHealth(asString(context.secrets.linkState));
    } catch (error) {
      return healthFromError(error);
    }
  },

  async handleWebhook(context, request) {
    if (request.method.toUpperCase() !== "POST") return UNVERIFIED;
    const payload = asRecord(parseJson(request.rawBody));
    if ((asString(payload.type) ?? "").toLowerCase() === WAWEBAPI.events.connection) {
      const state = asString(asRecord(payload.body).connection);
      if (state === "open" || state === "close" || state === "connecting") {
        await context.saveSecrets({ ...context.secrets, linkState: state });
      }
      return { verified: true, events: [] };
    }
    return { verified: true, events: normalizeWaWebApiWebhook(payload) };
  },

  actions: {
    sendTemplate: defineAction({
      key: "sendTemplate",
      title: "Invia un messaggio da modello (testo già compilato)",
      input: WhatsAppSendTemplateInput,
      execute(context, input) {
        // No server-side templates: the engine renders the text.
        if (!input.renderedText) {
          throw new ConnectorError(`${SERVICE}: testo del modello mancante`, {
            retryable: false,
            code: "missing_rendered_text",
          });
        }
        return sendText(context, input.to, input.renderedText);
      },
    }),
    sendText: defineAction({
      key: "sendText",
      title: "Invia un messaggio WhatsApp",
      input: WhatsAppSendTextInput,
      execute: (context, input) => sendText(context, input.to, input.text),
    }),
  },

  async disconnect() {
    // The specification has no logout call. Saying we notified the provider would be false.
    throw new ConnectorError(`${SERVICE}: la sessione resta attiva sul telefono`, {
      retryable: false,
      code: "unsupported",
    });
  },
};
