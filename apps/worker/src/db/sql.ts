import type { Pool, PoolClient } from "pg";

/**
 * The only database surface the worker uses. Implemented by a `pg` pool in
 * production and by PGlite in tests. Always schema-qualify tables (`ia_connect.`).
 */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs `fn` in one transaction. Nested calls join the outer transaction. */
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}

/** JSON values go in as text and are cast in SQL (`$1::jsonb`): same behaviour on pg and PGlite. */
export function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function iso(date: Date): string {
  return date.toISOString();
}

function clientSql(client: PoolClient): Sql {
  const sql: Sql = {
    async query<T>(text: string, params: unknown[] = []) {
      return (await client.query(text, params)).rows as T[];
    },
    transaction: (fn) => fn(sql),
  };
  return sql;
}

export function createPgSql(pool: Pool): Sql {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pool.query(text, params)).rows as T[];
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(clientSql(client));
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

/** The slice of PGlite we need; avoids importing PGlite outside tests. */
interface PgliteLike {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction?<T>(fn: (tx: PgliteLike) => Promise<T>): Promise<T>;
}

export function createPgliteSql(pg: PgliteLike): Sql {
  const wrap = (target: PgliteLike, nested: boolean): Sql => {
    const sql: Sql = {
      async query<T>(text: string, params: unknown[] = []) {
        return (await target.query<T>(text, params)).rows;
      },
      transaction(fn) {
        if (nested || !target.transaction) return fn(sql);
        return target.transaction((tx) => fn(wrap(tx, true)));
      },
    };
    return sql;
  };
  return wrap(pg, false);
}
