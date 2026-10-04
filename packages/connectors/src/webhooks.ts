/**
 * Inbound webhook entry point, shared by the edge function and by tests.
 * Web-standard APIs only: this module and everything it imports must run on Deno.
 */
import {
  type ConnectionRecord,
  type Connector,
  type ConnectorContext,
  type ConnectorLogger,
  type NormalizedEventInput,
  NormalizedEventInputSchema,
  type WebhookRequest,
  type WebhookResult,
} from "@ia-connect/core";
import { REQUEST_URL_HEADER } from "./lib/webhook.ts";
import { webConnectors } from "./registry.ts";

export interface WebhookDeps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  findConnectionByToken(token: string): Promise<ConnectionRecord | null>;
  findConnectionsByAccount(connectorKey: string, accountId: string): Promise<ConnectionRecord[]>;
  readSecrets(connectionId: string): Promise<Record<string, unknown>>;
  saveSecrets(connectionId: string, secrets: Record<string, unknown>): Promise<void>;
  /** Inserts into ia_connect.events; duplicates (same organization + dedupe key) are ignored. */
  insertEvents(connection: ConnectionRecord, events: NormalizedEventInput[]): Promise<void>;
  /** Optional: defaults to a silent logger. Connectors never log secrets or message bodies. */
  logger?: ConnectorLogger;
  now?(): Date;
}

export const MAX_WEBHOOK_BODY_BYTES = 1_048_576;

/** Connectors that can receive webhooks, by key. */
export const webhookConnectors: Readonly<Record<string, Connector>> = Object.fromEntries(
  webConnectors.filter((connector) => connector.handleWebhook).map((connector) => [connector.key, connector]),
);

const silentLogger: ConnectorLogger = { info() {}, warn() {}, error() {} };

/** Answers carry no detail: a caller must not learn why a delivery was refused. */
function empty(status: number): Response {
  return new Response(null, { status });
}

function toResponse(response: WebhookResult["response"]): Response {
  if (!response) return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.contentType ?? "text/plain" },
  });
}

/** Reads the body up to the limit; `null` when it is larger. */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WEBHOOK_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function contextFor(
  connection: ConnectionRecord,
  secrets: Record<string, unknown>,
  deps: WebhookDeps,
): ConnectorContext {
  return {
    connection,
    secrets,
    fetch: deps.fetch,
    now: deps.now ?? (() => new Date()),
    logger: deps.logger ?? silentLogger,
    saveSecrets: (next) => deps.saveSecrets(connection.id, next),
    env: deps.env,
  };
}

function validEvents(events: NormalizedEventInput[]): NormalizedEventInput[] {
  const valid: NormalizedEventInput[] = [];
  for (const event of events) {
    const parsed = NormalizedEventInputSchema.safeParse(event);
    if (parsed.success) valid.push(parsed.data);
  }
  return valid;
}

/** Runs one connection's handler and stores what it emits. Returns the handler result. */
async function deliver(
  connector: Connector,
  connection: ConnectionRecord,
  request: WebhookRequest,
  deps: WebhookDeps,
): Promise<WebhookResult> {
  const secrets = (await deps.readSecrets(connection.id)) ?? {};
  const result = await connector.handleWebhook!(contextFor(connection, secrets, deps), request);
  if (!result.verified) return { verified: false, events: [] };
  const events = validEvents(result.events);
  if (events.length > 0) await deps.insertEvents(connection, events);
  return { ...result, events };
}

async function handleConnectionRoute(
  token: string,
  request: WebhookRequest,
  deps: WebhookDeps,
): Promise<Response> {
  const connection = await deps.findConnectionByToken(token);
  if (!connection || connection.status === "disconnected") return empty(404);
  const connector = webhookConnectors[connection.connectorKey];
  if (!connector) return empty(404);
  const result = await deliver(connector, connection, request, deps);
  if (!result.verified) return empty(401);
  return toResponse(result.response);
}

async function handleProviderRoute(
  key: string,
  request: WebhookRequest,
  deps: WebhookDeps,
): Promise<Response> {
  const connector = Object.hasOwn(webhookConnectors, key) ? webhookConnectors[key] : undefined;
  if (!connector?.receiveProviderWebhook) return empty(404);
  const received = await connector.receiveProviderWebhook(request, deps.env);
  if (!received.verified) return empty(401);

  const seen = new Set<string>();
  let failed = false;
  for (const accountId of new Set(received.accountIds)) {
    const connections = await deps.findConnectionsByAccount(connector.key, accountId);
    for (const connection of connections) {
      if (connection.connectorKey !== connector.key || connection.status !== "active") continue;
      if (seen.has(connection.id)) continue;
      seen.add(connection.id);
      try {
        await deliver(connector, connection, request, deps);
      } catch {
        // Keep serving the other customers in the batch; the provider redelivers on 500
        // and the dedupe keys drop what was already stored.
        failed = true;
        (deps.logger ?? silentLogger).error("webhook delivery failed", {
          connectorKey: connector.key,
          connectionId: connection.id,
        });
      }
    }
  }
  if (failed) return empty(500);
  return toResponse(received.response);
}

/**
 * Routes (path suffix):
 * - `/c/<webhook_token>`: one connection; its connector verifies the signature.
 * - `/p/<connector_key>`: one URL per provider; the connector verifies the request with
 *   platform secrets, then each matching active connection handles it.
 */
export async function handleInboundWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  const url = new URL(request.url);
  const match = /\/(c|p)\/([A-Za-z0-9_-]{1,128})\/?$/.exec(url.pathname);
  if (!match) return empty(404);
  const [, kind, id] = match as unknown as [string, "c" | "p", string];
  if (request.method !== "GET" && request.method !== "POST") return empty(405);

  const rawBody = await readBody(request);
  if (rawBody === null) return empty(413);

  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  // Providers that sign the URL (Twilio) signed the public one, which the runtime may
  // not see behind its proxy: rebuild it from WEBHOOK_PUBLIC_URL when configured.
  const publicBase = deps.env.WEBHOOK_PUBLIC_URL?.replace(/\/+$/, "");
  headers[REQUEST_URL_HEADER] = publicBase ? `${publicBase}/${kind}/${id}${url.search}` : request.url;

  const webhookRequest: WebhookRequest = {
    method: request.method,
    headers,
    query: Object.fromEntries(url.searchParams),
    rawBody,
  };

  try {
    return kind === "c"
      ? await handleConnectionRoute(id, webhookRequest, deps)
      : await handleProviderRoute(id, webhookRequest, deps);
  } catch {
    (deps.logger ?? silentLogger).error("webhook handling failed", { route: kind });
    return empty(500);
  }
}
