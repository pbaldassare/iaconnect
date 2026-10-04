import "server-only";
import { isFeatureEnabled } from "@/lib/features";
import type { Db } from "@/lib/supabase/types";

/** Whether a feature of lib/features.ts is on for the organization (`org_features` stores only the exceptions). */
export async function featureOn(supabase: Db, organizationId: string, key: string): Promise<boolean> {
  const { data } = await supabase
    .from("org_features")
    .select("feature_key, enabled")
    .eq("organization_id", organizationId)
    .eq("feature_key", key);
  return isFeatureEnabled(data ?? [], key);
}
