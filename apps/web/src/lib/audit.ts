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
 * Rows are written by the database function `ia_connect.log_action` (migration
 * 20261004001000_security_hardening.sql), not by a direct insert: the function derives the
 * actor from the session (who, customer or staff, support access, time), so nobody can log
 * as someone else, as "admin", or with a date of their choice. `supabase` must be the session
 * client. `actorId`, `actorType` and `isSupportAccess` are kept for the callers' readability
 * and are NOT sent: the database decides them.
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
  const { error } = await supabase.rpc("log_action", {
    p_org: entry.organizationId,
    p_action: entry.action,
    p_entity_type: entry.entityType ?? null,
    p_entity_id: entry.entityId ?? null,
    p_data: entry.data ?? {},
  });
  if (error) console.error("[audit] write failed", entry.action, error.code, error.message);
}
