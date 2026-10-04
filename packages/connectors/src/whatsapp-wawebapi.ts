/**
 * WhatsApp via QR pairing against a self-hosted waWebApi gateway.
 *
 * NOT VERIFIED against the real product: the HTTP mapping below is our assumption of a
 * minimal gateway API. Every path, header and body field lives in `WAWEBAPI` and in the
 * small mapping functions of this file, so it can be corrected in one place.
 */
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
import { randomHex, timingSafeEqual } from "./lib/crypto.ts";
import {
  type HttpOptions,
  healthFromError,
  parseInput,
  requestJson,
  requireEnv,
  requireString,
} from "./lib/http.ts";
import { RegisterWebhookInput } from "./lib/schemas.ts";
import { joinUrl } from "./lib/url.ts";
import { type Json, asRecord, asString, compact, isoFromEpochSeconds } from "./lib/values.ts";
import { UNVERIFIED, header, parseJson } from "./lib/webhook.ts";

const SERVICE = "WhatsApp (waWebApi)";

/** Assumed gateway API. Check every entry against the real waWebApi documentation. */
export const WAWEBAPI = {
  /** Header carrying the per-connection API key on every call to the gateway. */
  apiKeyHeader: "x-api-key",
  /** Header the gateway must send on inbound webhooks, with the shared secret. */
  webhookSecretHeader: "x-webhook-secret",
  /** POST { sessionId } → { qr } */
  createSession: () => "/sessions",
  /** GET → { status: "connected" | "pending" | "disconnected", phone? } */
  sessionStatus: (sessionId: string) => `/sessions/${encodeURIComponent(sessionId)}`,
  /** PUT { url, secret } → registers the inbound webhook of the session */
  sessionWebhook: (sessionId: string) => `/sessions/${encodeURIComponent(sessionId)}/webhook`,
  /** POST { to, text } → { id } */
  sendText: (sessionId: string) => `/sessions/${encodeURIComponent(sessionId)}/messages`,
  /** DELETE → logs the number out and removes the session */
  deleteSession: (sessionId: string) => `/sessions/${encodeURIComponent(sessionId)}`,
  /** Inbound webhook body: { event: "message" | "status", data: {...} } */
  events: { message: "message", status: "status" },
  connectedStatus: "connected",
  pendingStatus: "pending",
} as const;

export const WaWebApiInput = z.object({
  apiKey: z.string().min(1).describe("Chiave API del gateway waWebApi"),
  sessionId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{3,64}$/)
    .optional()
    .describe("Identificativo della sessione (lascia vuoto per generarlo)"),
});

function call(
  deps: { fetch: typeof fetch; env: Record<string, string | undefined> },
  apiKey: string,
  path: string,
  options: HttpOptions = {},
): Promise<Json> {
  return requestJson(deps.fetch, SERVICE, joinUrl(requireEnv(deps.env, "WAWEBAPI_BASE_URL"), path), {
    ...options,
    headers: { ...options.headers, [WAWEBAPI.apiKeyHeader]: apiKey },
  });
}

function session(context: ConnectorContext): { sessionId: string; apiKey: string } {
  return {
    sessionId: requireString(context.connection.config, "sessionId", SERVICE),
    apiKey: requireString(context.secrets, "apiKey", SERVICE),
  };
}

async function sendText(context: ConnectorContext, to: string, text: string): Promise<SendResult> {
  const { sessionId, apiKey } = session(context);
  const phone = normalizePhone(to);
  if (!phone) {
    throw new ConnectorError(`${SERVICE}: numero del destinatario non valido`, {
      retryable: false,
      code: "invalid_recipient",
    });
  }
  const result = await call(context, apiKey, WAWEBAPI.sendText(sessionId), {
    json: { to: phone.slice(1), text },
  });
  return { externalId: asString(result.id) ?? "", status: "sent" };
}

