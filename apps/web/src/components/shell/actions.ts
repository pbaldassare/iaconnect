"use server";
import { clearOrgCookie, setOrgCookie } from "@/lib/org-cookie";
import { isUuid } from "@/lib/org-selection";
import { SIGN_IN_PATH } from "@/lib/routes";
import { requireUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Db } from "@/lib/supabase/types";
import { redirect } from "next/navigation";

/** Organization switcher: accepts only organizations the user is a member of. */
export async function switchOrganization(formData: FormData): Promise<void> {
  const session = await requireUser();
  const organizationId = formData.get("org");
  if (typeof organizationId === "string" && isUuid(organizationId)) {
    const isMember = session.memberships.some((m) => m.organization_id === organizationId);
    if (isMember) {
      // Leaving a customer's organization for one of your own closes the support session.
      await closeSupportSessions(await createClient(), session.user.id);
      await setOrgCookie(organizationId);
    }
  }
  redirect("/app");
}

async function closeSupportSessions(supabase: Db, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("support_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("admin_user_id", userId)
    .is("ended_at", null)
    .select("organization_id");
  return data?.[0]?.organization_id ?? null;
}

/** "Esci dall'assistenza": closes the open support session and goes back to the admin area. */
export async function endSupportSession(): Promise<void> {
  const session = await requireUser();
  const supabase = await createClient();
  const organizationId = await closeSupportSessions(supabase, session.user.id);
  await clearOrgCookie();
  redirect(organizationId ? `/admin/aziende/${organizationId}?scheda=assistenza` : "/admin/aziende");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) await closeSupportSessions(supabase, data.user.id);
  await supabase.auth.signOut();
  await clearOrgCookie();
  redirect(SIGN_IN_PATH);
}
