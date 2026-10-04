import { createHmac } from "node:crypto";
import {
  type AnthropicLike,
  type ClaudeRequest,
  type ClaudeResponse,
  createClaudeAiService,
} from "@ia-connect/ai";
import { getConnector, listConnectors } from "@ia-connect/connectors";
import { type WebhookDeps, handleInboundWebhook } from "@ia-connect/connectors/webhooks";
import { type ConnectionRecord, type FlowDefinition, FlowDefinitionSchema } from "@ia-connect/core";
import { type TestDb, createTestDb } from "../../../supabase/test/db.ts";
import { type Sql, createPgliteSql } from "../src/db/sql.ts";
import { DEFAULT_CONFIG, type Deps, type WorkerConfig } from "../src/deps.ts";
import { createJsonLogger } from "../src/log.ts";
import { createVaultSecretStore } from "../src/secrets.ts";

/**
 * Integration harness: the REAL connector registry, the REAL Claude service and the
 * worker's REAL Vault secret store on PGlite. Only the network is fake: an injected
 * `fetch` that records requests and a scripted Anthropic client.
 */

// ── Fake network ───────────────────────────────────────────────────────

export interface NetCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
  /** Parsed JSON body, when the body is JSON. */
  json: unknown;
  /** Parsed form body, when the body is form-encoded. */
  form: Record<string, string>;
}
type NetHandler = (call: NetCall) => Response | Promise<Response>;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function fakeNetwork() {
  const calls: NetCall[] = [];
  const unmatched: string[] = [];
  const routes: { method: string; match: string | RegExp; handler: NetHandler }[] = [];
  const matches = (match: string | RegExp, url: string) =>
    typeof match === "string" ? url.startsWith(match) : match.test(url);

  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const body = typeof init?.body === "string" ? init.body : undefined;
    let json: unknown;
    let form: Record<string, string> = {};
    if (body && headers["content-type"]?.includes("json")) json = JSON.parse(body);
    if (body && headers["content-type"]?.includes("x-www-form-urlencoded")) {
      form = Object.fromEntries(new URLSearchParams(body));
    }
    const call: NetCall = { method: init?.method ?? "GET", url: String(input), headers, body, json, form };
    calls.push(call);
    // Latest registration wins, so a test can override a default answer.
    const route = [...routes]
      .reverse()
      .find((item) => item.method === call.method && matches(item.match, call.url));
    if (!route) {
      unmatched.push(`${call.method} ${call.url}`);
      return new Response("no route in the fake network", { status: 599 });
    }
    return route.handler(call);
  };

  return {
    fetch: fetchFn as typeof fetch,
    calls,
    unmatched,
    on(method: string, match: string | RegExp, handler: NetHandler | unknown) {
      routes.push({
        method,
        match,
        handler: typeof handler === "function" ? (handler as NetHandler) : () => jsonResponse(handler),
      });
    },
    to(match: string | RegExp, method?: string): NetCall[] {
      return calls.filter((call) => matches(match, call.url) && (!method || call.method === method));
    },
  };
}

// ── Scripted Claude ────────────────────────────────────────────────────

type Scripted = Partial<ClaudeResponse> & Pick<ClaudeResponse, "content">;

/** Like `scriptedClient` of packages/ai/test/helpers.ts, with a queue the test can extend. */
export function scriptedClaude() {
  const requests: ClaudeRequest[] = [];
  const queue: Scripted[] = [];
  const client: AnthropicLike = {
    messages: {
      async create(request) {
        requests.push(structuredClone(request));
        const next = queue.shift();
        if (!next) throw new Error("Scripted Claude: no response left");
        return { stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 150 }, ...next };
      },
    },
  };
  return { client, requests, queue, push: (...responses: Scripted[]) => queue.push(...responses) };
}

// ── Vault ──────────────────────────────────────────────────────────────

/** What Supabase Vault offers to the schema's SECURITY DEFINER functions (no encryption here). */
const VAULT_STUB = `
  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text not null, name text unique);
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text default null) returns uuid language sql as
    $$ insert into vault.secrets (secret, name) values (new_secret, new_name) returning id $$;
  create function vault.update_secret(secret_id uuid, new_secret text) returns void language sql as
    $$ update vault.secrets set secret = new_secret where id = secret_id $$;
`;

// ── Harness ────────────────────────────────────────────────────────────

export const ENV = {
  META_APP_ID: "1234567890",
  META_APP_SECRET: "meta-app-secret-for-tests",
  META_WEBHOOK_VERIFY_TOKEN: "verify-token-for-tests",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret-for-tests",
  WEBHOOK_PUBLIC_URL: "https://hooks.example.com/functions/v1/webhook",
};

