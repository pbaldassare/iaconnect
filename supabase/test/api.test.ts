import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestDb, createTestDb } from "./db";

let db: TestDb;
const ids = {} as Record<
  "admin" | "ownerA" | "ownerB" | "orgA" | "orgB" | "conversationA" | "conversationB",
  string
>;

const HASH_A = "a".repeat(64);
const HASH_PLATFORM = "b".repeat(64);
const PREFIX_A = "iac_aaaa1111";
const PREFIX_PLATFORM = "iac_bbbb2222";

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.asService<T>(sql, params))[0]!;
}

beforeAll(async () => {
  db = await createTestDb();
  for (const name of ["admin", "ownerA", "ownerB"] as const) {
    ids[name] = (
      await one<{ id: string }>("insert into auth.users (email) values ($1) returning id", [
        `${name}@test.it`,
      ])
    ).id;
  }
  const reseller = (await one<{ id: string }>("select id from ia_connect.resellers where slug = 'default'"))
    .id;
  const plan = (await one<{ id: string }>("select id from ia_connect.plans where key = 'starter'")).id;
  for (const org of ["orgA", "orgB"] as const) {
    ids[org] = (
      await one<{ id: string }>(
        "insert into ia_connect.organizations (reseller_id, name, sector, plan_id) values ($1, $2, 'insurance', $3) returning id",
        [reseller, org, plan],
      )
    ).id;
  }
  await db.asService("insert into ia_connect.memberships (user_id, role) values ($1, 'platform_admin')", [
    ids.admin,
  ]);
  await db.asService(
    "insert into ia_connect.memberships (user_id, organization_id, role) values ($1, $2, 'org_owner'), ($3, $4, 'org_owner')",
    [ids.ownerA, ids.orgA, ids.ownerB, ids.orgB],
  );
  for (const org of ["orgA", "orgB"] as const) {
    const contact = await one<{ id: string }>(
      "insert into ia_connect.contacts (organization_id, full_name) values ($1, $2) returning id",
      [ids[org], `Contatto ${org}`],
    );
    const conversation = await one<{ id: string }>(
      "insert into ia_connect.conversations (organization_id, contact_id, channel, created_at) values ($1, $2, 'whatsapp', $3) returning id",
      [ids[org], contact.id, org === "orgA" ? "2026-11-20T10:00:00Z" : "2026-11-20T11:00:00Z"],
    );
    ids[org === "orgA" ? "conversationA" : "conversationB"] = conversation.id;
    await db.asService(
      "insert into ia_connect.messages (organization_id, conversation_id, direction, channel, content, created_at) values ($1, $2, 'in', 'whatsapp', $3, $4)",
      [
        ids[org],
        conversation.id,
        `segreto ${org}`,
        org === "orgA" ? "2026-11-20T10:05:00Z" : "2026-11-20T11:05:00Z",
      ],
    );
  }
});

afterAll(() => db.close());

