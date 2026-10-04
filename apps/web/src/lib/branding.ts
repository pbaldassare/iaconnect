import "server-only";
import { type Brand, EMPTY_BRAND, mergeBrand, parseBrand } from "@/lib/brand";
import { createServiceClient, hasServiceKey } from "@/lib/supabase/service";
import type { Db } from "@/lib/supabase/types";
import type { Row } from "@ia-connect/core";

/**
 * Brand shown in the shell: the organization's own (`org_settings.brand`),
 * completed by its reseller's (`resellers.brand`).
 * Customers cannot read `resellers` through RLS, so the reseller brand is read
 * with the service client when the key is available (the organization has
 * already been validated by requireOrg); without the key it is simply skipped.
 */
export async function getBranding(supabase: Db, organization: Row<"organizations">): Promise<Brand> {
  const [{ data: settings }, { data: visibleReseller }] = await Promise.all([
    supabase.from("org_settings").select("brand").eq("organization_id", organization.id).maybeSingle(),
    supabase.from("resellers").select("brand").eq("id", organization.reseller_id).maybeSingle(),
  ]);
  let resellerBrand = visibleReseller ? parseBrand(visibleReseller.brand) : EMPTY_BRAND;
  if (!visibleReseller && hasServiceKey()) {
    const { data } = await createServiceClient()
      .from("resellers")
      .select("brand")
      .eq("id", organization.reseller_id)
      .maybeSingle();
    if (data) resellerBrand = parseBrand(data.brand);
  }
  return mergeBrand(parseBrand(settings?.brand), resellerBrand);
}
