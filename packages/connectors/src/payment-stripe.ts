import {
  type Connector,
  type ConnectorContext,
  ConnectorError,
  type NormalizedEventInput,
  PaymentCreateLinkInput,
  type WebhookRequest,
} from "@ia-connect/core";
import { z } from "zod";
import { defineAction } from "./lib/actions.ts";
import { hmacSha256Hex, timingSafeEqual } from "./lib/crypto.ts";
import {
  HEALTHY,
  type HttpOptions,
  healthFromError,
  parseInput,
  requestJson,
  requireString,
} from "./lib/http.ts";
import { RegisterWebhookInput } from "./lib/schemas.ts";
import { type Json, asRecord, asString, compact, isoFromEpochSeconds } from "./lib/values.ts";
import { UNVERIFIED, header, parseJson } from "./lib/webhook.ts";

const SERVICE = "Stripe";
const API = "https://api.stripe.com/v1";
/** Reject deliveries whose signed timestamp is older than this (replay protection). */
const SIGNATURE_TOLERANCE_SECONDS = 300;
const WEBHOOK_EVENT = "checkout.session.completed";

export const PaymentStripeInput = z.object({
  secretKey: z
    .string()
    .regex(/^(sk|rk)_(test|live)_/)
    .describe("Chiave segreta o chiave con restrizioni di Stripe"),
  webhookSecret: z
    .string()
    .regex(/^whsec_/)
    .optional()
    .describe("Segreto dell'endpoint webhook (whsec_…), se il webhook è stato creato a mano"),
});

function call(
  deps: { fetch: typeof fetch },
  secretKey: string,
  path: string,
  options: HttpOptions = {},
): Promise<Json> {
  return requestJson(deps.fetch, SERVICE, `${API}${path}`, {
    ...options,
    headers: { ...options.headers, authorization: `Bearer ${secretKey}` },
  });
}