export interface Integration {
  db: TestDb;
  sql: Sql;
  deps: Deps;
  net: ReturnType<typeof fakeNetwork>;
  claude: ReturnType<typeof scriptedClaude>;
  /** JSON log lines written by the worker and by the connectors. */
  logs: string[];
  orgId: string;
  advance(ms: number): void;
  now(): Date;
  // biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary columns
  one<T = any>(text: string, params?: unknown[]): Promise<T>;
  // biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary columns
  all<T = any>(text: string, params?: unknown[]): Promise<T[]>;
  /** Creates a connection row and stores its secrets through the worker's secret store. */
  connect(
    type: string,
    options?: {
      config?: Record<string, unknown>;
      secrets?: Record<string, unknown>;
      externalAccountId?: string;
      status?: string;
    },
  ): Promise<{ id: string; webhookToken: string }>;
  addFlow(definition: unknown, name?: string): Promise<{ flowId: string; versionId: string }>;
  addTemplate(input: {
    name: string;
    body: string;
    externalName?: string;
    language?: string;
  }): Promise<string>;
  addEvent(type: string, payload: Record<string, unknown>, connectionId?: string | null): Promise<string>;
  addJob(kind: string, payload: Record<string, unknown>, dedupeKey?: string): Promise<string>;
  /** Hands a request to the real `handleInboundWebhook`, with deps backed by this database. */
  webhook(request: Request): Promise<Response>;
  /** Every stored row (Vault excluded) and every log line, as one string: to look for leaks. */
  dump(): Promise<string>;
}

let sequence = 0;

