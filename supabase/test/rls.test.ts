import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestDb, createTestDb } from "./db";

let db: TestDb;
const ids = {} as Record<
  | "admin"
  | "ownerA"
  | "memberA"
  | "ownerB"
  | "orgA"
  | "orgB"
  | "contactA"
  | "contactB"
  | "flowA"
  | "versionA",
  string
>;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.asService<T>(sql, params))[0]!;
}

beforeAll(async () => {
  db = await createTestDb();
  for (const name of ["admin", "ownerA", "memberA", "ownerB"] as const) {
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
    "insert into ia_connect.memberships (user_id, organization_id, role) values ($1, $2, 'org_owner'), ($3, $2, 'org_member'), ($4, $5, 'org_owner')",
    [ids.ownerA, ids.orgA, ids.memberA, ids.ownerB, ids.orgB],
  );

  // One row per organization in the tables customers work with.
  for (const org of ["orgA", "orgB"] as const) {
    const orgId = ids[org];
    const contact = await one<{ id: string }>(
      "insert into ia_connect.contacts (organization_id, full_name, phones) values ($1, $2, '{+393330000000}') returning id",
      [orgId, `Contatto ${org}`],
    );
    ids[org === "orgA" ? "contactA" : "contactB"] = contact.id;
    const connection = await one<{ id: string }>(
      "insert into ia_connect.connections (organization_id, connector_type, name) values ($1, 'whatsapp_meta', 'WhatsApp') returning id",
      [orgId],
    );
    await db.asService(
      "insert into ia_connect.connection_secrets (organization_id, connection_id, vault_secret_id) values ($1, $2, gen_random_uuid())",
      [orgId, connection.id],
    );
    const conversation = await one<{ id: string }>(
      "insert into ia_connect.conversations (organization_id, contact_id, channel) values ($1, $2, 'whatsapp') returning id",
      [orgId, contact.id],
    );
    await db.asService(
      "insert into ia_connect.messages (organization_id, conversation_id, direction, channel, content) values ($1, $2, 'in', 'whatsapp', 'ciao')",
      [orgId, conversation.id],
    );
    const stage = await one<{ id: string }>(
      "select id from ia_connect.deal_stages where organization_id = $1 and key = 'new'",
      [orgId],
    );
    await db.asService(
      "insert into ia_connect.deals (organization_id, contact_id, title, stage_id) values ($1, $2, 'Trattativa', $3)",
      [orgId, contact.id, stage.id],
    );
    const event = await one<{ id: string }>(
      "insert into ia_connect.events (organization_id, type, dedupe_key) values ($1, 'manual.test', 'k1') returning id",
      [orgId],
    );
    const flow = await one<{ id: string }>(
      "insert into ia_connect.flows (organization_id, name) values ($1, 'Flusso') returning id",
      [orgId],
    );
    const version = await one<{ id: string }>(
      "insert into ia_connect.flow_versions (organization_id, flow_id, version, definition, author_type) values ($1, $2, 1, '{}', 'system') returning id",
      [orgId, flow.id],
    );
    if (org === "orgA") {
      ids.flowA = flow.id;
      ids.versionA = version.id;
    }
    await db.asService(
      "insert into ia_connect.flow_runs (organization_id, flow_id, flow_version_id, event_id) values ($1, $2, $3, $4)",
      [orgId, flow.id, version.id, event.id],
    );
    await db.asService(
      "insert into ia_connect.ai_calls (organization_id, purpose, model) values ($1, 'ai.reply', 'test')",
      [orgId],
    );
  }
});

afterAll(() => db.close());

