import "server-only";
import {
  connectionWebhookUrl,
  defaultConnectionName,
  sanitizeConfig,
  webhookBaseUrl,
} from "@/lib/connections/catalog";
import { publicEnv } from "@/lib/env";
import type { OrgContext } from "@/lib/session";
import { createServiceClient } from "@/lib/supabase/service";
import type { Db } from "@/lib/supabase/types";
import type { ConnectResult, Connector, ConnectorContext, Json, Row } from "@ia-connect/core";

/**
 * Server side of the guided connection: runs after `connector.connect` and
 * writes the connection, its secrets (Vault, service role only) and the
 * provider-side webhook. Callers check `requireOrgManager()` first.
 *
 * Secrets pass through memory only: they are never logged, never returned to
 * the browser (except the generated ones the customer must copy, chosen by
 * `revealableSecrets`) and never written to `connections.config`.
 */

const ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_GRAPH_VERSION",
  "WAWEBAPI_BASE_URL",
  "WEBHOOK_PUBLIC_URL",
] as const;

/** Platform settings handed to connectors: only the variables they are documented to read. */
export function connectorEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) env[key] = process.env[key];
  return env;
}

/** Key that signs the OAuth state cookie: OAUTH_STATE_SECRET, or the service key when it is not set. */
export function oauthStateSecret(): string | null {
  return process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

export function webhookUrlOf(connection: Pick<Row<"connections">, "webhook_token">): string {
  const base = webhookBaseUrl({
    webhookPublicUrl: process.env.WEBHOOK_PUBLIC_URL,
    supabaseUrl: publicEnv().supabaseUrl,
  });
  return connectionWebhookUrl(base, connection.webhook_token);
}

/** True when the customer (or the platform) must point another system at this connection's own address. */
export function hasOwnWebhook(connector: Connector): boolean {
  return Boolean(connector.handleWebhook) && !connector.receiveProviderWebhook;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const quietLogger: ConnectorContext["logger"] = {
  info: () => undefined,
  warn: (message) => console.warn("[connector]", message),
  error: (message) => console.error("[connector]", message),
};

/** Reads a connection's secrets from the Vault. Service role only. */
export async function readConnectionSecrets(
  service: Db,
  connectionId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await service.rpc("read_connection_secret", { p_connection: connectionId });
  if (error) throw error;
  return asRecord(data);
}

export async function storeConnectionSecrets(
  service: Db,
  connectionId: string,
  secrets: Record<string, unknown>,
): Promise<void> {
  const { error } = await service.rpc("store_connection_secret", {
    p_connection: connectionId,
    p_secret: secrets as Json,
  });
  if (error) throw error;
}

/** Context for calling a connector's `verify`, `disconnect` or actions from the web server. */
export function connectorContext(
  service: Db,
  connection: Row<"connections">,
  secrets: Record<string, unknown>,
): ConnectorContext {
  return {
    connection: {
      id: connection.id,
      organizationId: connection.organization_id,
      connectorKey: connection.connector_type,
      status: connection.status as ConnectorContext["connection"]["status"],
      config: asRecord(connection.config),
    },
    secrets,
    fetch,
    now: () => new Date(),
    logger: quietLogger,
    saveSecrets: (next) => storeConnectionSecrets(service, connection.id, next),
    env: connectorEnv(),
  };
}

export interface SavedConnection {
  connection: Row<"connections">;
  /** Address to give to the other system, when this connector has one per connection. */
  webhookUrl: string | null;
  /** Italian notes about steps that did not complete (the connection exists anyway). */
  warnings: string[];
}

/** Calls the connector's non-standard `registerWebhook` action. Returns an Italian warning on failure. */
export async function registerWebhook(
  service: Db,
  connector: Connector,
  connection: Row<"connections">,
  secrets: Record<string, unknown>,
): Promise<string | null> {
  const action = connector.actions.registerWebhook;
  if (!action) return null;
  try {
    await action.execute(connectorContext(service, connection, secrets), { url: webhookUrlOf(connection) });
    return null;
  } catch (error) {
    console.error("[connections] registerWebhook failed", connector.key, (error as Error)?.name ?? "");
    return "Il collegamento è stato creato, ma la registrazione del webhook presso il fornitore non è riuscita: apri il collegamento e usa «Registra di nuovo il webhook».";
  }
}

/**
 * Stores the outcome of `connector.connect`: the connection row (through the
 * session client, so RLS and the audit trigger see the real user), then the
 * secrets (service role), then the webhook registration.
 * With `reconnectId` the existing connection is refreshed instead.
 */
export async function saveConnection(
  context: OrgContext,
  input: {
    connector: Connector;
    result: ConnectResult;
    name?: string;
    reconnectId?: string;
  },
): Promise<SavedConnection> {
  const { connector, result } = input;
  const service = createServiceClient();
  const orgId = context.org.organization.id;
  const config = sanitizeConfig(result.config, result.secrets) as { [key: string]: Json };
  const pending = Boolean(result.pending);
  const status = pending ? "error" : "active";
  const lastError = pending
    ? (result.pending?.message ?? "In attesa del completamento del collegamento.")
    : null;
  const warnings: string[] = [];

  let connection: Row<"connections">;
  if (input.reconnectId) {
    const { data: existing, error: readError } = await context.supabase
      .from("connections")
      .select("*")
      .eq("id", input.reconnectId)
      .eq("organization_id", orgId)
      .eq("connector_type", connector.key)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) throw new Error("connection to reconnect not found");
    // The old provider-side webhook would stay registered twice: remove it first, best effort.
    if (connector.actions.registerWebhook) {
      try {
        const oldSecrets = await readConnectionSecrets(service, existing.id);
        await connector.disconnect(connectorContext(service, existing, oldSecrets));
      } catch {
        // Nothing to clean up, or the old credentials no longer work.
      }
    }
    const { data, error } = await context.supabase
      .from("connections")
      .update({
        config,
        external_account_id: result.externalAccountId ?? existing.external_account_id,
        status,
        last_error: lastError,
        last_checked_at: new Date().toISOString(),
        ...(input.name ? { name: input.name } : {}),
      })
      .eq("id", existing.id)
      .eq("organization_id", orgId)
      .select("*")
      .single();
    if (error) throw error;
    connection = data;
    await storeConnectionSecrets(service, connection.id, result.secrets);
  } else {
    const { data, error } = await context.supabase
      .from("connections")
      .insert({
        organization_id: orgId,
        connector_type: connector.key,
        name: input.name?.trim() || defaultConnectionName(connector.name, result.externalAccountId),
        config,
        external_account_id: result.externalAccountId ?? null,
        status,
        last_error: lastError,
        last_checked_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) throw error;
    connection = data;
    try {
      await storeConnectionSecrets(service, connection.id, result.secrets);
    } catch (error) {
      // A connection without its secrets is useless: take it back.
      await context.supabase
        .from("connections")
        .delete()
        .eq("id", connection.id)
        .eq("organization_id", orgId);
      throw error;
    }
  }

  const ownWebhook = hasOwnWebhook(connector);
  const webhookUrl = ownWebhook ? webhookUrlOf(connection) : null;

  // Twilio reads the delivery-status address from the config; it only exists once the row does.
  if (webhookUrl && connector.key === "sms_twilio" && !asRecord(connection.config).statusCallbackUrl) {
    const { data } = await context.supabase
      .from("connections")
      .update({ config: { ...config, statusCallbackUrl: webhookUrl } })
      .eq("id", connection.id)
      .eq("organization_id", orgId)
      .select("*")
      .single();
    if (data) connection = data;
  }

  // Stripe: a webhook secret typed by the customer means the endpoint was created by hand.
  const alreadyRegistered = connector.key === "payment_stripe" && Boolean(result.secrets.webhookSecret);
  if (connector.actions.registerWebhook && !alreadyRegistered) {
    const warning = await registerWebhook(service, connector, connection, { ...result.secrets });
    if (warning) warnings.push(warning);
  }

  return { connection, webhookUrl, warnings };
}
