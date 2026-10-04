import { createHmac } from "node:crypto";
import type { ConnectionRecord, ConnectorContext } from "@ia-connect/core";

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

type Handler = (call: RecordedCall) => Response | Promise<Response>;

/** A fetch that never touches the network: it records calls and answers from `handler`. */
export function fakeFetch(handler: Handler): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fn as typeof fetch, calls };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const NOW = new Date("2026-10-05T08:00:00.000Z");

export interface TestContext extends ConnectorContext {
  saved: Record<string, unknown>[];
  logs: { level: string; message: string; data?: Record<string, unknown> }[];
}

export function makeContext(options: {
  connectorKey: string;
  config?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
}): TestContext {
  const connection: ConnectionRecord = {
    id: "c0000000-0000-4000-8000-000000000001",
    organizationId: "a0000000-0000-4000-8000-000000000001",
    connectorKey: options.connectorKey,
    status: "active",
    config: options.config ?? {},
  };
  const saved: Record<string, unknown>[] = [];
  const logs: TestContext["logs"] = [];
  const log = (level: string) => (message: string, data?: Record<string, unknown>) => {
    logs.push({ level, message, data });
  };
  return {
    connection,
    secrets: options.secrets ?? {},
    fetch:
      options.fetch ??
      (() => {
        throw new Error("unexpected network call");
      }),
    now: () => NOW,
    logger: { info: log("info"), warn: log("warn"), error: log("error") },
    saveSecrets: async (secrets) => {
      saved.push(secrets);
    },
    env: options.env ?? {},
    saved,
    logs,
  };
}

/** Reference HMACs computed with node:crypto, independent from the Web Crypto code under test. */
export function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function hmacSha1Base64(secret: string, data: string): string {
  return createHmac("sha1", secret).update(data).digest("base64");
}

// ── Realistic provider payloads ────────────────────────────────────────

export const PHONE_NUMBER_ID = "106540352242922";

export const whatsappInboundPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "390212345678", phone_number_id: PHONE_NUMBER_ID },
            contacts: [{ profile: { name: "Mario Rossi" }, wa_id: "393331234567" }],
            messages: [
              {
                from: "393331234567",
                id: "wamid.HBgMMzkzMzMxMjM0NTY3FQIAEhgUM0EwQjQ1",
                timestamp: "1791100800",
                type: "text",
                text: { body: "Buongiorno, vorrei un preventivo" },
              },
            ],
          },
        },
      ],
    },
  ],
};

export const whatsappStatusPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "390212345678", phone_number_id: PHONE_NUMBER_ID },
            statuses: [
              {
                id: "wamid.OUT1",
                status: "delivered",
                timestamp: "1791100860",
                recipient_id: "393331234567",
              },
              {
                id: "wamid.OUT2",
                status: "failed",
                timestamp: "1791100861",
                recipient_id: "393339999999",
                errors: [{ code: 131026, title: "Message undeliverable" }],
              },
            ],
          },
        },
      ],
    },
  ],
};

export const PAGE_ID = "112233445566778";

export const metaLeadPayload = {
  object: "page",
  entry: [
    {
      id: PAGE_ID,
      time: 1791100800,
      changes: [
        {
          field: "leadgen",
          value: {
            leadgen_id: "444555666777",
            form_id: "999888777",
            page_id: PAGE_ID,
            created_time: 1791100800,
          },
        },
      ],
    },
  ],
};
