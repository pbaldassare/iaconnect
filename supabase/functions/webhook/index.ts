import { createClient } from "jsr:@supabase/supabase-js@2";
/**
 * Inbound webhooks (Deno edge function). Thin wrapper: all the logic lives in
 * packages/connectors/src/webhooks.ts, which is tested under Node.
 *
 * Routes: /functions/v1/webhook/c/<webhook_token> and /functions/v1/webhook/p/<connector_key>.
 * NOTE: never executed locally (Deno is not installed on the development machine).
 */
import type { ConnectionRecord, NormalizedEventInput } from "@ia-connect/core";
import { type WebhookDeps, handleInboundWebhook } from "../../../packages/connectors/src/webhooks.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  {
    db: { schema: "ia_connect" },
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

const CONNECTION_COLUMNS = "id, organization_id, connector_type, status, config";

interface ConnectionRow {
  id: string;
  organization_id: string;
  connector_type: string;
  status: ConnectionRecord["status"];
  config: Record<string, unknown> | null;
}

function toRecord(row: ConnectionRow): ConnectionRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    connectorKey: row.connector_type,
    status: row.status,
    config: row.config ?? {},
  };
}

function fail(what: string): never {
  // Database error messages can quote values: only say which step failed.
  throw new Error(`webhook: ${what} failed`);
}

const deps: WebhookDeps = {
  env: Deno.env.toObject(),
  fetch,
  logger: {
    info: (message, data) => console.log(message, data ?? {}),
    warn: (message, data) => console.warn(message, data ?? {}),
    error: (message, data) => console.error(message, data ?? {}),
  },

  async findConnectionByToken(token) {
    const { data, error } = await supabase
      .from("connections")
      .select(CONNECTION_COLUMNS)
      .eq("webhook_token", token)
      .maybeSingle();
    if (error) fail("connection lookup");
    return data ? toRecord(data as ConnectionRow) : null;
  },

  async findConnectionsByAccount(connectorKey, accountId) {
    // Main match: connections.external_account_id. Second match: config.accountAliases,
    // used when one connection answers for several provider ids (Instagram account of a page).
    const [direct, aliased] = await Promise.all([
      supabase
        .from("connections")
        .select(CONNECTION_COLUMNS)
        .eq("connector_type", connectorKey)
        .eq("external_account_id", accountId),
      supabase
        .from("connections")
        .select(CONNECTION_COLUMNS)
        .eq("connector_type", connectorKey)
        .contains("config", { accountAliases: [accountId] }),
    ]);
    if (direct.error || aliased.error) fail("account lookup");
    const rows = new Map<string, ConnectionRow>();
    for (const row of [...(direct.data ?? []), ...(aliased.data ?? [])] as ConnectionRow[])
      rows.set(row.id, row);
    return [...rows.values()].map(toRecord);
  },

  async readSecrets(connectionId) {
    const { data, error } = await supabase.rpc("read_connection_secret", { p_connection: connectionId });
    if (error) fail("secret read");
    return (data as Record<string, unknown> | null) ?? {};
  },

  async saveSecrets(connectionId, secrets) {
    const { error } = await supabase.rpc("store_connection_secret", {
      p_connection: connectionId,
      p_secret: secrets,
    });
    if (error) fail("secret write");
  },

  async insertEvents(connection: ConnectionRecord, events: NormalizedEventInput[]) {
    const rows = events.map((event) => ({
      organization_id: connection.organizationId,
      connection_id: connection.id,
      type: event.type,
      payload: event.payload,
      contact_hint: event.contact ?? null,
      dedupe_key: event.dedupeKey,
      // Always present: rows of one bulk insert must share the same columns.
      occurred_at: event.occurredAt ?? new Date().toISOString(),
    }));
    // Redeliveries hit the unique (organization_id, dedupe_key) and are skipped.
    const { error } = await supabase
      .from("events")
      .upsert(rows, { onConflict: "organization_id,dedupe_key", ignoreDuplicates: true });
    if (error) fail("event insert");
  },
};

Deno.serve((request) => handleInboundWebhook(request, deps));
