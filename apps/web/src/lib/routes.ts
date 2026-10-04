/** Route rules shared by the middleware, the auth pages and the tests. Pure functions only. */

export const SIGN_IN_PATH = "/accedi";
export const DEFAULT_AFTER_SIGN_IN = "/app";

export const SIGN_UP_PATH = "/registrati";
/** "Take me where I belong": decides the page from roles and access request. */
export const LANDING_PATH = "/area-riservata";

/** Public demo of the customer area: `/demo` enters, `/demo/esci` leaves. */
export const DEMO_ENTRY_PATH = "/demo";
export const DEMO_EXIT_PATH = "/demo/esci";
/** Cookie that marks a demo visitor. It opens `/app/**` only, and only without a real session. */
export const DEMO_COOKIE = "ia_demo";
/** Request header set by the middleware (and only by it) when the request is served in demo mode. */
export const DEMO_HEADER = "x-ia-demo";
/** Query parameter added when a demo visitor is sent back from a closed address (downloads). */
export const DEMO_BLOCKED_PARAM = "demo";
export const DEMO_BLOCKED_VALUE = "sola-lettura";

const PUBLIC_PREFIXES = [
  "/accedi",
  "/auth",
  "/registrati",
  "/password-dimenticata",
  "/privacy",
  DEMO_ENTRY_PATH,
];
/** Entry points with no page of their own: not worth remembering as `next`. */
const ENTRY_PATHS = ["/", LANDING_PATH, "/benvenuto"];
/** Pages for signed-out visitors only: a signed-in user is sent onward. */
const SIGNED_OUT_ONLY = [SIGN_IN_PATH, SIGN_UP_PATH];

/** The presentation site, served at the root from `public/` (copied from `site/` at build time). */
const PRESENTATION_PATHS = ["/", "/index.html"];
const PRESENTATION_ASSETS = "/assets/";

/**
 * Everything except the presentation site and the sign-in, sign-up, password reset, privacy
 * and auth callback pages needs a session.
 */
export function isProtectedPath(pathname: string): boolean {
  if (PRESENTATION_PATHS.includes(pathname) || pathname.startsWith(PRESENTATION_ASSETS)) return false;
  return !PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Where to send a signed-out visitor, remembering the page they asked for. */
export function signInRedirect(pathname: string, search = ""): { pathname: string; search: string } {
  const wanted = `${pathname}${search}`;
  const next = safeNextPath(wanted);
  return {
    pathname: SIGN_IN_PATH,
    search:
      next === DEFAULT_AFTER_SIGN_IN || ENTRY_PATHS.includes(pathname)
        ? ""
        : `?next=${encodeURIComponent(next)}`,
  };
}

/**
 * Where a signed-in user who opens /accedi or /registrati goes instead: the landing route,
 * which keeps the `next` they came with. Null for every other page.
 */
export function signedInRedirect(pathname: string, search = ""): { pathname: string; search: string } | null {
  if (!SIGNED_OUT_ONLY.includes(pathname)) return null;
  const next = new URLSearchParams(search).get("next");
  const safe = safeNextPath(next);
  return {
    pathname: LANDING_PATH,
    search: next && safe !== DEFAULT_AFTER_SIGN_IN ? `?next=${encodeURIComponent(safe)}` : "",
  };
}

/**
 * Sanitizes a "next" parameter: only same-site absolute paths are accepted,
 * so a crafted link cannot redirect to another site after sign-in.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return DEFAULT_AFTER_SIGN_IN;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return DEFAULT_AFTER_SIGN_IN;
  if ([...value].some((char) => char.charCodeAt(0) < 0x20)) return DEFAULT_AFTER_SIGN_IN;
  if (value.startsWith("/auth/")) return DEFAULT_AFTER_SIGN_IN;
  // Never back to a page that only makes sense signed out (it would bounce forever).
  const path = value.split(/[?#]/)[0];
  if (path === SIGN_IN_PATH || path === SIGN_UP_PATH) return DEFAULT_AFTER_SIGN_IN;
  return value;
}

const CUSTOMER_AREA = "/app";

/**
 * What the demo cookie means for one request.
 *
 * - `none`: no demo. Either there is no cookie, or a real session exists (it always wins),
 *   or the address is outside the customer area: `/admin`, `/api`, the account pages and
 *   everything else follow the normal rules, as for any signed-out visitor.
 * - `demo`: a page (or a server action) under `/app`, served with the in-memory data.
 * - `blocked`: an address under `/app` that stays closed in demo (downloads and exports).
 *   `redirectTo` is the page the visitor is sent back to.
 */
export type DemoDecision = { mode: "none" } | { mode: "demo" } | { mode: "blocked"; redirectTo: string };

export function demoDecision(input: {
  pathname: string;
  hasDemoCookie: boolean;
  signedIn: boolean;
}): DemoDecision {
  const { pathname, hasDemoCookie, signedIn } = input;
  if (!hasDemoCookie || signedIn) return { mode: "none" };
  if (pathname !== CUSTOMER_AREA && !pathname.startsWith(`${CUSTOMER_AREA}/`)) return { mode: "none" };
  const segments = pathname.split("/").filter((segment) => segment !== "");
  // Anything odd in the path is not worth guessing about.
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes("\\"))) {
    return { mode: "none" };
  }
  if (segments[segments.length - 1] === "export") {
    return { mode: "blocked", redirectTo: `/${segments.slice(0, -1).join("/")}` };
  }
  return { mode: "demo" };
}

/** Supabase session cookies (`sb-<project>-auth-token`, possibly split in `.0`, `.1`…). */
export function isSupabaseAuthCookie(name: string): boolean {
  return /^sb-.+-auth-token(\.\d+)?$/.test(name);
}
