import "server-only";
import { DB_SCHEMA, publicEnv } from "@/lib/env";
import type { Database } from "@ia-connect/core";
import { createClient } from "@supabase/supabase-js";
import type { Db } from "./types";

/** Thrown when an operation needs the service key and the server does not have it. */
export class MissingServiceKeyError extends Error {
  constructor() {
    super(
      "Questa operazione richiede la chiave di servizio Supabase, che su questo server non è configurata. Imposta SUPABASE_SERVICE_ROLE_KEY nell'ambiente del server (mai nel browser) e riprova.",
    );
    this.name = "MissingServiceKeyError";
  }
}

export function hasServiceKey(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Service-role client: bypasses RLS. Server only, and only after the caller's
 * permission has been checked with the session client (requirePlatformAdmin,
 * requireStaffForOrg…). Never pass its results to the browser unfiltered.
 * Throws MissingServiceKeyError when SUPABASE_SERVICE_ROLE_KEY is not set.
 */
export function createServiceClient(): Db {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new MissingServiceKeyError();
  return createClient<Database, typeof DB_SCHEMA>(publicEnv().supabaseUrl, key, {
    db: { schema: DB_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
