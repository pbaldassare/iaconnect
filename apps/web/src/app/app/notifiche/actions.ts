"use server";
import { isUuid } from "@/lib/org-selection";
import { requireOrg } from "@/lib/session";
import { revalidatePath } from "next/cache";

/** Marks one notification as read (or every unread one when no id is given). */
async function markRead(notificationId: string | null): Promise<void> {
  const { supabase, org } = await requireOrg();
  let query = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("organization_id", org.organization.id)
    .is("read_at", null);
  if (notificationId) {
    if (!isUuid(notificationId)) return;
    query = query.eq("id", notificationId);
  }
  const { error } = await query;
  if (error) console.error("[notifications] markRead", error.code, error.message);
  // The unread counter lives in the customer layout.
  revalidatePath("/app", "layout");
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await markRead(notificationId);
}

export async function markAllNotificationsRead(): Promise<void> {
  await markRead(null);
}