describe("api keys", () => {
  it("lets a platform admin issue a key, and keeps the raw secret out of the table and the audit log", async () => {
    const raw = `iac_${"c".repeat(64)}`;
    const hash = createHash("sha256").update(raw).digest("hex");
    const id = (
      await db.asUser<{ issue_api_key: string }>(
        ids.admin,
        "select ia_connect.issue_api_key('Chiave Pititto', $1, $2, $3) as issue_api_key",
        [ids.orgA, PREFIX_A, HASH_A],
      )
    )[0]!;
    expect(id.issue_api_key).toMatch(/^[0-9a-f-]{36}$/);
    const stored = await one<{ key_hash: string; key_prefix: string; name: string }>(
      "select key_hash, key_prefix, name from ia_connect.api_keys where id = $1",
      [id.issue_api_key],
    );
    expect(stored).toEqual({ key_hash: HASH_A, key_prefix: PREFIX_A, name: "Chiave Pititto" });
    const leak = await one<{ n: number }>(
      "select count(*)::int as n from ia_connect.api_keys where key_hash = $1 or name = $1 or key_prefix = $1",
      [raw],
    );
    expect(leak.n).toBe(0);
    const audit = await one<{ data: { prefix: string; scope: string }; action: string }>(
      "select action, data from ia_connect.audit_log where entity_id = $1",
      [id.issue_api_key],
    );
    expect(audit.action).toBe("api_keys.issue");
    expect(audit.data).toMatchObject({ prefix: PREFIX_A, scope: "organization" });
    expect(JSON.stringify(audit.data)).not.toContain(HASH_A);
    expect(hash).not.toBe(raw);
  });

  it("refuses a client, a direct insert, and a key for an unknown company", async () => {
    await expect(
      db.asUser(ids.ownerA, "select ia_connect.issue_api_key('x', $1, $2, $3)", [
        ids.orgA,
        "iac_cccc3333",
        "c".repeat(64),
      ]),
    ).rejects.toThrow(/forbidden/);
    await expect(
      db.asUser(
        ids.ownerA,
        "insert into ia_connect.api_keys (name, key_prefix, key_hash) values ('x', $1, $2)",
        ["iac_dddd4444", "d".repeat(64)],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.asUser(
        ids.admin,
        "insert into ia_connect.api_keys (name, key_prefix, key_hash) values ('x', $1, $2)",
        ["iac_dddd4444", "d".repeat(64)],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.asUser(ids.admin, "select ia_connect.issue_api_key('x', $1, 'iac_eeee5555', $2)", [
        "00000000-0000-0000-0000-000000000000",
        "e".repeat(64),
      ]),
    ).rejects.toThrow(/unknown organization/);
    await expect(
      db.asUser(ids.admin, "select ia_connect.issue_api_key('   ', null, 'iac_eeee5555', $1)", [
        "e".repeat(64),
      ]),
    ).rejects.toThrow(/invalid name/);
  });

  it("hides keys from the client and shows them to the platform admin", async () => {
    const asOwner = await db.asUser(ids.ownerA, "select id from ia_connect.api_keys");
    expect(asOwner).toEqual([]);
    const visible = await db.asUser<{ key_prefix: string }>(
      ids.admin,
      "select key_prefix from ia_connect.api_keys order by key_prefix",
    );
    expect(visible.map((row) => row.key_prefix)).toEqual([PREFIX_A]);
  });
});

describe("api reads", () => {
  beforeAll(async () => {
    await db.asUser(ids.admin, "select ia_connect.issue_api_key('Piattaforma', null, $1, $2)", [
      PREFIX_PLATFORM,
      HASH_PLATFORM,
    ]);
  });

  it("gives a client key only its own company, conversations and messages", async () => {
    const orgs = await db.asService<{ name: string }>(
      "select name from ia_connect.api_organizations($1) order by name",
      [HASH_A],
    );
    expect(orgs.map((org) => org.name)).toEqual(["orgA"]);
    const conversations = await db.asService<{ contact_name: string }>(
      "select contact_name from ia_connect.api_conversations($1, $2, 50, null)",
      [HASH_A, ids.orgA],
    );
    expect(conversations.map((row) => row.contact_name)).toEqual(["Contatto orgA"]);
    await expect(
      db.asService("select * from ia_connect.api_conversations($1, $2, 50, null)", [HASH_A, ids.orgB]),
    ).rejects.toThrow(/forbidden/);
    const messages = await db.asService<{ content: string }>(
      "select content from ia_connect.api_messages($1, $2, $3, 50, null)",
      [HASH_A, ids.orgA, ids.conversationA],
    );
    expect(messages.map((row) => row.content)).toEqual(["segreto orgA"]);
    await expect(
      db.asService("select * from ia_connect.api_messages($1, $2, $3, 50, null)", [
        HASH_A,
        ids.orgA,
        ids.conversationB,
      ]),
    ).rejects.toThrow(/not found/);
    await expect(
      db.asService("select * from ia_connect.api_messages($1, $2, $3, 50, null)", [
        HASH_A,
        ids.orgB,
        ids.conversationB,
      ]),
    ).rejects.toThrow(/forbidden/);
  });

  it("gives a platform key every company, and a page of history", async () => {
    const orgs = await db.asService<{ name: string }>(
      "select name from ia_connect.api_organizations($1) order by name",
      [HASH_PLATFORM],
    );
    expect(orgs.map((org) => org.name)).toEqual(["orgA", "orgB"]);
    const page = await db.asService<{ content: string }>(
      "select content from ia_connect.api_messages($1, $2, $3, 1, $4)",
      [HASH_PLATFORM, ids.orgB, ids.conversationB, "2026-11-20T12:00:00Z"],
    );
    expect(page.map((row) => row.content)).toEqual(["segreto orgB"]);
    const older = await db.asService<{ content: string }>(
      "select content from ia_connect.api_messages($1, $2, $3, 1, $4)",
      [HASH_PLATFORM, ids.orgB, ids.conversationB, "2026-11-20T11:05:00Z"],
    );
    expect(older).toEqual([]);
    await expect(
      db.asService("select * from ia_connect.api_conversations($1, $2, 0, null)", [HASH_PLATFORM, ids.orgA]),
    ).rejects.toThrow(/invalid limit/);
    await expect(
      db.asService("select * from ia_connect.api_conversations($1, $2, 50, null)", [
        HASH_PLATFORM,
        "00000000-0000-0000-0000-000000000000",
      ]),
    ).rejects.toThrow(/not found/);
  });

  it("rejects a revoked key, an unknown key, and a client calling the read functions", async () => {
    const used = await one<{ last_used_at: string | null }>(
      "select last_used_at from ia_connect.api_keys where key_hash = $1",
      [HASH_A],
    );
    expect(used.last_used_at).not.toBeNull();
    const keyId = (
      await one<{ id: string }>("select id from ia_connect.api_keys where key_hash = $1", [HASH_A])
    ).id;
    await db.asUser(ids.admin, "select ia_connect.revoke_api_key($1)", [keyId]);
    await db.asUser(ids.admin, "select ia_connect.revoke_api_key($1)", [keyId]);
    await expect(db.asService("select * from ia_connect.api_organizations($1)", [HASH_A])).rejects.toThrow(
      /unauthorized/,
    );
    await expect(
      db.asService("select * from ia_connect.api_organizations($1)", ["f".repeat(64)]),
    ).rejects.toThrow(/unauthorized/);
    await expect(
      db.asUser(ids.ownerA, "select * from ia_connect.api_organizations($1)", [HASH_PLATFORM]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.asUser(ids.ownerA, "select ia_connect.revoke_api_key($1)", [keyId])).rejects.toThrow(
      /forbidden/,
    );
    const audit = await one<{ n: number }>(
      "select count(*)::int as n from ia_connect.audit_log where action = 'api_keys.revoke' and entity_id = $1",
      [keyId],
    );
    expect(audit.n).toBe(1);
  });
});
