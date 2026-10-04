"use server";
import { isDemoReadOnly } from "@/lib/demo/client";
import { requireOrg } from "@/lib/session";
import { revalidatePath } from "next/cache";

/** Marks every unread notification of the current organization as read. */
export async function markNotificationsRead(): Promise<void> {
  const { supabase, org } = await requireOrg();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("organization_id", org.organization.id)
    .is("read_at", null);
  // In the public demo the write is refused by design: nothing to log.
  if (error && !isDemoReadOnly(error))
    console.error("[inizio] markNotificationsRead", error.code, error.message);
  revalidatePath("/app", "layout");
}
