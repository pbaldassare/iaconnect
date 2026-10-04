import {
  type Connector,
  type ConnectorContext,
  ConnectorError,
  type NormalizedEventInput,
  type SendResult,
  SmsSendInput,
  type WebhookRequest,
  normalizePhone,
} from "@ia-connect/core";
import { z } from "zod";
import { defineAction } from "./lib/actions.ts";
import { hmacSha1Base64, timingSafeEqual, toBase64, utf8 } from "./lib/crypto.ts";
import {
  HEALTHY,
  type HttpOptions,
  healthFromError,
  parseInput,
  requestJson,
  requireString,
} from "./lib/http.ts";
import { type Json, asString, compact } from "./lib/values.ts";
import { REQUEST_URL_HEADER, UNVERIFIED, header } from "./lib/webhook.ts";

const SERVICE = "SMS (Twilio)";
const API = "https://api.twilio.com/2010-04-01";

export const SmsTwilioInput = z.object({
  accountSid: z
    .string()
    .regex(/^AC[0-9a-fA-F]{32}$/)
    .describe("Account SID"),
  authToken: z.string().min(1).describe("Auth Token"),
  sender: z
    .string()
    .min(1)
    .describe("Mittente: numero Twilio, nome alfanumerico o Messaging Service SID (MG…)"),
  statusCallbackUrl: z
    .string()
    .url()
    .optional()
    .describe("Indirizzo del webhook di questo collegamento, per ricevere lo stato di consegna"),
});

function call(
  deps: { fetch: typeof fetch },
  accountSid: string,
  authToken: string,
  path: string,
  options: HttpOptions = {},
): Promise<Json> {
  return requestJson(deps.fetch, SERVICE, `${API}/Accounts/${accountSid}${path}`, {
    ...options,
    headers: { ...options.headers, authorization: `Basic ${toBase64(utf8(`${accountSid}:${authToken}`))}` },
  });
}

function credentials(context: ConnectorContext): { accountSid: string; authToken: string } {
  return {
    accountSid: requireString(context.connection.config, "accountSid", SERVICE),
    authToken: requireString(context.secrets, "authToken", SERVICE),
  };
}

/**
 * Twilio signs the full URL followed by every POST parameter (sorted by name, name and
 * value concatenated) with HMAC-SHA1 and the auth token, base64-encoded.
 */
export async function twilioSignature(
  authToken: string,
  url: string,
  params: URLSearchParams,
): Promise<string> {
  const pairs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let data = url;
  for (const [key, value] of pairs) data += key + value;
  return hmacSha1Base64(authToken, data);
}

async function verifyTwilioRequest(
  request: WebhookRequest,
  authToken: string,
  params: URLSearchParams,
): Promise<boolean> {
  const provided = header(request, "x-twilio-signature");
  const url = header(request, REQUEST_URL_HEADER);
  if (!provided || !url) return false;
  return timingSafeEqual(await twilioSignature(authToken, url, params), provided);
}

/** Maps Twilio's form parameters to normalized events. */
export function normalizeTwilioWebhook(params: URLSearchParams): NormalizedEventInput[] {
  const sid = params.get("MessageSid") ?? params.get("SmsSid");
  if (!sid) return [];
  const status = params.get("MessageStatus");
  if (status) {
    return [
      {
        type: "sms.status.updated",
        dedupeKey: `sms_twilio:status:${sid}:${status}`,
        payload: compact({
          messageId: sid,
          // The platform knows sent, delivered, read, failed: Twilio's "undelivered" is a failure.
          status: status === "undelivered" ? "failed" : status,
          error: params.get("ErrorCode") ?? undefined,
        }),
      },
    ];
  }
  const from = params.get("From");
  if (!from || params.get("Body") === null) return [];
  const phone = normalizePhone(from) ?? from;
  return [
    {
      type: "sms.received",
      dedupeKey: `sms_twilio:msg:${sid}`,
      payload: compact({
        from: phone,
        text: params.get("Body") ?? "",
        messageId: sid,
        to: params.get("To") ?? undefined,
      }),
      contact: { phone },
    },
  ];
}

export const smsTwilioConnector: Connector = {
  key: "sms_twilio",
  category: "sms",
  name: "SMS (Twilio)",
  description: "Invio e ricezione di SMS.",
  connectMode: "api_key",
  inputSchema: SmsTwilioInput,
  emits: ["sms.received", "sms.status.updated"],

  async connect(input, deps) {
    const { authToken, ...config } = parseInput(SmsTwilioInput, input);
    await call(deps, config.accountSid, authToken, ".json");
    return { config: compact(config), secrets: { authToken }, externalAccountId: config.accountSid };
  },

  async verify(context) {
    try {
      const { accountSid, authToken } = credentials(context);
      const account = await call(context, accountSid, authToken, ".json");
      if (asString(account.status) && account.status !== "active") {
        return { status: "error", message: "L'account Twilio non è attivo." };
      }
      return HEALTHY;
    } catch (error) {
      return healthFromError(error);
    }
  },

  async handleWebhook(context, request) {
    if (request.method.toUpperCase() !== "POST") return UNVERIFIED;
    const authToken = asString(context.secrets.authToken);
    if (!authToken) return UNVERIFIED;
    const params = new URLSearchParams(request.rawBody);
    if (!(await verifyTwilioRequest(request, authToken, params))) return UNVERIFIED;
    // Messages for another account must never land on this connection.
    if (params.get("AccountSid") !== asString(context.connection.config.accountSid)) return UNVERIFIED;
    return {
      verified: true,
      events: normalizeTwilioWebhook(params),
      // Empty TwiML: Twilio must not answer the sender on its own.
      response: { status: 200, body: "<Response></Response>", contentType: "text/xml" },
    };
  },

  actions: {
    send: defineAction({
      key: "send",
      title: "Invia un SMS",
      input: SmsSendInput,
      async execute(context, input): Promise<SendResult> {
        const { accountSid, authToken } = credentials(context);
        const sender = requireString(context.connection.config, "sender", SERVICE);
        const to = normalizePhone(input.to);
        if (!to) {
          throw new ConnectorError(`${SERVICE}: numero del destinatario non valido`, {
            retryable: false,
            code: "invalid_recipient",
          });
        }
        const form: Record<string, string> = { To: to, Body: input.text };
        if (sender.startsWith("MG")) form.MessagingServiceSid = sender;
        else form.From = sender;
        const callback = asString(context.connection.config.statusCallbackUrl);
        if (callback) form.StatusCallback = callback;
        const message = await call(context, accountSid, authToken, "/Messages.json", { form });
        return { externalId: asString(message.sid) ?? "", status: "queued" };
      },
    }),
  },

  async disconnect() {
    // Nothing to revoke: the auth token is managed in the Twilio console.
  },
};
