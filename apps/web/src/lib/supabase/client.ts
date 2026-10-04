"use client";
import { DB_SCHEMA } from "@/lib/env";
import { createBrowserClient } from "@supabase/ssr";
import type { Db } from "./types";

let browserClient: Db | undefined;

/** Supabase client for client components (user session, RLS applies). */
export function createClient(): Db {
  if (!browserClient) {
    // Literal `process.env.NEXT_PUBLIC_*` access so Next can inline the values.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Configurazione Supabase mancante.");
    browserClient = createBrowserClient(url, key, { db: { schema: DB_SCHEMA } }) as unknown as Db;
  }
  return browserClient;
}
