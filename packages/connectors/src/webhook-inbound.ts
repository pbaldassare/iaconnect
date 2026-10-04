import {
  type Connector,
  ContactHintSchema,
  CrmReadInput,
  CrmWriteInput,
  NormalizedEventInputSchema,
  OPEN_EVENT_TYPES,
  isOpenEventType,
} from "@ia-connect/core";
import { z } from "zod";
import { unsupportedAction } from "./lib/actions.ts";
import { randomHex, sha256Hex } from "./lib/crypto.ts";
import { parseInput } from "./lib/http.ts";
import { asString } from "./lib/values.ts";
import {
  IA_SIGNATURE_HEADER,
  UNVERIFIED,
  header,
  jsonResponse,
  parseJson,
  verifySha256Signature,
} from "./lib/webhook.ts";

const SERVICE = "Webhook in ingresso";

export const WebhookInboundInput = z.object({
  signingSecret: z
    .string()
    .min(24)
    .optional()
    .describe("Segreto di firma (lascia vuoto per generarlo automaticamente)"),
});

/** Body the customer's site or management system posts. */
export const InboundWebhookBody = z.object({
  // Only the open types: whoever holds the signing secret must not be able to emit an inbound
  // WhatsApp message or a completed payment, which the platform trusts as coming from a provider.
  type: z
    .string()
    .refine(isOpenEventType, "Tipo di evento non ammesso")
    .describe("Tipo di evento (es. quote.requested, order.created, custom.nome)"),
  dedupeKey: z.string().min(1).max(400).optional().describe("Chiave unica dell'evento, per evitare doppioni"),
  occurredAt: z.string().datetime({ offset: true }).optional().describe("Quando è avvenuto l'evento"),
  payload: z.record(z.string(), z.unknown()).describe("Dati dell'evento"),
  contact: ContactHintSchema.optional().describe("Contatto collegato all'evento"),
});

export const webhookInboundConnector: Connector = {
  key: "webhook_inbound",
  category: "crm",
  name: "Webhook in ingresso",
  description: "Riceve eventi dal tuo sito o gestionale.",
  connectMode: "webhook",
  inputSchema: WebhookInboundInput,
  // The body declares the type: one of the open types, or `custom.*`.
  emits: [...OPEN_EVENT_TYPES],

  async connect(input) {
    const { signingSecret } = parseInput(WebhookInboundInput, input);
    // The caller of `connect` shows the secret to the customer once; afterwards it only lives in the Vault.
    return {
      config: { signatureHeader: IA_SIGNATURE_HEADER },
      secrets: { signingSecret: signingSecret ?? randomHex(32) },
    };
  },

  async verify(context) {
    return asString(context.secrets.signingSecret)
      ? { status: "active", message: "Pronto a ricevere eventi." }
      : { status: "error", message: "Segreto di firma mancante: ricrea il collegamento." };
  },

  async handleWebhook(context, request) {
    if (request.method.toUpperCase() !== "POST") return UNVERIFIED;
    const secret = asString(context.secrets.signingSecret);
    if (!(await verifySha256Signature(secret, request.rawBody, header(request, IA_SIGNATURE_HEADER)))) {
      return UNVERIFIED;
    }
    const body = InboundWebhookBody.safeParse(parseJson(request.rawBody));
    const event = body.success
      ? NormalizedEventInputSchema.safeParse({
          type: body.data.type,
          occurredAt: body.data.occurredAt,
          // No key from the sender: the same body always hashes to the same key.
          dedupeKey: `webhook_inbound:${body.data.dedupeKey ?? (await sha256Hex(request.rawBody))}`,
          payload: body.data.payload,
          contact: body.data.contact,
        })
      : undefined;
    if (!event?.success) {
      return { verified: true, events: [], response: jsonResponse(400, { error: "invalid_event" }) };
    }
    return { verified: true, events: [event.data] };
  },

  actions: {
    read: unsupportedAction("read", "Lettura (non disponibile)", CrmReadInput, SERVICE),
    write: unsupportedAction("write", "Scrittura (non disponibile)", CrmWriteInput, SERVICE),
  },

  async disconnect() {
    // Nothing on the sender's side: once the secret is removed every delivery is rejected.
  },
};