/** `Stripe-Signature: t=<unix>,v1=<hex hmac of "t.body">` (several v1 values during a secret rotation). */
export async function verifyStripeSignature(
  request: WebhookRequest,
  secret: string | undefined,
  now: Date,
): Promise<boolean> {
  const signature = header(request, "stripe-signature");
  if (!secret || !signature) return false;
  let timestamp: string | undefined;
  const candidates: string[] = [];
  for (const part of signature.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t") timestamp = value;
    if (key === "v1" && value) candidates.push(value);
  }
  const seconds = Number(timestamp);
  if (!timestamp || !Number.isFinite(seconds)) return false;
  if (Math.abs(now.getTime() / 1000 - seconds) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = await hmacSha256Hex(secret, `${timestamp}.${request.rawBody}`);
  return candidates.some((candidate) => timingSafeEqual(expected, candidate));
}

/** Maps a Stripe event to normalized events. Only paid checkout sessions count. */
export function normalizeStripeEvent(event: Json): NormalizedEventInput[] {
  const id = asString(event.id);
  const session = asRecord(asRecord(event.data).object);
  if (!id || event.type !== WEBHOOK_EVENT) return [];
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return [];
  const reference = asString(asRecord(session.metadata).reference);
  const amountCents = Number(session.amount_total);
  const customer = asRecord(session.customer_details);
  const currency = asString(session.currency)?.toUpperCase();
  return [
    {
      type: "payment.completed",
      occurredAt: isoFromEpochSeconds(event.created),
      dedupeKey: `payment_stripe:${id}`,
      payload: compact({
        // The platform passes its payment request id as `reference` when creating the link.
        paymentRequestId: reference ?? "",
        reference,
        amount: Number.isFinite(amountCents) ? amountCents / 100 : undefined,
        amountCents: Number.isFinite(amountCents) ? amountCents : undefined,
        currency,
        externalId: asString(session.payment_link) ?? asString(session.id),
        sessionId: asString(session.id),
      }),
      contact: compact({
        name: asString(customer.name),
        email: asString(customer.email),
        phone: asString(customer.phone),
      }),
    },
  ];
}

function secretKey(context: ConnectorContext): string {
  return requireString(context.secrets, "secretKey", SERVICE);
}

export const paymentStripeConnector: Connector = {
  key: "payment_stripe",
  category: "payment",
  name: "Pagamenti (Stripe)",
  description: "Crea link di pagamento.",
  connectMode: "api_key",
  inputSchema: PaymentStripeInput,
  emits: ["payment.completed"],

  async connect(input, deps) {
    const parsed = parseInput(PaymentStripeInput, input);
    const account = await call(deps, parsed.secretKey, "/account");
    const accountId = asString(account.id);
    return {
      config: compact({ accountId, livemode: parsed.secretKey.includes("_live_") }),
      secrets: compact({ secretKey: parsed.secretKey, webhookSecret: parsed.webhookSecret }),
      externalAccountId: accountId,
    };
  },

  async verify(context) {
    try {
      await call(context, secretKey(context), "/account");
      if (!asString(context.secrets.webhookSecret)) {
        return {
          status: "error",
          message: "Webhook non ancora registrato: i pagamenti completati non vengono rilevati.",
        };
      }
      return HEALTHY;
    } catch (error) {
      return healthFromError(error);
    }
  },

  async handleWebhook(context, request) {
    if (request.method.toUpperCase() !== "POST") return UNVERIFIED;
    const secret = asString(context.secrets.webhookSecret);
    if (!(await verifyStripeSignature(request, secret, context.now()))) return UNVERIFIED;
    return { verified: true, events: normalizeStripeEvent(asRecord(parseJson(request.rawBody))) };
  },

  actions: {
    createLink: defineAction({
      key: "createLink",
      title: "Crea un link di pagamento",
      input: PaymentCreateLinkInput,
      async execute(context, input) {
        const form = new URLSearchParams({
          "line_items[0][quantity]": "1",
          "line_items[0][price_data][currency]": input.currency.toLowerCase(),
          "line_items[0][price_data][unit_amount]": String(input.amountCents),
          "line_items[0][price_data][product_data][name]": input.description,
          "metadata[reference]": input.reference,
          "payment_intent_data[metadata][reference]": input.reference,
        });
        const link = await call(context, secretKey(context), "/payment_links", {
          form,
          // A retried step must not create a second link for the same request.
          headers: { "idempotency-key": `ia-connect:link:${context.connection.id}:${input.reference}` },
        });
        const externalId = asString(link.id);
        const url = asString(link.url);
        if (!externalId || !url) {
          throw new ConnectorError(`${SERVICE}: risposta senza link di pagamento`, {
            retryable: false,
            code: "invalid_response",
          });
        }
        return { externalId, url };
      },
    }),
    /** Not a standard action: called once by the platform after the connection row (and its webhook URL) exists. */
    registerWebhook: defineAction({
      key: "registerWebhook",
      title: "Registra il webhook su Stripe",
      input: RegisterWebhookInput,
      async execute(context, input) {
        const form = new URLSearchParams({ url: input.url, "enabled_events[0]": WEBHOOK_EVENT });
        const endpoint = await call(context, secretKey(context), "/webhook_endpoints", { form });
        const webhookSecret = asString(endpoint.secret);
        if (!webhookSecret) {
          throw new ConnectorError(`${SERVICE}: risposta senza segreto del webhook`, {
            retryable: false,
            code: "invalid_response",
          });
        }
        const next = { ...context.secrets, webhookSecret, webhookEndpointId: asString(endpoint.id) };
        await context.saveSecrets(next);
        Object.assign(context.secrets, next);
        return { registered: true };
      },
    }),
  },

  async disconnect(context) {
    const endpointId = asString(context.secrets.webhookEndpointId);
    if (!endpointId) return;
    try {
      await call(context, secretKey(context), `/webhook_endpoints/${encodeURIComponent(endpointId)}`, {
        method: "DELETE",
      });
    } catch {
      // Best effort: the endpoint can also be removed from the Stripe dashboard.
    }
  },
};
