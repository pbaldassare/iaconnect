/** Route rules shared by the middleware, the auth pages and the tests. Pure functions only. */

export const SIGN_IN_PATH = "/accedi";
export const DEFAULT_AFTER_SIGN_IN = "/app";

const PUBLIC_PREFIXES = ["/accedi", "/auth"];

/** Everything except the sign-in and auth callback pages needs a session. */
export function isProtectedPath(pathname: string): boolean {
  return !PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Where to send a signed-out visitor, remembering the page they asked for. */
export function signInRedirect(pathname: string, search = ""): { pathname: string; search: string } {
  const wanted = `${pathname}${search}`;
  const next = safeNextPath(wanted);
  return {
    pathname: SIGN_IN_PATH,
    search: next === DEFAULT_AFTER_SIGN_IN || pathname === "/" ? "" : `?next=${encodeURIComponent(next)}`,
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
  if (value === SIGN_IN_PATH || value.startsWith(`${SIGN_IN_PATH}?`) || value.startsWith("/auth/")) {
    return DEFAULT_AFTER_SIGN_IN;
  }
  return value;
}
