import "server-only";
import {
  ORG_COOKIE,
  type OrgMode,
  canManageFromMembership,
  isSupportSessionOpen,
  isUuid,
  selectOrganization,
} from "@/lib/org-selection";
import { SIGN_IN_PATH } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import type { Db } from "@/lib/supabase/types";
import type { Row } from "@ia-connect/core";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

/**
 * Session context for server components and server actions.
 *
 *   const { supabase, session, org } = await requireOrg();
 *   await supabase.from("contacts").select("*").eq("organization_id", org.organization.id);
 *
 * Everything here reads through the session client, so RLS decides what is
 * visible. The helpers only add redirects and convenience; they are not the
 * security boundary.
 */

export interface Session {
  user: { id: string; email: string };
  memberships: Row<"memberships">[];
  isPlatformAdmin: boolean;
  /** Resellers where the user is reseller_admin. */
  resellerIds: string[];
  /** Platform admin or reseller admin. */
  isStaff: boolean;
}

export interface CurrentOrg {
  organization: Row<"organizations">;
  /** "support" while platform/reseller staff works inside a customer's organization. */
  mode: OrgMode;
  /** The user's membership in this organization; null in support mode. */
  membership: Row<"memberships"> | null;
  /** May change connections, flows, settings and users (owner, `permissions.manage`, or staff). */
  canManage: boolean;
  supportSession: Row<"support_sessions"> | null;
}

export interface OrgContext {
  supabase: Db;
  session: Session;
  org: CurrentOrg;
  /** Organizations the user is a member of (for the switcher), sorted by name. */
  organizations: Row<"organizations">[];
}

const UNAVAILABLE_PATH = "/non-disponibile";
const NO_ORG_PATH = "/nessuna-azienda";

/** Signed-in user with roles, or null. Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: memberships, error } = await supabase
    .from("memberships")
    .select("*")
    .eq("user_id", auth.user.id);
  if (error) {
    console.error("[session] memberships", error.code, error.message);
    redirect(UNAVAILABLE_PATH);
  }
  const rows = memberships ?? [];
  const isPlatformAdmin = rows.some((m) => m.role === "platform_admin");
  const resellerIds = rows.flatMap((m) =>
    m.role === "reseller_admin" && m.reseller_id ? [m.reseller_id] : [],
  );
  return {
    user: { id: auth.user.id, email: auth.user.email ?? "" },
    memberships: rows,
    isPlatformAdmin,
    resellerIds,
    isStaff: isPlatformAdmin || resellerIds.length > 0,
  };
});

/** Redirects to /accedi when nobody is signed in. */
export async function requireUser(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(SIGN_IN_PATH);
  return session;
}

/** Platform or reseller admin; 404 for everyone else (the admin area does not reveal itself). */
export async function requireStaff(): Promise<{ supabase: Db; session: Session }> {
  const session = await requireUser();
  if (!session.isStaff) notFound();
  return { supabase: await createClient(), session };
}

/** Platform admin only; 404 otherwise. */
export async function requirePlatformAdmin(): Promise<{ supabase: Db; session: Session }> {
  const session = await requireUser();
  if (!session.isPlatformAdmin) notFound();
  return { supabase: await createClient(), session };
}

/** True when the session is platform admin or admin of the organization's reseller. */
export function isStaffForOrg(
  session: Session,
  organization: Pick<Row<"organizations">, "reseller_id">,
): boolean {
  return session.isPlatformAdmin || session.resellerIds.includes(organization.reseller_id);
}

/**
 * Admin area: loads an organization the staff member is allowed to administer.
 * 404 when it does not exist, is not visible through RLS, or belongs to another reseller.
 */
export async function requireStaffForOrg(
  organizationId: string,
): Promise<{ supabase: Db; session: Session; organization: Row<"organizations"> }> {
  const { supabase, session } = await requireStaff();
  if (!isUuid(organizationId)) notFound();
  const { data: organization } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", organizationId)
    .maybeSingle();
  if (!organization || !isStaffForOrg(session, organization)) notFound();
  return { supabase, session, organization };
}

/** Current organization (cookie `org`, validated), or `org: null`. Cached per request. */
export const getOrgContext = cache(
  async (): Promise<{
    supabase: Db;
    session: Session;
    org: CurrentOrg | null;
    organizations: Row<"organizations">[];
  }> => {
    const session = await requireUser();
    const supabase = await createClient();
    const orgMemberships = session.memberships.filter((m) => m.organization_id !== null);
    const memberIds = orgMemberships.map((m) => m.organization_id!);

    let organizations: Row<"organizations">[] = [];
    if (memberIds.length > 0) {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .in("id", memberIds)
        .order("name");
      if (error) {
        console.error("[session] organizations", error.code, error.message);
        redirect(UNAVAILABLE_PATH);
      }
      organizations = data ?? [];
    }

    const rawCookie = (await cookies()).get(ORG_COOKIE)?.value;
    const cookieOrgId = isUuid(rawCookie) ? rawCookie : null;

    // Staff may enter an organization they are not a member of, but only
    // through an open support session they started themselves.
    let supportSession: Row<"support_sessions"> | null = null;
    if (cookieOrgId && session.isStaff && !organizations.some((o) => o.id === cookieOrgId)) {
      const { data } = await supabase
        .from("support_sessions")
        .select("*")
        .eq("organization_id", cookieOrgId)
        .eq("admin_user_id", session.user.id)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && isSupportSessionOpen(data)) supportSession = data;
    }

    const selection = selectOrganization({
      cookieOrgId,
      memberOrgIds: organizations.map((o) => o.id),
      supportOrgId: supportSession?.organization_id ?? null,
    });
    if (!selection) return { supabase, session, org: null, organizations };

    if (selection.mode === "support") {
      const { data: organization } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", selection.orgId)
        .maybeSingle();
      if (!organization || !isStaffForOrg(session, organization)) {
        return { supabase, session, org: null, organizations };
      }
      return {
        supabase,
        session,
        organizations,
        org: { organization, mode: "support", membership: null, canManage: true, supportSession },
      };
    }

    const organization = organizations.find((o) => o.id === selection.orgId)!;
    const membership = orgMemberships.find((m) => m.organization_id === organization.id) ?? null;
    return {
      supabase,
      session,
      organizations,
      org: {
        organization,
        mode: "member",
        membership,
        canManage: canManageFromMembership(membership ?? undefined),
        supportSession: null,
      },
    };
  },
);

/**
 * Customer area: the signed-in user and the current organization.
 * Redirects to /accedi when signed out, to /admin for staff without an
 * organization, and to /nessuna-azienda when there is none or it is suspended.
 */
export async function requireOrg(): Promise<OrgContext> {
  const { supabase, session, org, organizations } = await getOrgContext();
  if (!org) redirect(session.isStaff ? "/admin" : NO_ORG_PATH);
  if (org.mode === "member" && org.organization.status === "suspended") {
    redirect(`${NO_ORG_PATH}?motivo=sospesa`);
  }
  return { supabase, session, org, organizations };
}

/**
 * Who is acting in the current organization, for writeAudit() and requestJob():
 * staff in support mode is "admin", the organization's own users are "user".
 */
export function actorOf(context: Pick<OrgContext, "session" | "org">): {
  id: string;
  type: "user" | "admin";
} {
  return { id: context.session.user.id, type: context.org.mode === "support" ? "admin" : "user" };
}

/** Like requireOrg, for pages and actions that change connections, flows, settings or users. 404 otherwise. */
export async function requireOrgManager(): Promise<OrgContext> {
  const context = await requireOrg();
  if (!context.org.canManage) notFound();
  return context;
}
