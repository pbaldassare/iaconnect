import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_COOKIE,
  DEMO_HEADER,
  demoDecision,
  isProtectedPath,
  isSupabaseAuthCookie,
  safeNextPath,
} from "../src/lib/routes";

const createServerClient = vi.hoisted(() => vi.fn());
vi.mock("@supabase/ssr", () => ({ createServerClient }));

const demo = (pathname: string, signedIn = false, hasDemoCookie = true) =>
  demoDecision({ pathname, hasDemoCookie, signedIn });

describe("demo route rules", () => {
  it("the demo cookie opens the customer area", () => {
    for (const path of [
      "/app",
      "/app/inbox",
      "/app/inbox/0e000002-0000-4000-8000-000000000002",
      "/app/impostazioni/utenti",
      "/app/flussi/x/esecuzioni/y",
    ]) {
      expect(demo(path), path).toEqual({ mode: "demo" });
    }
  });

  it("and nothing else: admin, api, account pages, look-alikes", () => {
    for (const path of [
      "/",
      "/admin",
      "/admin/aziende",
      "/api/oauth/gmail/start",
      "/api/oauth/gmail/callback",
      "/imposta-password",
      "/in-attesa",
      "/area-riservata",
      "/nessuna-azienda",
      "/application",
      "/apps",
      "/app/../admin",
      "/accedi",
    ]) {
      expect(demo(path), path).toEqual({ mode: "none" });
    }
    // …so those stay behind the sign-in like for any signed-out visitor.
    expect(isProtectedPath("/admin")).toBe(true);
    expect(isProtectedPath("/api/oauth/gmail/start")).toBe(true);
  });

  it("downloads and exports stay closed and send the visitor back to the page", () => {
    expect(demo("/app/contatti/abc/export")).toEqual({ mode: "blocked", redirectTo: "/app/contatti/abc" });
    expect(demo("/app/impostazioni/privacy/export")).toEqual({
      mode: "blocked",
      redirectTo: "/app/impostazioni/privacy",
    });
    expect(demo("/app/impostazioni/privacy/export/")).toMatchObject({ mode: "blocked" });
  });

  it("a real session always wins over the cookie", () => {
    expect(demo("/app", true)).toEqual({ mode: "none" });
    expect(demo("/app/contatti/abc/export", true)).toEqual({ mode: "none" });
  });

  it("no cookie, no demo", () => {
    expect(demo("/app", false, false)).toEqual({ mode: "none" });
  });

  it("/demo and /demo/esci are public; the demo is never a sign-in destination", () => {
    expect(isProtectedPath("/demo")).toBe(false);
    expect(isProtectedPath("/demo/esci")).toBe(false);
    expect(isProtectedPath("/demolition")).toBe(true);
    expect(safeNextPath("/app/inbox")).toBe("/app/inbox");
  });

  it("recognises Supabase session cookies", () => {
    expect(isSupabaseAuthCookie("sb-abcd-auth-token")).toBe(true);
    expect(isSupabaseAuthCookie("sb-abcd-auth-token.0")).toBe(true);
    expect(isSupabaseAuthCookie("sb-abcd-auth-token-code-verifier")).toBe(false);
    expect(isSupabaseAuthCookie(DEMO_COOKIE)).toBe(false);
    expect(isSupabaseAuthCookie("theme")).toBe(false);
  });
});

describe("middleware", () => {
  const request = (path: string, cookie = "", headers: Record<string, string> = {}, method = "GET") =>
    new NextRequest(`https://example.test${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...headers },
    });
  const forwarded = (response: Response) => response.headers.get(`x-middleware-request-${DEMO_HEADER}`);
  const location = (response: Response) => {
    const value = response.headers.get("location");
    return value ? new URL(value).pathname + new URL(value).search : null;
  };
  const userIs = (user: unknown) =>
    createServerClient.mockReturnValue({ auth: { getUser: async () => ({ data: { user } }) } });

  beforeEach(() => {
    createServerClient.mockReset();
    userIs(null);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  });

  it("demo visitor on /app: marked for the pages, noindex, and Supabase is not even created", async () => {
    const { middleware } = await import("../src/middleware");
    const response = await middleware(request("/app/inbox", "ia_demo=1"));
    expect(location(response)).toBeNull();
    expect(forwarded(response)).toBe("1");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("a server action posted by a demo visitor reaches the page (which refuses the write)", async () => {
    const { middleware } = await import("../src/middleware");
    const response = await middleware(
      request("/app/contatti", "ia_demo=1", { "next-action": "abc" }, "POST"),
    );
    expect(location(response)).toBeNull();
    expect(forwarded(response)).toBe("1");
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("demo visitor elsewhere: /admin, /api and account pages go to /accedi", async () => {
    const { middleware } = await import("../src/middleware");
    for (const path of ["/admin", "/admin/aziende", "/api/oauth/gmail/start", "/imposta-password"]) {
      const response = await middleware(request(path, "ia_demo=1"));
      expect(location(response), path).toMatch(/^\/accedi/);
      expect(forwarded(response), path).toBeNull();
    }
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("demo visitor on a download: sent back to the page with the read-only notice", async () => {
    const { middleware } = await import("../src/middleware");
    const response = await middleware(request("/app/impostazioni/privacy/export", "ia_demo=1"));
    expect(location(response)).toBe("/app/impostazioni/privacy?demo=sola-lettura");
  });

  it("a header sent by the browser counts for nothing", async () => {
    const { middleware } = await import("../src/middleware");
    const without = await middleware(request("/app", "", { [DEMO_HEADER]: "1" }));
    expect(location(without)).toBe("/accedi");
    // On a public page the forged header is removed before the page sees it.
    const publicPage = await middleware(request("/privacy", "", { [DEMO_HEADER]: "1" }));
    expect(publicPage.headers.get("x-middleware-override-headers") ?? "").not.toContain(DEMO_HEADER);
    expect(forwarded(publicPage)).toBeNull();
  });

  it("a real session wins: no demo mark, and the demo cookie is dropped", async () => {
    userIs({ id: "u1" });
    const { middleware } = await import("../src/middleware");
    const response = await middleware(request("/app", "ia_demo=1; sb-project-auth-token=xyz"));
    expect(createServerClient).toHaveBeenCalledTimes(1);
    expect(location(response)).toBeNull();
    expect(forwarded(response)).toBeNull();
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(response.headers.get("set-cookie")).toMatch(/ia_demo=;/);
  });

  it("a stale session cookie next to the demo cookie: checked once, then demo", async () => {
    const { middleware } = await import("../src/middleware");
    const response = await middleware(request("/app", "ia_demo=1; sb-project-auth-token=expired"));
    expect(createServerClient).toHaveBeenCalledTimes(1);
    expect(forwarded(response)).toBe("1");
  });

  it("without the cookie nothing changes: /app goes to /accedi", async () => {
    const { middleware } = await import("../src/middleware");
    expect(location(await middleware(request("/app")))).toBe("/accedi");
    expect(location(await middleware(request("/app/inbox")))).toBe("/accedi?next=%2Fapp%2Finbox");
    expect(location(await middleware(request("/demo")))).toBeNull();
    expect((await middleware(request("/demo"))).headers.get("x-robots-tag")).toContain("noindex");
  });
});
