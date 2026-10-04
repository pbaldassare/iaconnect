import "server-only";
import { type CatalogGroup, buildCatalog, categoriesBlockedByFeatures } from "@/lib/connections/catalog";
import { isFeatureEnabled } from "@/lib/features";
import type { OrgContext } from "@/lib/session";
import { listConnectors } from "@ia-connect/connectors";
import type { Row } from "@ia-connect/core";

/**
 * What the current organization may connect: enabled connector types, limited
 * by the plan (`allowed_plans`) and by the feature flags. Read with the session
 * client; used by the catalog page and re-checked by every connect action.
 */
export async function loadConnectorCatalog(
  context: Pick<OrgContext, "supabase" | "org">,
): Promise<{ groups: CatalogGroup[]; types: Row<"connector_types">[]; error: unknown }> {
  const { supabase, org } = context;
  const [types, plan, features] = await Promise.all([
    supabase.from("connector_types").select("*").order("name"),
    supabase.from("plans").select("key").eq("id", org.organization.plan_id).maybeSingle(),
    supabase.from("org_features").select("feature_key, enabled").eq("organization_id", org.organization.id),
  ]);
  const error = types.error ?? plan.error ?? features.error ?? null;
  const implemented = new Set(listConnectors().map((connector) => connector.key));
  const blocked = categoriesBlockedByFeatures((key) => isFeatureEnabled(features.data ?? [], key));
  return {
    groups: buildCatalog(types.data ?? [], plan.data?.key ?? null, implemented, blocked),
    types: types.data ?? [],
    error,
  };
}

/** True when the organization may connect this connector type right now. */
export async function canConnect(
  context: Pick<OrgContext, "supabase" | "org">,
  key: string,
): Promise<boolean> {
  const { groups } = await loadConnectorCatalog(context);
  return groups.some((group) =>
    group.entries.some((entry) => entry.key === key && entry.availability === "available"),
  );
}