/** Maps the assumed gateway webhook body to normalized events. */
export function normalizeWaWebApiWebhook(body: Json): NormalizedEventInput[] {
  const data = asRecord(body.data);
  const id = asString(data.id);
  if (!id) return [];
  if (body.event === WAWEBAPI.events.message) {
    const from = normalizePhone(asString(data.from) ?? "");
    if (!from || data.fromMe === true) return [];
    const fromName = asString(data.fromName);
    return [
      {
        type: "whatsapp.message.received",
        occurredAt: isoFromEpochSeconds(data.timestamp),
        dedupeKey: `whatsapp_wawebapi:msg:${id}`,
        payload: compact({
          from,
          fromName,
          text: asString(data.text) ?? "",
          messageId: id,
          mediaUrl: asString(data.mediaUrl),
        }),
        contact: compact({ name: fromName, phone: from }),
      },
    ];
  }
  if (body.event === WAWEBAPI.events.status) {
    const status = asString(data.status);
    if (!status || !["sent", "delivered", "read", "failed"].includes(status)) return [];
    return [
      {
        type: "whatsapp.status.updated",
        occurredAt: isoFromEpochSeconds(data.timestamp),
        dedupeKey: `whatsapp_wawebapi:status:${id}:${status}`,
        payload: compact({ messageId: id, status, error: asString(data.error) }),
      },
    ];
  }
  return [];
}

export const whatsappWaWebApiConnector: Connector = {
  key: "whatsapp_wawebapi",
  category: "whatsapp",
  name: "WhatsApp via QR (waWebApi)",
  description: "Collega il numero inquadrando un codice QR.",
  connectMode: "qr",
  inputSchema: WaWebApiInput,
  emits: ["whatsapp.message.received", "whatsapp.status.updated"],

  async connect(input, deps) {
    const parsed = parseInput(WaWebApiInput, input);
    const sessionId = parsed.sessionId ?? `ia-${randomHex(8)}`;
    const created = await call(deps, parsed.apiKey, WAWEBAPI.createSession(), { json: { sessionId } });
    return {
      config: { sessionId },
      secrets: { apiKey: parsed.apiKey, webhookSecret: randomHex(32) },
      externalAccountId: sessionId,
      pending: {
        qr: asString(created.qr),
        message: "Apri WhatsApp sul telefono, vai su Dispositivi collegati e inquadra il codice QR.",
      },
    };
  },

  async verify(context) {
    try {
      const { sessionId, apiKey } = session(context);
      const status = asString((await call(context, apiKey, WAWEBAPI.sessionStatus(sessionId))).status);
      if (status === WAWEBAPI.connectedStatus) return { status: "active", message: "Numero collegato." };
      if (status === WAWEBAPI.pendingStatus) {
        return { status: "error", message: "In attesa della scansione del codice QR." };
      }
      return {
        status: "expired",
        message: "Il numero non è più collegato: ripeti il collegamento con il codice QR.",
      };
    } catch (error) {
      return healthFromError(error);
    }
  },

  async handleWebhook(context, request) {
    const secret = asString(context.secrets.webhookSecret);
    const provided = header(request, WAWEBAPI.webhookSecretHeader);
    if (
      request.method.toUpperCase() !== "POST" ||
      !secret ||
      !provided ||
      !timingSafeEqual(secret, provided)
    ) {
      return UNVERIFIED;
    }
    return { verified: true, events: normalizeWaWebApiWebhook(asRecord(parseJson(request.rawBody))) };
  },

  actions: {
    sendTemplate: defineAction({
      key: "sendTemplate",
      title: "Invia un messaggio da modello (testo già compilato)",
      input: WhatsAppSendTemplateInput,
      execute(context, input) {
        // No server-side templates on this provider: the engine renders the text.
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
    /** Not a standard action: called once by the platform after the connection row (and its webhook URL) exists. */
    registerWebhook: defineAction({
      key: "registerWebhook",
      title: "Registra il webhook sul gateway",
      input: RegisterWebhookInput,
      async execute(context, input) {
        const { sessionId, apiKey } = session(context);
        const secret = requireString(context.secrets, "webhookSecret", SERVICE);
        await call(context, apiKey, WAWEBAPI.sessionWebhook(sessionId), {
          method: "PUT",
          json: { url: input.url, secret },
        });
        return { registered: true };
      },
    }),
  },

  async disconnect(context) {
    try {
      const { sessionId, apiKey } = session(context);
      await call(context, apiKey, WAWEBAPI.deleteSession(sessionId), { method: "DELETE" });
    } catch {
      // Best effort: the session can also be removed from the gateway.
    }
  },
};
