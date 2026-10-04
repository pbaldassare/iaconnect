/** Public environment (safe in the browser). Fails with a clear message when missing. */
export function publicEnv(): { supabaseUrl: string; supabaseAnonKey: string } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Configurazione mancante: imposta NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY in apps/web/.env.local.",
    );
  }
  return { supabaseUrl, supabaseAnonKey };
}

/** Database schema used by every client. */
export const DB_SCHEMA = "ia_connect" as const;
