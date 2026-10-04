import "server-only";
import {
  type AccessRequestStatus,
  asRequestStatus,
  destinationAfterSignIn,
  landingRoute,
} from "@/lib/landing-route";
import { registrationFromMetadata, requestAccessArgs } from "@/lib/registration";
import type { Db } from "@/lib/supabase/types";
import type { Row } from "@ia-connect/core";

/**
 * What happens after every sign-in, and how a signed-in user is routed (see
 * lib/landing-route.ts for the rules). Everything goes through the session client: RLS and
 * the database functions decide; this file only orders the calls.
 */

export interface Landing {
  /** The page this user belongs to. */
  path: string;
  userId: string;
  /** The user's access request, when they have no role yet. */
  request: Row<"access_requests"> | null;
  requestStatus: AccessRequestStatus | null;
}

/**
 * Works out where the signed-in user belongs. Null when nobody is signed in.
 * A user with a role never needs the access request, so the table is not even read for
 * them: sign-in keeps working on a database where the migration is not applied yet.
 */
export async function resolveLanding(supabase: Db): Promise<Landing | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const userId = auth.user.id;

  const memberships = await supabase
    .from("memberships")
    .select("role, organization_id, reseller_id")
    .eq("user_id", userId);
  if (memberships.error) {
    console.error("[access] memberships", memberships.error.code, memberships.error.message);
    return { path: "/non-disponibile", userId, request: null, requestStatus: null };
  }
  const rows = memberships.data ?? [];
  const isStaff = rows.some((m) => m.role === "platform_admin" || m.role === "reseller_admin");
  const hasOrganization = rows.some((m) => m.organization_id !== null);
  if (isStaff || hasOrganization) {
    return {
      path: landingRoute({ isStaff, hasOrganization, requestStatus: null }),
      userId,
      request: null,
      requestStatus: null,
    };
  }

  let request: Row<"access_requests"> | null = null;
  const existing = await supabase.from("access_requests").select("*").eq("user_id", userId).maybeSingle();
  if (existing.error) {
    console.error("[access] access_requests", existing.error.code, existing.error.message);
  } else {
    request = existing.data;
  }

  // First sign-in after the confirmation mail: the form filled at sign-up waits in the metadata.
  if (!request && !existing.error) {
    const saved = registrationFromMetadata(auth.user.user_metadata);
    if (saved) {
      const created = await supabase.rpc("request_access", requestAccessArgs(saved));
      if (created.error) {
        console.error("[access] request_access", created.error.code, created.error.message);
      } else {
        request = created.data;
      }
    }
  }

  const requestStatus = asRequestStatus(request?.status);
  return {
    path: landingRoute({ isStaff: false, hasOrganization: false, requestStatus }),
    userId,
    request,
    requestStatus,
  };
}

/**
 * Called after every sign-in (password, mail link, confirmation, invitation): pending
 * invitations become memberships, the registration data becomes an access request, and the
 * result is the page to open. `next` must already be sanitized with safeNextPath().
 * Null when there is no session.
 */
export async function completeSignIn(supabase: Db, next: string | null): Promise<string | null> {
  const landing = await enterLanding(supabase);
  if (!landing) return null;
  return destinationAfterSignIn(landing.path, next);
}

/** Accepts pending invitations, then resolveLanding(). Null when there is no session. */
export async function enterLanding(supabase: Db): Promise<Landing | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { error } = await supabase.rpc("accept_invitations");
  if (error) console.error("[access] accept_invitations", error.code, error.message);
  return resolveLanding(supabase);
}

/** Pending access requests, for the admin navigation. 0 when the table cannot be read. */
export async function pendingAccessRequestCount(supabase: Db): Promise<number> {
  const { count, error } = await supabase
    .from("access_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) {
    console.error("[access] pending count", error.code, error.message);
    return 0;
  }
  return count ?? 0;
}
