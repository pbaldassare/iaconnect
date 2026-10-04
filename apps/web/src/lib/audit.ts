import "server-only";
import type { Db } from "@/lib/supabase/types";
import type { Json } from "@ia-connect/core";

/**
 * Explicit audit entries for actions the database triggers do not see.
 *
 * Most changes are logged automatically: the `audit` triggers (migration
 * 20261004000200_security.sql) cover organizations, memberships, invitations,
 * org_settings, org_features, connections, flows, flow_versions,
 * message_templates, deal_stages, deals, contacts, scrape_recipes, approvals,
 * support_sessions and outbound messages typed by a person. Do NOT call this
 * for plain inserts/updates/deletes on those tables: you would log twice.
 *
 * Call it for actions that change nothing in those tables but still matter:
 * a data export, a sent invitation mail, a job requested for the worker.
 * Name the action `<area>.<verb>` in English (e.g. "organization.export") and
 * add its Italian description to lib/audit-labels.ts.
 *
 * RLS (policy audit_insert) requires actor_id = the signed-in user and an
 * organization the user can access, so `supabase` must be the session client.
 * A failed audit write is logged on the server and never blocks the action.
 */
export async function writeAudit(
  supabase: Db,
  entry: {
    organizationId: string;
    actorId: string;
    /** "admin" for platform/reseller staff, "user" for the organization's own users. */
    actorType: "user" | "admin";
    action: string;
    entityType?: string;
    entityId?: string;
    data?: Record<string, Json>;
    /** True when staff acts inside a customer's organization. */
    isSupportAccess?: boolean;
  },
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    organization_id: entry.organizationId,
    actor_type: entry.actorType,
    actor_id: entry.actorId,
    action: entry.action,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    data: entry.data ?? {},
    is_support_access: entry.isSupportAccess ?? false,
  });
  if (error) console.error("[audit] write failed", entry.action, error.code, error.message);
}
