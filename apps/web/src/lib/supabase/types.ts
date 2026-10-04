import type { Database } from "@ia-connect/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Typed Supabase client bound to the `ia_connect` schema. */
export type Db = SupabaseClient<Database, "ia_connect">;
