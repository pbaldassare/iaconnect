import "server-only";
import {
  CONNECTOR_ENV_KEYS,
  connectionWebhookUrl,
  defaultConnectionName,
  mergeReconnectConfig,
  sanitizeConfig,
  webhookBaseUrl,
} from "@/lib/connections/catalog";
import { oauthStateSecretFrom } from "@/lib/connections/oauth-state";
import { publicEnv } from "@/lib/env";
import type { OrgContext } from "@/lib/session";
import { createServiceClient } from "@/lib/supabase/service";
import type { Db } from "@/lib/supabase/types";
import { nodeHostResolver } from "@ia-connect/connectors";
import type { ConnectResult, Connector, ConnectorContext, Json, Row } from "@ia-connect/core";

/**
 * Server side of the guided connection: runs after `connector.connect` and
 * writes the connection, its secrets (Vault, service role only) and the
 * provider-side webhook. Callers check `requireOrgManager()` first.
 *
 * Customers cannot write `connections` themselves (migration
 * 20261004001000_security_hardening.sql): the account id, the configuration and the webhook
 * token decide who receives an inbound webhook. Every write goes through `writeConnection`
 * → `ia_connect.save_connection`, with the service role, on behalf of the signed-in manager:
 * the function checks again that the user manages the organization and the audit trail
 * records that user, not "automation".
 *
 * Secrets pass through memory only: they are never logged, never returned to
 * the browser (except the generated ones the customer must copy, chosen by
 * `revealableSecrets`) and never written to `connections.config`.
 */

/** Platform settings handed to connectors: only the variables they are documented to read. */
export function connectorEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const key of CONNECTOR_ENV_KEYS) env[key] = process.env[key];
  return env;
}

/** Key that signs the OAuth state cookie: OAUTH_STATE_SECRET only (no fallback). Null when not set. */
export function oauthStateSecret(): string | null {
  return oauthStateSecretFrom(process.env);
}

/** What `connector.connect` needs from the web server, DNS lookup for the address checks included. */
export function connectDeps() {
  return { fetch, env: connectorEnv(), resolveHost: nodeHostResolver };
}

/** Columns the server may set on a connection. */
export interface ConnectionValues {
  connector_type?: string;
  name?: string;
  config?: { [key: string]: Json };
  external_account_id?: string | null;
  status?: string;
  last_error?: string | null;
  last_checked_at?: string | null;
}

/** The account is already connected: the unique index on (connector_type, external_account_id). */
export class AccountAlreadyConnectedError extends Error {
  constructor(sameOrganization: boolean) {
    super(
      sameOrganization
        ? "Questo account è già collegato in questa azienda: apri il collegamento esistente e usa «Ricollega»."
        : "Questo account è già collegato a un'altra azienda. Va scollegato lì prima di poterlo collegare qui.",
    );
    this.name = "AccountAlreadyConnectedError";
  }
}

function isAccountConflict(error: unknown): boolean {
  const e = (error ?? {}) as { code?: string; message?: string };
  return e.code === "23505" && /connections_external_account_unique/.test(e.message ?? "");
}

/**
 * Creates (`connectionId` null) or updates a connection on behalf of the signed-in manager.
 * Call only after `requireOrgManager()` / `requireStaffForOrg()`; the database function
 * checks the same right again for `actorId`.
 */
export async function writeConnection(
  service: Db,
  input: { actorId: string; organizationId: string; connectionId: string | null; values: ConnectionValues },
): Promise<Row<"connections">> {
  const { data, error } = await service.rpc("save_connection", {
    p_actor: input.actorId,
    p_organization: input.organizationId,
    p_connection: input.connectionId,
    p_values: input.values as Json,
  });
  if (error) throw error;
  return data as Row<"connections">;
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
    resolveHost: nodeHostResolver,
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
 * Stores the outcome of `connector.connect`: the connection row (service role, on behalf of
 * the signed-in manager: see `writeConnection`), then the secrets, then the webhook
 * registration. With `reconnectId` the existing connection is refreshed instead.
 * Throws `AccountAlreadyConnectedError` when the provider account is already connected.
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
  const actorId = context.session.user.id;
  const config = sanitizeConfig(result.config, result.secrets) as { [key: string]: Json };
  const pending = Boolean(result.pending);
  const status = pending ? "error" : "active";
  const lastError = pending
    ? (result.pending?.message ?? "In attesa del completamento del collegamento.")
    : null;
  const warnings: string[] = [];
  const write = async (connectionId: string | null, values: ConnectionValues) => {
    try {
      return await writeConnection(service, { actorId, organizationId: orgId, connectionId, values });
    } catch (error) {
      if (!isAccountConflict(error)) throw error;
      // Which message: is the other connection one the caller can see?
      const { data: own } = await context.supabase
        .from("connections")
        .select("id")
        .eq("organization_id", orgId)
        .eq("connector_type", connector.key)
        .eq("external_account_id", values.external_account_id ?? result.externalAccountId ?? "")
        .neq("status", "disconnected")
        .limit(1);
      throw new AccountAlreadyConnectedError(Boolean(own?.length));
    }
  };

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
    // `connect` knows nothing about what the worker keeps in the config (the polling cursor…):
    // replacing the whole column would make the next poll start from scratch.
    const sameAccount =
      !result.externalAccountId || result.externalAccountId === existing.external_account_id;
    const merged = mergeReconnectConfig(existing.config, config, { sameAccount }) as { [key: string]: Json };
    connection = await write(existing.id, {
      config: merged,
      external_account_id: result.externalAccountId ?? existing.external_account_id,
      status,
      last_error: lastError,
      last_checked_at: new Date().toISOString(),
      ...(input.name ? { name: input.name } : {}),
    });
    await storeConnectionSecrets(service, connection.id, result.secrets);
  } else {
    connection = await write(null, {
      connector_type: connector.key,
      name: input.name?.trim() || defaultConnectionName(connector.name, result.externalAccountId),
      config,
      external_account_id: result.externalAccountId ?? null,
      status,
      last_error: lastError,
      last_checked_at: new Date().toISOString(),
    });
    try {
      await storeConnectionSecrets(service, connection.id, result.secrets);
    } catch (error) {
      // A connection without its secrets is useless (and receives no provider webhook): take it back.
      await service.rpc("remove_connection", {
        p_actor: actorId,
        p_organization: orgId,
        p_connection: connection.id,
      });
      throw error;
    }
  }

  const ownWebhook = hasOwnWebhook(connector);
  const webhookUrl = ownWebhook ? webhookUrlOf(connection) : null;

  // Twilio reads the delivery-status address from the config; it only exists once the row does.
  if (webhookUrl && connector.key === "sms_twilio" && !asRecord(connection.config).statusCallbackUrl) {
    // From the stored row, not from `config`: on a reconnect the row also holds the worker's entries.
    connection = await write(connection.id, {
      config: {
        ...(asRecord(connection.config) as { [key: string]: Json }),
        statusCallbackUrl: webhookUrl,
      },
    });
  }

  // Stripe: a webhook secret typed by the customer means the endpoint was created by hand.
  const alreadyRegistered = connector.key === "payment_stripe" && Boolean(result.secrets.webhookSecret);
  if (connector.actions.registerWebhook && !alreadyRegistered) {
    const warning = await registerWebhook(service, connector, connection, { ...result.secrets });
    if (warning) warnings.push(warning);
  }

  return { connection, webhookUrl, warnings };
}
