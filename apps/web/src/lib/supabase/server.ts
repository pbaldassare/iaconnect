import "server-only";
import { assertNotDemo } from "@/lib/demo/server";
import { DB_SCHEMA, publicEnv } from "@/lib/env";
import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Db } from "./types";

/**
 * Supabase client for server components, server actions and route handlers.
 * It carries the user's session cookie, so RLS applies: it can only read and
 * write what the policies allow. This is the client to use by default.
 * Never created for a demo visitor: it throws the read-only error instead.
 */
export async function createClient(): Promise<Db> {
  await assertNotDemo();
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    db: { schema: DB_SCHEMA },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Server components cannot write cookies; the middleware refreshes the session.
        }
      },
    },
  }) as unknown as Db;
}
