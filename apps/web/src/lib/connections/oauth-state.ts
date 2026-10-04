import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed state for the OAuth round trip. The cookie holds `payload.signature`
 * (HMAC-SHA256); the provider only sees the random nonce, which comes back in
 * the `state` query parameter and must match the cookie. Pure given the secret,
 * unit tested (tampering, expiry, wrong nonce are rejected).
 */

export const OAUTH_STATE_COOKIE = "oauth_state";
export const OAUTH_STATE_TTL_SECONDS = 600;

export interface OAuthState {
  /** Organization the connection is for. */
  org: string;
  /** Connector key, must match the callback route. */
  connector: string;
  /** User who started the flow. */
  user: string;
  nonce: string;
  /** Expiry, epoch seconds. */
  exp: number;
  /** Existing connection to refresh instead of creating a new one. */
  reconnect?: string;
  /** Extra non-secret input for `connect` (e.g. the Facebook page id). */
  extra?: Record<string, string>;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function newNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function createOAuthState(
  input: Omit<OAuthState, "nonce" | "exp"> & { nonce?: string },
  secret: string,
  now: Date = new Date(),
): { cookie: string; nonce: string } {
  if (!secret) throw new Error("OAuth state secret is empty");
  const state: OAuthState = {
    ...input,
    nonce: input.nonce ?? newNonce(),
    exp: Math.floor(now.getTime() / 1000) + OAUTH_STATE_TTL_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return { cookie: `${payload}.${sign(payload, secret)}`, nonce: state.nonce };
}

export type OAuthStateCheck =
  | { ok: true; state: OAuthState }
  | { ok: false; reason: "missing" | "malformed" | "signature" | "expired" | "nonce" | "connector" };

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Verifies the cookie against the secret, the returned `state` parameter and the route's connector. */
export function verifyOAuthState(
  cookie: string | null | undefined,
  expected: { nonce: string | null | undefined; connector: string },
  secret: string,
  now: Date = new Date(),
): OAuthStateCheck {
  if (!cookie || !secret) return { ok: false, reason: "missing" };
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };
  const payload = cookie.slice(0, dot);
  const signature = cookie.slice(dot + 1);
  if (!sameText(signature, sign(payload, secret))) return { ok: false, reason: "signature" };

  let state: OAuthState;
  try {
    state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof state !== "object" ||
    state === null ||
    typeof state.org !== "string" ||
    typeof state.connector !== "string" ||
    typeof state.user !== "string" ||
    typeof state.nonce !== "string" ||
    typeof state.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (state.exp * 1000 <= now.getTime()) return { ok: false, reason: "expired" };
  if (!expected.nonce || !sameText(state.nonce, expected.nonce)) return { ok: false, reason: "nonce" };
  if (state.connector !== expected.connector) return { ok: false, reason: "connector" };
  return { ok: true, state };
}
