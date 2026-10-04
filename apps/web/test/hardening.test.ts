import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "../next.config";
import { errorMessage } from "../src/lib/action";
import { MissingAppUrlError, resolveAppUrl } from "../src/lib/app-url";
import { OAUTH_STATE_SECRET_MISSING, oauthStateSecretFrom } from "../src/lib/connections/oauth-state";
import {
  approvalDecidedJob,
  scrapeRunJob,
  scrapeTraceJob,
  sendMessageJob,
  simulateFlowJob,
  simulateSampleJob,
  verifyConnectionJob,
} from "../src/lib/job-requests";
import { confirmedUserByEmail } from "../src/lib/users-match";

/** Web side of the security audit of 2026-10-04. */

describe("finding 14: the public address of the app", () => {
  it("comes from APP_URL only in production", () => {
    expect(resolveAppUrl({ appUrl: "https://app.esempio.it/", nodeEnv: "production" })).toBe(
      "https://app.esempio.it",
    );
    // Even with request headers at hand, production never builds links from them.
    expect(() =>
      resolveAppUrl({
        appUrl: undefined,
        nodeEnv: "production",
        host: "evil.example",
        forwardedProto: "https",
      }),
    ).toThrow(MissingAppUrlError);
    expect(() => resolveAppUrl({ appUrl: "  ", nodeEnv: "production" })).toThrow(/APP_URL/);
  });

  it("falls back to the request's own host in development", () => {
    expect(resolveAppUrl({ appUrl: undefined, nodeEnv: "development", host: "localhost:3000" })).toBe(
      "http://localhost:3000",
    );
    expect(resolveAppUrl({ appUrl: undefined, nodeEnv: "test" })).toBe("http://localhost:3000");
  });
});

describe("finding 15: the OAuth state secret", () => {
  it("is OAUTH_STATE_SECRET and never the service key", () => {
    const secret = "s".repeat(32);
    expect(oauthStateSecretFrom({ OAUTH_STATE_SECRET: secret, SUPABASE_SERVICE_ROLE_KEY: "service" })).toBe(
      secret,
    );
    expect(
      oauthStateSecretFrom({ SUPABASE_SERVICE_ROLE_KEY: "service-role-key-that-is-long-enough-123" }),
    ).toBeNull();
    expect(oauthStateSecretFrom({ OAUTH_STATE_SECRET: "short" })).toBeNull();
    expect(oauthStateSecretFrom({})).toBeNull();
    expect(OAUTH_STATE_SECRET_MISSING).toContain("OAUTH_STATE_SECRET");
  });
});

describe("finding 16: security headers", () => {
  it("sends HSTS and a Content-Security-Policy on every page", () => {
    const headers = Object.fromEntries(
      securityHeaders({ supabaseUrl: "https://abcd.supabase.co" }).map((header) => [
        header.key,
        header.value,
      ]),
    );
    expect(headers["Strict-Transport-Security"]).toMatch(/max-age=\d{8,}; includeSubDomains/);
    expect(headers["X-Frame-Options"]).toBe("DENY");
    const csp = headers["Content-Security-Policy"]!;
    for (const directive of [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]) {
      expect(csp.split("; "), directive).toContain(directive);
    }
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*(https:|\*)/);
  });

  it("allows eval only in development and a Supabase outside supabase.co only when configured", () => {
    expect(contentSecurityPolicy({ development: true })).toContain("'unsafe-eval'");
    const local = contentSecurityPolicy({ supabaseUrl: "http://localhost:54321" });
    expect(local).toContain(
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co http://localhost:54321 ws://localhost:54321",
    );
  });
});

describe("finding 4: roles by email need a confirmed address", () => {
  it("ignores an account that never confirmed the address", () => {
    const users = [
      { id: "squatter", email: "Capo@Rivenditore.it", email_confirmed_at: null },
      { id: "other", email: "altro@rivenditore.it", email_confirmed_at: "2026-10-01T08:00:00Z" },
    ];
    expect(confirmedUserByEmail(users, "capo@rivenditore.it")).toBeNull();
    expect(confirmedUserByEmail(users, " ALTRO@rivenditore.it ")?.id).toBe("other");
    expect(
      confirmedUserByEmail(
        [{ ...users[0]!, email_confirmed_at: "2026-10-02T08:00:00Z" }],
        "capo@rivenditore.it",
      )?.id,
    ).toBe("squatter");
  });
});

describe("finding 5: job keys requested by users", () => {
  it("always start with user:, so they cannot take a key of the worker", () => {
    const id = "7d69efad-b09f-49ea-abf0-d32e5fd51c76";
    const at = new Date("2026-10-04T10:00:05.000Z");
    for (const request of [
      sendMessageJob(id),
      approvalDecidedJob(id, at),
      simulateFlowJob(id, at),
      simulateSampleJob(id, { from: "+393331234567" }, at),
      scrapeRunJob(id, at),
      scrapeTraceJob(id, at),
      verifyConnectionJob(id, at),
    ]) {
      expect(request.dedupeKey, request.kind).toMatch(/^user:/);
    }
  });
});

describe("database refusals in Italian", () => {
  it("explains the new limits", () => {
    expect(
      errorMessage({
        code: "23505",
        message: 'duplicate key value violates unique constraint "connections_external_account_unique"',
      }),
    ).toBe("Questo account è già collegato a un'altra azienda.");
    expect(errorMessage({ code: "IAC01", message: "too many pending jobs" })).toMatch(/troppe richieste/);
    expect(errorMessage({ code: "IAC02", message: "active_flows" })).toMatch(/flussi attivi/);
    expect(errorMessage({ code: "P0001", message: "messages cannot be edited" })).toMatch(
      /non si può modificare/,
    );
  });
});
