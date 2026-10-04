/** Which organization the user is working in. Pure functions, unit tested. */

export const ORG_COOKIE = "org";
/** A support session left open is ignored after this many hours. */
export const SUPPORT_SESSION_MAX_HOURS = 8;

export type OrgMode = "member" | "support";

export interface OrgSelection {
  orgId: string;
  mode: OrgMode;
}

/**
 * Picks the current organization.
 * - The cookie wins when it names an organization the user is a member of.
 * - Otherwise, the cookie is accepted for staff only when an open support
 *   session exists for exactly that organization (`supportOrgId`).
 * - Otherwise the first membership (callers pass them sorted by name).
 * - No memberships and no support session: null.
 */
export function selectOrganization(input: {
  cookieOrgId: string | null | undefined;
  memberOrgIds: readonly string[];
  supportOrgId: string | null | undefined;
}): OrgSelection | null {
  const { cookieOrgId, memberOrgIds, supportOrgId } = input;
  if (cookieOrgId && memberOrgIds.includes(cookieOrgId)) return { orgId: cookieOrgId, mode: "member" };
  if (cookieOrgId && supportOrgId && cookieOrgId === supportOrgId)
    return { orgId: cookieOrgId, mode: "support" };
  const first = memberOrgIds[0];
  return first ? { orgId: first, mode: "member" } : null;
}

/** True while a support session is usable: not ended and not older than the maximum. */
export function isSupportSessionOpen(
  session: { started_at: string; ended_at: string | null },
  now: Date = new Date(),
): boolean {
  if (session.ended_at !== null) return false;
  const started = new Date(session.started_at).getTime();
  if (Number.isNaN(started)) return false;
  return now.getTime() - started < SUPPORT_SESSION_MAX_HOURS * 3600 * 1000;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** What a member may do, from the membership row. Owners and members with `permissions.manage` manage. */
export function canManageFromMembership(
  membership: { role: string; permissions: unknown } | undefined,
): boolean {
  if (!membership) return false;
  if (membership.role === "org_owner") return true;
  const permissions = membership.permissions;
  return (
    typeof permissions === "object" &&
    permissions !== null &&
    (permissions as Record<string, unknown>).manage === true
  );
}
