import { SECTORS } from "@ia-connect/core";
import { describe, expect, it } from "vitest";
import { describeAuditAction } from "../src/lib/audit-labels";
import {
  MAX_FILL_MS,
  MIN_FILL_MS,
  REGISTRATION_METADATA_KEY,
  REQUEST_SECTORS,
  accessRequestErrorMessage,
  accessRequestStatus,
  checkFormSubmission,
  registrationFromMetadata,
  registrationMetadata,
  requestAccessArgs,
} from "../src/lib/registration";

const input = {
  fullName: "Anna Rossi",
  companyName: "Rossi Assicurazioni",
  sector: "insurance" as const,
  phone: "+39 333 0000000",
  message: null,
};

describe("registration data across the confirmation mail", () => {
  it("offers the same sectors as packages/core", () => {
    expect([...REQUEST_SECTORS]).toEqual([...SECTORS]);
  });

  it("goes into the metadata under its own key and comes back unchanged", () => {
    const metadata = registrationMetadata(input, "2026-10-04T10:00:00.000Z");
    expect(Object.keys(metadata)).toEqual([REGISTRATION_METADATA_KEY]);
    expect(metadata[REGISTRATION_METADATA_KEY]!.privacy_acknowledged_at).toBe("2026-10-04T10:00:00.000Z");
    expect(registrationFromMetadata({ other_app: { theme: "dark" }, ...metadata })).toEqual(input);
  });

  it("is null for accounts that never registered for IA Connect", () => {
    expect(registrationFromMetadata(undefined)).toBeNull();
    expect(registrationFromMetadata(null)).toBeNull();
    expect(registrationFromMetadata({})).toBeNull();
    expect(registrationFromMetadata({ full_name: "Mario", company_name: "Altra app" })).toBeNull();
    expect(registrationFromMetadata({ [REGISTRATION_METADATA_KEY]: "x" })).toBeNull();
    expect(registrationFromMetadata({ [REGISTRATION_METADATA_KEY]: [] })).toBeNull();
  });

  it("re-validates what the user could have written in their own metadata", () => {
    const from = (data: Record<string, unknown>) =>
      registrationFromMetadata({ [REGISTRATION_METADATA_KEY]: data });
    expect(from({ company_name: " " })).toBeNull();
    expect(from({ company_name: "x" })).toBeNull();
    expect(from({ company_name: 42 })).toBeNull();
    expect(from({ company_name: "Rossi", sector: "banking", phone: 5, full_name: "  " })).toEqual({
      fullName: null,
      companyName: "Rossi",
      sector: "other",
      phone: null,
      message: null,
    });
    const long = from({ company_name: "x".repeat(500), message: "y".repeat(5000), phone: "1".repeat(99) })!;
    expect(long.companyName).toHaveLength(120);
    expect(long.message).toHaveLength(1000);
    expect(long.phone).toHaveLength(40);
  });

  it("builds the arguments of request_access", () => {
    expect(requestAccessArgs(input)).toEqual({
      p_full_name: "Anna Rossi",
      p_company_name: "Rossi Assicurazioni",
      p_sector: "insurance",
      p_phone: "+39 333 0000000",
      p_message: null,
    });
  });
});

describe("abuse checks of the public form", () => {
  const now = 1_800_000_000_000;
  const check = (honeypot: string | null, elapsed: number | null) =>
    checkFormSubmission({ honeypot, startedAt: elapsed === null ? null : String(now - elapsed), now });

  it("passes a form filled by a person", () => {
    expect(check("", 20_000)).toBe("ok");
    expect(check(null, MIN_FILL_MS)).toBe("ok");
    expect(check("  ", MAX_FILL_MS)).toBe("ok");
  });

  it("catches the hidden field, before anything else", () => {
    expect(check("https://spam.example", 20_000)).toBe("honeypot");
    expect(check("x", 0)).toBe("honeypot");
  });

  it("refuses a form sent too fast, without a start time, or with one in the future", () => {
    expect(check("", MIN_FILL_MS - 1)).toBe("too_fast");
    expect(check("", null)).toBe("too_fast");
    expect(check("", -60_000)).toBe("too_fast");
    expect(checkFormSubmission({ honeypot: "", startedAt: "abc", now })).toBe("too_fast");
    expect(checkFormSubmission({ honeypot: "", startedAt: "", now })).toBe("too_fast");
  });

  it("asks to send again a form left open for more than a day", () => {
    expect(check("", MAX_FILL_MS + 1)).toBe("stale");
  });
});

describe("messages", () => {
  it("explains the errors of the two database functions", () => {
    expect(accessRequestErrorMessage({ code: "IAC10", message: "x" })).toMatch(/non è ancora confermato/);
    expect(accessRequestErrorMessage({ code: "IAC11", message: "x" })).toMatch(/Hai già un accesso/);
    expect(accessRequestErrorMessage({ code: "IAC12", message: "x" })).toMatch(/già stata decisa/);
    expect(
      accessRequestErrorMessage({ code: "22023", message: "unknown plan or missing default reseller" }),
    ).toMatch(/piano/);
    expect(accessRequestErrorMessage({ code: "22023", message: "a text is too long" })).toMatch(
      /troppo lungo/,
    );
    expect(accessRequestErrorMessage({ code: "PGRST205", message: "x" })).toMatch(/migrazione/);
    expect(accessRequestErrorMessage({ code: "42501", message: "not allowed" })).toBeNull();
    expect(accessRequestErrorMessage(null)).toBeNull();
  });

  it("labels the statuses and the audit entries", () => {
    expect(accessRequestStatus("pending")).toEqual({ label: "In attesa", tone: "warning" });
    expect(accessRequestStatus("approved")).toEqual({ label: "Approvata", tone: "ok" });
    expect(accessRequestStatus("rejected")).toEqual({ label: "Rifiutata", tone: "error" });
    expect(describeAuditAction("access_request.approve")).toBe(
      "Richiesta di accesso approvata: azienda creata",
    );
    expect(describeAuditAction("access_request.reject")).toBe("Richiesta di accesso rifiutata");
  });
});
