import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In demo mode the session helpers must hand out the in-memory client and must never
 * create a real Supabase client. The Next request APIs and the two Supabase packages are
 * replaced here, so the test can see exactly what the helpers touch.
 */
const state = vi.hoisted(() => ({ demo: true }));
const createServerClient = vi.hoisted(() => vi.fn());
const createSupabaseClient = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.demo ? { "x-ia-demo": "1" } : {}),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));
vi.mock("@supabase/ssr", () => ({ createServerClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: createSupabaseClient }));

import { DEMO_READ_ONLY, isDemoClient } from "../src/lib/demo/client";
import { DEMO_ORG_ID, DEMO_USER_ID } from "../src/lib/demo/fixtures";

beforeEach(() => {
  state.demo = true;
  createServerClient.mockReset();
  createSupabaseClient.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
});

describe("session helpers in demo mode", () => {
  it("requireOrg and requireOrgManager return the demo context without creating a real client", async () => {
    const { requireOrg, requireOrgManager } = await import("../src/lib/session");
    for (const helper of [requireOrg, requireOrgManager]) {
      const context = await helper();
      expect(context.demo).toBe(true);
      expect(isDemoClient(context.supabase)).toBe(true);
      expect(context.org.organization).toMatchObject({
        id: DEMO_ORG_ID,
        name: "Agenzia Demo",
        sector: "insurance",
      });
      expect(context.org.canManage).toBe(true);
      expect(context.org.membership?.role).toBe("org_owner");
      expect(context.session.user.id).toBe(DEMO_USER_ID);
      expect(context.session.isStaff).toBe(false);
      expect(context.session.isPlatformAdmin).toBe(false);
    }
    expect(createServerClient).not.toHaveBeenCalled();
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });

  it("the demo context reads fixtures and refuses writes", async () => {
    const { requireOrg } = await import("../src/lib/session");
    const { supabase, org } = await requireOrg();
    const plan = await supabase.from("plans").select("key, name").eq("id", org.organization.plan_id).single();
    expect(plan.data).toEqual({ key: "pro", name: "Pro" });
    const contacts = await supabase.from("contacts").select("id", { count: "exact", head: true });
    expect(contacts.count).toBe(14);
    const write = await supabase
      .from("contacts")
      .update({ full_name: "x" })
      .eq("organization_id", DEMO_ORG_ID);
    expect(write.error?.code).toBe(DEMO_READ_ONLY);
    const log = await supabase.rpc("log_action", { p_org: DEMO_ORG_ID, p_action: "contact.export" });
    expect(log.error?.code).toBe(DEMO_READ_ONLY);
  });

  it("the demo cookie never satisfies the user, staff and admin helpers", async () => {
    const session = await import("../src/lib/session");
    expect(await session.getSession()).toBeNull();
    await expect(session.requireUser()).rejects.toThrow("REDIRECT /accedi");
    await expect(session.requireStaff()).rejects.toThrow("REDIRECT /accedi");
    await expect(session.requirePlatformAdmin()).rejects.toThrow("REDIRECT /accedi");
    await expect(session.requireStaffForOrg(DEMO_ORG_ID)).rejects.toThrow("REDIRECT /accedi");
    expect(createServerClient).not.toHaveBeenCalled();
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });

  it("the real client factory refuses to run, and so do the helpers that need the service client", async () => {
    const { createClient } = await import("../src/lib/supabase/server");
    await expect(createClient()).rejects.toMatchObject({ code: DEMO_READ_ONLY });
    const users = await import("../src/lib/users");
    await expect(users.findUserIdByEmail("a@b.example")).rejects.toMatchObject({ code: DEMO_READ_ONLY });
    const emails = await users.resolveUserEmails([DEMO_USER_ID, "unknown"]);
    expect([...emails.keys()]).toEqual([DEMO_USER_ID]);
    const { getBranding } = await import("../src/lib/branding");
    const { requireOrg } = await import("../src/lib/session");
    const { supabase, org } = await requireOrg();
    expect((await getBranding(supabase, org.organization)).name).toBe("Agenzia Demo");
    expect(createServerClient).not.toHaveBeenCalled();
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });

  it("outside the demo the real client is created as before", async () => {
    state.demo = false;
    createServerClient.mockReturnValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
    const { getSession } = await import("../src/lib/session");
    expect(await getSession()).toBeNull();
    expect(createServerClient).toHaveBeenCalledTimes(1);
  });
});