export async function createIntegration(
  options: { config?: Partial<WorkerConfig> } = {},
): Promise<Integration> {
  const db = await createTestDb();
  await db.pg.exec(VAULT_STUB);
  const sql = createPgliteSql(db.pg);
  const net = fakeNetwork();
  const claude = scriptedClaude();
  const logs: string[] = [];
  // Real time plus an offset: rows stamped by the database (`now()`) are never in the clock's future.
  let offset = 0;
  const clockNow = () => Date.now() + offset;
  const config: WorkerConfig = { ...DEFAULT_CONFIG, env: { ...ENV }, ...options.config };
  const deps: Deps = {
    sql,
    secrets: createVaultSecretStore(sql),
    connectors: { get: getConnector, list: listConnectors },
    ai: createClaudeAiService({ apiKey: "test-key", client: claude.client }),
    now: () => new Date(clockNow()),
    logger: createJsonLogger((line) => logs.push(line)),
    fetch: net.fetch,
    config,
  };
  const all = <T>(text: string, params: unknown[] = []) => sql.query<T>(text, params);
  const one = async <T>(text: string, params: unknown[] = []) => (await sql.query<T>(text, params))[0] as T;

  const plan = await one<{ id: string }>(
    "insert into ia_connect.plans (key, name, limits) values ($1, $1, $2::jsonb) returning id",
    [
      `integration_${++sequence}`,
      JSON.stringify({
        active_flows: 10,
        messages_per_month: 100,
        scrape_runs_per_month: 100,
        ai_credits_per_month: 100,
      }),
    ],
  );
  const org = await one<{ id: string }>(
    `insert into ia_connect.organizations (reseller_id, name, plan_id)
     select id, 'Agenzia Rossi', $1 from ia_connect.resellers where slug = 'default' returning id`,
    [plan.id],
  );

  const toRecord = (row: {
    id: string;
    organization_id: string;
    connector_type: string;
    status: ConnectionRecord["status"];
    config: Record<string, unknown> | null;
  }): ConnectionRecord => ({
    id: row.id,
    organizationId: row.organization_id,
    connectorKey: row.connector_type,
    status: row.status,
    config: row.config ?? {},
  });
  const COLUMNS = "id, organization_id, connector_type, status, config";
  // Same queries as supabase/functions/webhook/index.ts, in SQL instead of supabase-js.
  const webhookDeps: WebhookDeps = {
    env: config.env,
    fetch: net.fetch,
    now: () => new Date(clockNow()),
    logger: deps.logger,
    async findConnectionByToken(token) {
      const rows = await all<Parameters<typeof toRecord>[0]>(
        `select ${COLUMNS} from ia_connect.connections where webhook_token = $1`,
        [token],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async findConnectionsByAccount(connectorKey, accountId) {
      const rows = await all<Parameters<typeof toRecord>[0]>(
        `select ${COLUMNS} from ia_connect.connections
         where connector_type = $1
           and (external_account_id = $2 or config @> jsonb_build_object('accountAliases', jsonb_build_array($2::text)))`,
        [connectorKey, accountId],
      );
      return rows.map(toRecord);
    },
    readSecrets: (connectionId) => deps.secrets.read(connectionId),
    saveSecrets: (connectionId, secrets) => deps.secrets.write(connectionId, secrets),
    async insertEvents(connection, events) {
      for (const event of events) {
        await sql.query(
          `insert into ia_connect.events (organization_id, connection_id, type, payload, contact_hint, dedupe_key, occurred_at)
           values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, coalesce($7::timestamptz, now()))
           on conflict (organization_id, dedupe_key) do nothing`,
          [
            connection.organizationId,
            connection.id,
            event.type,
            JSON.stringify(event.payload),
            event.contact ? JSON.stringify(event.contact) : null,
            event.dedupeKey,
            event.occurredAt ?? null,
          ],
        );
      }
    },
  };

  return {
    db,
    sql,
    deps,
    net,
    claude,
    logs,
    orgId: org.id,
    advance: (ms) => {
      offset += ms;
    },
    now: () => new Date(clockNow()),
    one,
    all,
    async connect(
      type,
      { config: connectionConfig = {}, secrets, externalAccountId, status = "active" } = {},
    ) {
      const row = await one<{ id: string; webhook_token: string }>(
        `insert into ia_connect.connections (organization_id, connector_type, name, config, external_account_id, status)
         values ($1, $2, $2, $3::jsonb, $4, $5) returning id, webhook_token`,
        [org.id, type, JSON.stringify(connectionConfig), externalAccountId ?? null, status],
      );
      if (secrets) await deps.secrets.write(row.id, secrets);
      return { id: row.id, webhookToken: row.webhook_token };
    },
    async addFlow(definition, name = "Flusso di prova") {
      const parsed: FlowDefinition = FlowDefinitionSchema.parse(definition);
      const flow = await one<{ id: string }>(
        "insert into ia_connect.flows (organization_id, name, status, trigger_event) values ($1, $2, 'draft', $3) returning id",
        [org.id, name, parsed.trigger.event],
      );
      const version = await one<{ id: string }>(
        `insert into ia_connect.flow_versions (organization_id, flow_id, version, definition, author_type)
         values ($1, $2, 1, $3::jsonb, 'user') returning id`,
        [org.id, flow.id, JSON.stringify(definition)],
      );
      await sql.query("update ia_connect.flows set active_version_id = $2, status = 'active' where id = $1", [
        flow.id,
        version.id,
      ]);
      return { flowId: flow.id, versionId: version.id };
    },
    async addTemplate({ name, body, externalName, language = "it" }) {
      const row = await one<{ id: string }>(
        `insert into ia_connect.message_templates (organization_id, channel, name, body, approval_status, external_name, language)
         values ($1, 'whatsapp', $2, $3, 'approved', $4, $5) returning id`,
        [org.id, name, body, externalName ?? null, language],
      );
      return row.id;
    },
    async addEvent(type, payload, connectionId = null) {
      const row = await one<{ id: string }>(
        `insert into ia_connect.events (organization_id, type, connection_id, payload, dedupe_key, occurred_at, available_at)
         values ($1, $2, $3, $4::jsonb, $5, $6::timestamptz, $6::timestamptz) returning id`,
        [
          org.id,
          type,
          connectionId,
          JSON.stringify(payload),
          `test-${++sequence}`,
          new Date(clockNow()).toISOString(),
        ],
      );
      return row.id;
    },
    async addJob(kind, payload, dedupeKey) {
      const row = await one<{ id: string }>(
        `insert into ia_connect.scheduled_jobs (organization_id, kind, payload, run_at, dedupe_key, created_by)
         values ($1, $2, $3::jsonb, $4::timestamptz, $5, null) returning id`,
        [org.id, kind, JSON.stringify(payload), new Date(clockNow()).toISOString(), dedupeKey ?? null],
      );
      return row.id;
    },
    webhook: (request) => handleInboundWebhook(request, webhookDeps),
    async dump() {
      const tables = await all<{ name: string }>(
        "select table_name as name from information_schema.tables where table_schema = 'ia_connect' and table_type = 'BASE TABLE'",
      );
      const parts: string[] = [...logs];
      for (const { name } of tables) {
        parts.push(JSON.stringify(await all(`select * from ia_connect.${name}`)));
      }
      return parts.join("\n");
    },
  };
}

/** Fails when any of the secret values appears in a stored row or in a log line. */
export async function leaks(it: Integration, secrets: string[]): Promise<string[]> {
  const dump = await it.dump();
  return secrets.filter((secret) => dump.includes(secret));
}

// ── Provider signatures ────────────────────────────────────────────────

const WEBHOOK_BASE = ENV.WEBHOOK_PUBLIC_URL;

/** A Meta delivery as Meta sends it: JSON body signed with the app secret. */
export function metaWebhook(connectorKey: string, body: unknown, secret = ENV.META_APP_SECRET): Request {
  const raw = JSON.stringify(body);
  return new Request(`${WEBHOOK_BASE}/p/${connectorKey}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
    },
    body: raw,
  });
}

/** A Twilio delivery: form body, HMAC-SHA1 of the public URL followed by the sorted parameters. */
export function twilioWebhook(
  webhookToken: string,
  authToken: string,
  params: Record<string, string>,
): Request {
  const url = `${WEBHOOK_BASE}/c/${webhookToken}`;
  const data = Object.keys(params)
    .sort()
    .reduce((out, key) => out + key + params[key], url);
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": createHmac("sha1", authToken).update(data).digest("base64"),
    },
    body: new URLSearchParams(params).toString(),
  });
}

/** Decodes the `raw` field of a Gmail `messages.send` request. */
export function decodeRawMail(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

export const text = (value: unknown): Pick<ClaudeResponse, "content"> => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
});

export const toolUse = (name: string, input: unknown, id = `call_${name}`): Scripted => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
});