describe("row level security", () => {
  it("is enabled on every table", async () => {
    const rows = await db.asService<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'ia_connect' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows.map((row) => row.relname)).toEqual([]);
  });

  it("gives every customer table a policy, except the secrets table", async () => {
    const rows = await db.asService<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
       where c.table_schema = 'ia_connect' and c.column_name = 'organization_id'
         and not exists (select 1 from pg_policies p where p.schemaname = 'ia_connect' and p.tablename = c.table_name)`,
    );
    expect(rows.map((row) => row.table_name)).toEqual(["connection_secrets"]);
  });

  it("hides every row of another organization, in every table", async () => {
    const tables = await db.asService<{ table_name: string }>(
      "select table_name from information_schema.columns where table_schema = 'ia_connect' and column_name = 'organization_id'",
    );
    expect(tables.length).toBeGreaterThan(25);
    for (const { table_name } of tables) {
      if (table_name === "connection_secrets") continue;
      // access_requests is in this list too, but its organization_id is "the organization the
      // request became", not a tenant column: rows belong to the requesting user. The check
      // below still holds for it; who reads what is pinned in access-requests.test.ts.
      const rows = await db.asUser<{ n: number }>(
        ids.ownerA,
        `select count(*)::int as n from ia_connect.${table_name} where organization_id = $1`,
        [ids.orgB],
      );
      expect(rows[0]!.n, table_name).toBe(0);
    }
    const own = await db.asUser<{ n: number }>(
      ids.ownerA,
      "select count(*)::int as n from ia_connect.contacts",
    );
    expect(own[0]!.n).toBe(1);
    const orgs = await db.asUser<{ name: string }>(ids.ownerA, "select name from ia_connect.organizations");
    expect(orgs.map((org) => org.name)).toEqual(["orgA"]);
  });

  it("refuses writes into another organization", async () => {
    await expect(
      db.asUser(ids.ownerA, "insert into ia_connect.contacts (organization_id, full_name) values ($1, 'x')", [
        ids.orgB,
      ]),
    ).rejects.toThrow(/row-level security/);
    const updated = await db.asUser(
      ids.ownerA,
      "update ia_connect.contacts set full_name = 'hacked' where id = $1 returning id",
      [ids.contactB],
    );
    expect(updated).toEqual([]);
    const deleted = await db.asUser(
      ids.ownerA,
      "delete from ia_connect.contacts where id = $1 returning id",
      [ids.contactB],
    );
    expect(deleted).toEqual([]);
  });

  it("never exposes connection secrets to signed-in users", async () => {
    await expect(db.asUser(ids.ownerA, "select * from ia_connect.connection_secrets")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.asUser(ids.ownerA, "select ia_connect.read_connection_secret(gen_random_uuid())"),
    ).rejects.toThrow(/permission denied/);
  });

  it("lets members work on contacts but not on connections or flows", async () => {
    const contact = await db.asUser(
      ids.memberA,
      "insert into ia_connect.contacts (organization_id, full_name) values ($1, 'Nuovo') returning id",
      [ids.orgA],
    );
    expect(contact).toHaveLength(1);
    await expect(
      db.asUser(
        ids.memberA,
        "insert into ia_connect.connections (organization_id, connector_type, name) values ($1, 'gmail', 'x')",
        [ids.orgA],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.asUser(ids.memberA, "insert into ia_connect.flows (organization_id, name) values ($1, 'x')", [
        ids.orgA,
      ]),
    ).rejects.toThrow(/row-level security/);
  });

  it("stops an owner from changing plan or granting platform roles", async () => {
    const changed = await db.asUser(
      ids.ownerA,
      "update ia_connect.organizations set name = 'x' where id = $1 returning id",
      [ids.orgA],
    );
    expect(changed).toEqual([]);
    await expect(
      db.asUser(
        ids.ownerA,
        "insert into ia_connect.memberships (user_id, role) values ($1, 'platform_admin')",
        [ids.ownerA],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("lets the platform admin see every organization", async () => {
    const orgs = await db.asUser<{ name: string }>(
      ids.admin,
      "select name from ia_connect.organizations order by name",
    );
    expect(orgs.map((org) => org.name)).toEqual(["orgA", "orgB"]);
  });
});

describe("audit and immutability", () => {
  it("logs customer and admin actions with the right actor", async () => {
    await db.asUser(
      ids.ownerA,
      "update ia_connect.org_settings set ai_tone = 'cordiale' where organization_id = $1",
      [ids.orgA],
    );
    await db.asUser(
      ids.admin,
      "update ia_connect.org_settings set ai_tone = 'formale' where organization_id = $1",
      [ids.orgA],
    );
    const rows = await db.asUser<{
      actor_type: string;
      is_support_access: boolean;
      data: { changed: string[] };
    }>(
      ids.ownerA,
      "select actor_type, is_support_access, data from ia_connect.audit_log where action = 'org_settings.update' order by created_at",
    );
    expect(rows.map((row) => [row.actor_type, row.is_support_access])).toEqual([
      ["user", false],
      ["admin", true],
    ]);
    expect(rows[0]!.data.changed).toEqual(["ai_tone"]);
  });

  it("logs worker writes as automation", async () => {
    const rows = await db.asService<{ actor_type: string }>(
      "select distinct actor_type from ia_connect.audit_log where action = 'contacts.insert' and actor_id is null",
    );
    expect(rows.map((row) => row.actor_type)).toEqual(["automation"]);
  });

  it("refuses updates and deletes on audit_log, even for the owner role", async () => {
    await expect(db.asService("update ia_connect.audit_log set action = 'x'")).rejects.toThrow(/immutable/);
    await expect(db.asService("delete from ia_connect.audit_log")).rejects.toThrow(/immutable/);
  });

  it("keeps flow versions immutable", async () => {
    await expect(
      db.asService("update ia_connect.flow_versions set note = 'x' where id = $1", [ids.versionA]),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.asService("delete from ia_connect.flow_versions where id = $1", [ids.versionA]),
    ).rejects.toThrow(/together with their flow/);
  });
});

describe("quotas", () => {
  it("consumes until the plan limit and then refuses", async () => {
    await db.asService(
      `update ia_connect.plans set limits = limits || '{"messages_per_month": 3}' where key = 'starter'`,
    );
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      results.push(
        (await one<{ ok: boolean }>("select ia_connect.consume_quota($1, 'messages', 1) as ok", [ids.orgA]))
          .ok,
      );
    }
    expect(results).toEqual([true, true, true, false]);
    const left = await one<{ left: string }>("select ia_connect.quota_left($1, 'messages') as left", [
      ids.orgA,
    ]);
    expect(Number(left.left)).toBe(0);
  });

  it("cannot be called by customers", async () => {
    await expect(
      db.asUser(ids.ownerA, "select ia_connect.consume_quota($1, 'messages', 1)", [ids.orgA]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("invitations and GDPR", () => {
  it("turns a pending invitation into a membership at first login", async () => {
    const invited = (
      await one<{ id: string }>(
        "insert into auth.users (email, email_confirmed_at) values ('nuovo@test.it', now()) returning id",
      )
    ).id;
    await db.asUser(
      ids.ownerA,
      "insert into ia_connect.invitations (organization_id, email, role, invited_by) values ($1, 'Nuovo@test.it', 'org_member', $2)",
      [ids.orgA, ids.ownerA],
    );
    const accepted = await db.asUser<{ n: number }>(invited, "select ia_connect.accept_invitations() as n");
    expect(accepted[0]!.n).toBe(1);
    const orgs = await db.asUser<{ id: string }>(invited, "select id from ia_connect.organizations");
    expect(orgs.map((org) => org.id)).toEqual([ids.orgA]);
  });

  it("exports a contact with its history, only inside the organization", async () => {
    const mine = await db.asUser<{ data: { contact: { id: string }; messages: unknown[] } }>(
      ids.ownerA,
      "select ia_connect.export_contact($1) as data",
      [ids.contactA],
    );
    expect(mine[0]!.data.contact.id).toBe(ids.contactA);
    expect(mine[0]!.data.messages).toHaveLength(1);
    const other = await db.asUser<{ data: unknown }>(
      ids.ownerA,
      "select ia_connect.export_contact($1) as data",
      [ids.contactB],
    );
    expect(other[0]?.data ?? null).toBeNull();
  });

  it("refuses organization export and deletion to outsiders", async () => {
    await expect(
      db.asUser(ids.ownerA, "select ia_connect.export_organization($1)", [ids.orgB]),
    ).rejects.toThrow(/not allowed/);
    await expect(
      db.asUser(ids.ownerA, "select ia_connect.admin_delete_organization($1)", [ids.orgA]),
    ).rejects.toThrow(/not allowed/);
  });

  it("deletes an organization with everything it owns and keeps the audit trail", async () => {
    await db.asUser(ids.admin, "select ia_connect.admin_delete_organization($1)", [ids.orgB]);
    const left = await one<{ n: number }>(
      "select (select count(*) from ia_connect.contacts where organization_id = $1)::int + (select count(*) from ia_connect.flow_versions where organization_id = $1)::int as n",
      [ids.orgB],
    );
    expect(left.n).toBe(0);
    const audit = await one<{ n: number }>(
      "select count(*)::int as n from ia_connect.audit_log where organization_id = $1",
      [ids.orgB],
    );
    expect(audit.n).toBeGreaterThan(0);
  });
});

describe("jobs requested from the web app", () => {
  it("accepts only the allowed kinds, inside the caller's organization", async () => {
    const insert = (user: string, org: string, kind: string) =>
      db.asUser(
        user,
        "insert into ia_connect.scheduled_jobs (organization_id, kind, run_at) values ($1, $2, now())",
        [org, kind],
      );
    await insert(ids.memberA, ids.orgA, "send_message");
    await insert(ids.ownerA, ids.orgA, "simulate_flow");
    await expect(insert(ids.memberA, ids.orgA, "simulate_flow")).rejects.toThrow(/row-level security/);
    await expect(insert(ids.ownerA, ids.orgA, "resume_run")).rejects.toThrow(/row-level security/);
    await expect(insert(ids.ownerB, ids.orgA, "send_message")).rejects.toThrow(/row-level security/);
    const jobs = await db.asService<{ created_by: string | null }>(
      "select created_by from ia_connect.scheduled_jobs where organization_id = $1",
      [ids.orgA],
    );
    expect(jobs.every((job) => job.created_by !== null)).toBe(true);
  });
});
