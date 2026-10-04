/**
 * Where a signed-in user belongs. Pure: unit tested (test/landing-route.test.ts).
 *
 * Self-registration made "signed in" and "has access" two different things: a person may
 * have an account and nothing else (they also exist because Auth is shared with another
 * application), a pending request, a rejected one, or an organization.
 */

export const WAITING_PATH = "/in-attesa";
export const COMPLETE_REGISTRATION_PATH = "/completa-registrazione";
export const NO_ORGANIZATION_PATH = "/nessuna-azienda";
export const SET_PASSWORD_PATH = "/imposta-password";
/** Entry points that mean "take me where I belong" (the site's button, the confirmation mail). */
export const LANDING_ENTRY_PATHS: readonly string[] = ["/", "/area-riservata", "/benvenuto"];

export type AccessRequestStatus = "pending" | "approved" | "rejected";

export interface LandingInput {
  /** Platform admin or reseller admin. */
  isStaff: boolean;
  /** Member of at least one organization. */
  hasOrganization: boolean;
  /** Status of the user's access request; null when they never asked. */
  requestStatus: AccessRequestStatus | null;
}

/** The page a signed-in user lands on. */
export function landingRoute(input: LandingInput): string {
  if (input.isStaff) return "/admin";
  if (input.hasOrganization) return "/app";
  if (input.requestStatus === "pending" || input.requestStatus === "rejected") return WAITING_PATH;
  // Approved, but no organization any more (membership removed, organization deleted):
  // a new request is not possible, the page explains who to ask.
  if (input.requestStatus === "approved") return NO_ORGANIZATION_PATH;
  return COMPLETE_REGISTRATION_PATH;
}

/** True when the landing page is one of the two areas (the user can work). */
export function hasAreaAccess(landing: string): boolean {
  return landing === "/app" || landing === "/admin";
}

/**
 * Final destination after a sign-in, given the landing page and the (already sanitized)
 * `next` path. A user with an area keeps the page they asked for; a user without one can
 * only go to their landing page or choose a password.
 */
export function destinationAfterSignIn(landing: string, next: string | null | undefined): string {
  const path = (next ?? "").split(/[?#]/)[0] ?? "";
  if (!next || LANDING_ENTRY_PATHS.includes(path)) return landing;
  if (path === SET_PASSWORD_PATH) return next;
  if (!hasAreaAccess(landing)) return landing;
  // "/app" is also the default of safeNextPath: for staff without an organization it means "/admin".
  if (next === "/app") return landing;
  return next;
}

export function asRequestStatus(value: string | null | undefined): AccessRequestStatus | null {
  return value === "pending" || value === "approved" || value === "rejected" ? value : null;
}
