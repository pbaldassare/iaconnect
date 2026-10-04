/**
 * PLACEHOLDER adapter: the e-signature provider is not chosen yet
 * (docs/decisioni/2026-10-04-10-pagamenti-e-firma.md). It hands back the document URL
 * as the "signing link" and accepts a signed webhook saying the document was signed.
 * It has no legal value as an electronic signature.
 */
import { type Connector, SignatureCreateInput } from "@ia-connect/core";
import { z } from "zod";
import { defineAction } from "./lib/actions.ts";
import { randomHex } from "./lib/crypto.ts";
import { parseInput } from "./lib/http.ts";
import { asString, compact } from "./lib/values.ts";
import {
  IA_SIGNATURE_HEADER,
  UNVERIFIED,
  header,
  jsonResponse,
  parseJson,
  verifySha256Signature,
} from "./lib/webhook.ts";

export const SignatureLinkInput = z.object({
  signingSecret: z
    .string()
    .min(24)
    .optional()
    .describe("Segreto per firmare le conferme (lascia vuoto per generarlo automaticamente)"),
});

export const SignatureWebhookBody = z.object({
  externalId: z.string().min(1).max(200),
  status: z.literal("signed"),
  documentUrl: z.string().optional(),
});

export const signatureLinkConnector: Connector = {
  key: "signature_link",
  category: "signature",
  name: "Firma tramite link",
  description: "Invia un documento da firmare tramite link.",
  connectMode: "api_key",
  inputSchema: SignatureLinkInput,
  emits: ["signature.completed"],

  async connect(input) {
    const { signingSecret } = parseInput(SignatureLinkInput, input);
    return { config: { placeholder: true }, secrets: { signingSecret: signingSecret ?? randomHex(32) } };
  },

  async verify(context) {
    return asString(context.secrets.signingSecret)
      ? { status: "active", message: "Collegamento attivo (firma tramite link, senza fornitore di firma)." }
      : { status: "error", message: "Segreto mancante: ricrea il collegamento." };
  },

  async handleWebhook(context, request) {
    if (request.method.toUpperCase() !== "POST") return UNVERIFIED;
    const secret = asString(context.secrets.signingSecret);
    if (!(await verifySha256Signature(secret, request.rawBody, header(request, IA_SIGNATURE_HEADER)))) {
      return UNVERIFIED;
    }
    const body = SignatureWebhookBody.safeParse(parseJson(request.rawBody));
    if (!body.success) {
      return { verified: true, events: [], response: jsonResponse(400, { error: "invalid_event" }) };
    }
    return {
      verified: true,
      events: [
        {
          type: "signature.completed",
          dedupeKey: `signature_link:${body.data.externalId}:signed`,
          payload: compact({ signatureRequestId: body.data.externalId, documentUrl: body.data.documentUrl }),
        },
      ],
    };
  },

  actions: {
    createRequest: defineAction({
      key: "createRequest",
      title: "Crea una richiesta di firma (link al documento)",
      input: SignatureCreateInput,
      async execute(_context, input) {
        return { externalId: `sig_${crypto.randomUUID()}`, url: input.documentUrl };
      },
    }),
  },

  async disconnect() {
    // No provider to notify.
  },
};
