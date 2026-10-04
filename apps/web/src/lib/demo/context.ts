import "server-only";
import type { OrgContext, Session } from "@/lib/session";
import type { Db } from "@/lib/supabase/types";
import { createDemoClient } from "./client";
import { DEMO_ORG_ID, DEMO_USER_EMAIL, DEMO_USER_ID, buildDemoData } from "./fixtures";

/**
 * What `requireOrg()` returns for a demo visitor: a made-up owner of "Agenzia Demo" and,
 * as `supabase`, the in-memory client over the fixtures. No real client exists in it, so
 * nothing a demo page does can reach the database or Supabase Auth.
 * The owner is NOT staff: `isStaff` and `isPlatformAdmin` are false, and the staff helpers
 * of lib/session.ts never see this context at all.
 */
export function demoOrgContext(now: Date = new Date()): OrgContext {
  const { tables, rpc } = buildDemoData(now);
  const organization = tables.organizations?.find((row) => row.id === DEMO_ORG_ID);
  const membership = tables.memberships?.find((row) => row.user_id === DEMO_USER_ID) ?? null;
  if (!organization || !membership) throw new Error("demo fixtures: organization or owner missing");
  const session: Session = {
    user: { id: DEMO_USER_ID, email: DEMO_USER_EMAIL },
    memberships: [membership],
    isPlatformAdmin: false,
    resellerIds: [],
    isStaff: false,
  };
  return {
    supabase: createDemoClient(tables, rpc) as unknown as Db,
    session,
    org: { organization, mode: "member", membership, canManage: true, supportSession: null },
    organizations: [organization],
    demo: true,
  };
}
