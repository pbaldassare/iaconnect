import { describe, expect, it } from "vitest";
import {
  canManageFromMembership,
  isSupportSessionOpen,
  isUuid,
  selectOrganization,
} from "../src/lib/org-selection";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("selectOrganization", () => {
  it("uses the cookie when the user is a member of that organization", () => {
    expect(selectOrganization({ cookieOrgId: B, memberOrgIds: [A, B], supportOrgId: null })).toEqual({
      orgId: B,
      mode: "member",
    });
  });

  it("falls back to the first membership without a cookie", () => {
    expect(selectOrganization({ cookieOrgId: null, memberOrgIds: [A, B], supportOrgId: null })).toEqual({
      orgId: A,
      mode: "member",
    });
  });

  it("ignores a cookie naming an organization the user cannot enter", () => {
    expect(selectOrganization({ cookieOrgId: C, memberOrgIds: [A], supportOrgId: null })).toEqual({
      orgId: A,
      mode: "member",
    });
    expect(selectOrganization({ cookieOrgId: C, memberOrgIds: [], supportOrgId: null })).toBeNull();
  });

  it("enters in support mode only with an open support session for that same organization", () => {
    expect(selectOrganization({ cookieOrgId: C, memberOrgIds: [], supportOrgId: C })).toEqual({
      orgId: C,
      mode: "support",
    });
    expect(selectOrganization({ cookieOrgId: C, memberOrgIds: [], supportOrgId: B })).toBeNull();
  });

  it("prefers membership over support when both apply", () => {
    expect(selectOrganization({ cookieOrgId: A, memberOrgIds: [A], supportOrgId: A })).toEqual({
      orgId: A,
      mode: "member",
    });
  });

  it("does not enter support mode without a cookie, even if a session is open", () => {
    expect(selectOrganization({ cookieOrgId: null, memberOrgIds: [], supportOrgId: C })).toBeNull();
  });
});

describe("isSupportSessionOpen", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  it("is open when not ended and recent", () => {
    expect(isSupportSessionOpen({ started_at: "2026-10-04T10:00:00Z", ended_at: null }, now)).toBe(true);
  });
  it("is closed once ended", () => {
    expect(
      isSupportSessionOpen({ started_at: "2026-10-04T10:00:00Z", ended_at: "2026-10-04T11:00:00Z" }, now),
    ).toBe(false);
  });
  it("expires after eight hours even if never closed", () => {
    expect(isSupportSessionOpen({ started_at: "2026-10-04T03:59:00Z", ended_at: null }, now)).toBe(false);
  });
  it("is closed when the start date is invalid", () => {
    expect(isSupportSessionOpen({ started_at: "nope", ended_at: null }, now)).toBe(false);
  });
});

describe("isUuid", () => {
  it("accepts uuids and rejects anything else", () => {
    expect(isUuid(A)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(`${A}' or 1=1`)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe("canManageFromMembership", () => {
  it("lets owners manage", () => {
    expect(canManageFromMembership({ role: "org_owner", permissions: {} })).toBe(true);
  });
  it("lets members manage only with the manage permission", () => {
    expect(canManageFromMembership({ role: "org_member", permissions: {} })).toBe(false);
    expect(canManageFromMembership({ role: "org_member", permissions: { manage: true } })).toBe(true);
    expect(canManageFromMembership({ role: "org_member", permissions: { manage: "true" } })).toBe(false);
    expect(canManageFromMembership({ role: "org_member", permissions: null })).toBe(false);
  });
  it("denies without a membership", () => {
    expect(canManageFromMembership(undefined)).toBe(false);
  });
});
