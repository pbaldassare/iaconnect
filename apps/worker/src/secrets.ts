import type { Sql } from "./db/sql.ts";
import { json } from "./db/sql.ts";

/** Decrypted connection secrets. Values never reach logs or ordinary tables. */
export interface SecretStore {
  read(connectionId: string): Promise<Record<string, unknown>>;
  write(connectionId: string, secrets: Record<string, unknown>): Promise<void>;
}

/** Supabase Vault through the SECURITY DEFINER functions of the schema. */
export function createVaultSecretStore(sql: Sql): SecretStore {
  return {
    async read(connectionId) {
      const rows = await sql.query<{ secret: Record<string, unknown> | null }>(
        "select ia_connect.read_connection_secret($1::uuid) as secret",
        [connectionId],
      );
      return rows[0]?.secret ?? {};
    },
    async write(connectionId, secrets) {
      await sql.query("select ia_connect.store_connection_secret($1::uuid, $2::jsonb)", [
        connectionId,
        json(secrets),
      ]);
    },
  };
}

export function createMemorySecretStore(initial: Record<string, Record<string, unknown>> = {}): SecretStore {
  const store = new Map(Object.entries(initial));
  return {
    async read(connectionId) {
      return { ...(store.get(connectionId) ?? {}) };
    },
    async write(connectionId, secrets) {
      store.set(connectionId, { ...secrets });
    },
  };
}
