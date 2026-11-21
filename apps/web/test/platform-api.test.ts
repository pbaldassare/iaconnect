import { describe, expect, it } from "vitest";
import {
  type PlatformApiStore,
  handlePlatformApi,
  hashApiKey,
  matchApiRoute,
  newApiKey,
  platformApiErrorFrom,
  readBearer,
} from "../src/lib/platform-api";

const ORG = "7642fb92-b179-482a-ae75-c1e3c01dcc5e";
const CONVERSATION = "a648c4ae-3328-4b5a-836e-4c3d31f3ee30";

function store(seen: string[]): PlatformApiStore {
  return {
    async organizations(keyHash) {
      seen.push(keyHash);
      return [
        {
          id: ORG,
          name: "Pititto Assicurazioni",
          sector: "insurance",
          status: "active",
          created_at: "2026-11-20T18:00:00.000Z",
        },
      ];
    },
    async conversations(keyHash) {
      seen.push(keyHash);
      return [];
    },
    async messages(keyHash) {
      seen.push(keyHash);
      return [];
    },
  };
}

describe("platform api keys", () => {
  it("builds a key the database can store, and accepts only that shape as a bearer", async () => {
    const key = await newApiKey();
    expect(key.raw).toMatch(/^iac_[0-9a-f]{64}$/);
    expect(key.prefix).toBe(key.raw.slice(0, 12));
    expect(key.hash).toBe(await hashApiKey(key.raw));
    expect(key.hash).not.toBe(key.raw);
    expect(readBearer(`Bearer ${key.raw}`)).toBe(key.raw);
    expect(readBearer("Bearer iac_short")).toBeNull();
    expect(readBearer("Basic iac_aaaa")).toBeNull();
    expect(readBearer(null)).toBeNull();
  });
});

describe("platform api routes", () => {
  it("matches the three read paths and nothing around them", () => {
    expect(matchApiRoute("/api/v1/organizations")).toEqual({ kind: "organizations" });
    expect(matchApiRoute(`/api/v1/organizations/${ORG}/conversations`)).toEqual({
      kind: "conversations",
      organizationId: ORG,
    });
    expect(matchApiRoute(`/api/v1/organizations/${ORG}/conversations/${CONVERSATION}/messages`)).toEqual({
      kind: "messages",
      organizationId: ORG,
      conversationId: CONVERSATION,
    });
    expect(matchApiRoute("/api/v1/organizations/")).toEqual({ kind: "organizations" });
    expect(matchApiRoute("/api/v1")).toBeNull();
    expect(matchApiRoute("/api/v10/organizations")).toBeNull();
    expect(matchApiRoute("/api/v1/organizations/not-a-uuid/conversations")).toBeNull();
  });

  it("calls the store with the hash, never the raw key", async () => {
    const key = await newApiKey();
    const seen: string[] = [];
    const result = await handlePlatformApi({
      method: "GET",
      pathname: "/api/v1/organizations",
      authorization: `Bearer ${key.raw}`,
      search: new URLSearchParams(),
      store: store(seen),
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      data: [
        {
          id: ORG,
          name: "Pititto Assicurazioni",
          sector: "insurance",
          status: "active",
          created_at: "2026-11-20T18:00:00.000Z",
        },
      ],
    });
    expect(seen).toEqual([key.hash]);
    expect(JSON.stringify(seen)).not.toContain(key.raw);
  });

  it("refuses a missing key, a bad query, the wrong method, and an unknown path", async () => {
    const key = await newApiKey();
    const seen: string[] = [];
    const base = {
      pathname: `/api/v1/organizations/${ORG}/conversations`,
      search: new URLSearchParams(),
      store: store(seen),
    };
    expect((await handlePlatformApi({ ...base, method: "GET", authorization: null })).status).toBe(401);
    expect(
      (await handlePlatformApi({ ...base, method: "POST", authorization: `Bearer ${key.raw}` })).status,
    ).toBe(405);
    expect(
      (
        await handlePlatformApi({
          ...base,
          method: "GET",
          authorization: `Bearer ${key.raw}`,
          search: new URLSearchParams("limit=0"),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await handlePlatformApi({
          ...base,
          method: "GET",
          authorization: `Bearer ${key.raw}`,
          search: new URLSearchParams("limit=101"),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await handlePlatformApi({
          ...base,
          method: "GET",
          authorization: `Bearer ${key.raw}`,
          search: new URLSearchParams("before=domani"),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await handlePlatformApi({
          ...base,
          method: "GET",
          pathname: "/api/v1/send",
          authorization: `Bearer ${key.raw}`,
        })
      ).status,
    ).toBe(404);
    expect(seen).toEqual([]);
  });

  it("hides an internal failure, including one that repeats the key", async () => {
    const key = await newApiKey();
    const result = await handlePlatformApi({
      method: "GET",
      pathname: "/api/v1/organizations",
      authorization: `Bearer ${key.raw}`,
      search: new URLSearchParams(),
      store: {
        async organizations() {
          throw new Error(`database password and ${key.raw}`);
        },
        async conversations() {
          return [];
        },
        async messages() {
          return [];
        },
      },
    });
    expect(result).toEqual({ status: 500, body: { error: "internal" } });
    expect(JSON.stringify(result)).not.toContain(key.raw);
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("maps the database errors and nothing that merely mentions them", () => {
    expect(platformApiErrorFrom({ code: "28000" })?.code).toBe("unauthorized");
    expect(platformApiErrorFrom({ code: "42501" })?.code).toBe("forbidden");
    expect(platformApiErrorFrom({ message: "not found" })?.code).toBe("not_found");
    expect(platformApiErrorFrom({ message: "invalid limit" })?.code).toBe("invalid_query");
    expect(platformApiErrorFrom({ message: "permission denied for table api_keys" })).toBeNull();
  });
});
