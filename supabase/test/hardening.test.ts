import { OPEN_EVENT_TYPES, isOpenEventType } from "@ia-connect/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestDb, createTestDb } from "./db";

/**
 * Pins migration 20261004001000_security_hardening.sql: what a signed-in manager or member
 * can no longer do by talking to the database directly (PostgREST), whatever the web checks.
 */

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
  | "conversationA"
  | "conversationB"
  | "connectionA"
  | "connectionB"
  | "flowA"
  | "flowB"
  | "versionA"
  | "versionB"
  | "runA"
  | "runB"
  | "stageA"
  | "messageA",
  string
>;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.asService<T>(sql, params))[0]!;
}

beforeAll(async () => {
  db = await createTestDb();
  for (const name of ["admin", "ownerA", "memberA", "ownerB"] as const) {
    ids[name] = (
      await one<{ id: string }>(
        "insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id",
        [`${name}@test.it`],
      )
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

  for (const suffix of ["A", "B"] as const) {
    const orgId = ids[`org${suffix}`];
    ids[`contact${suffix}`] = (
      await one<{ id: string }>(
        "insert into ia_connect.contacts (organization_id, full_name, phones) values ($1, $2, '{+393330000000}') returning id",
        [orgId, `Contatto ${suffix}`],
      )
    ).id;
    ids[`connection${suffix}`] = (
      await one<{ id: string }>(
        "insert into ia_connect.connections (organization_id, connector_type, name, external_account_id, config) values ($1, 'whatsapp_meta', 'WhatsApp', $2, $3::jsonb) returning id",
        [orgId, `phone-${suffix}`, JSON.stringify({ phoneNumberId: `phone-${suffix}` })],
      )
    ).id;
    ids[`conversation${suffix}`] = (
      await one<{ id: string }>(
        "insert into ia_connect.conversations (organization_id, contact_id, channel, connection_id) values ($1, $2, 'whatsapp', $3) returning id",
        [orgId, ids[`contact${suffix}`], ids[`connection${suffix}`]],
      )
    ).id;
    const message = await one<{ id: string }>(
      "insert into ia_connect.messages (organization_id, conversation_id, direction, channel, content) values ($1, $2, 'in', 'whatsapp', 'ciao') returning id",
      [orgId, ids[`conversation${suffix}`]],
    );
    if (suffix === "A") ids.messageA = message.id;
    ids[`flow${suffix}`] = (
      await one<{ id: string }>(
        "insert into ia_connect.flows (organization_id, name) values ($1, 'Flusso') returning id",
        [orgId],
      )
    ).id;
    ids[`version${suffix}`] = (
      await one<{ id: string }>(
        "insert into ia_connect.flow_versions (organization_id, flow_id, version, definition, author_type) values ($1, $2, 1, '{}', 'system') returning id",
        [orgId, ids[`flow${suffix}`]],
      )
    ).id;
    ids[`run${suffix}`] = (
      await one<{ id: string }>(
        "insert into ia_connect.flow_runs (organization_id, flow_id, flow_version_id) values ($1, $2, $3) returning id",
        [orgId, ids[`flow${suffix}`], ids[`version${suffix}`]],
      )
    ).id;
  }
  ids.stageA = (
    await one<{ id: string }>(
      "select id from ia_connect.deal_stages where organization_id = $1 and key = 'new'",
      [ids.orgA],
    )
  ).id;
});

afterAll(() => db.close());

describe("finding 1: connections are written by the server only", () => {
  it("refuses inserts, routing changes and deletes from a manager", async () => {
    await expect(
      db.asUser(
        ids.ownerA,
        "insert into ia_connect.connections (organization_id, connector_type, name, external_account_id, config) values ($1, 'whatsapp_meta', 'Furto', 'phone-B', '{\"phoneNumberId\":\"phone-B\"}')",
        [ids.orgA],
      ),
    ).rejects.toThrow(/permission denied/);
    for (const assignment of [
      "external_account_id = 'phone-B'",
      'config = \'{"phoneNumberId":"phone-B","accountAliases":["phone-B"]}\'',
      "webhook_token = 'known'",
      "status = 'active'",
      "connector_type = 'meta_social'",
    ]) {
      await expect(
        db.asUser(ids.ownerA, `update ia_connect.connections set ${assignment} where id = $1`, [
          ids.connectionA,
        ]),
        assignment,
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      db.asUser(ids.ownerA, "delete from ia_connect.connections where id = $1", [ids.connectionA]),
    ).rejects.toThrow(/permission denied/);
  });

  it("still lets a manager read and rename a connection, and nobody else's", async () => {
    const renamed = await db.asUser<{ name: string }>(
      ids.ownerA,
      "update ia_connect.connections set name = 'Numero principale' where id = $1 returning name",
      [ids.connectionA],
    );
    expect(renamed).toEqual([{ name: "Numero principale" }]);
    expect(
      await db.asUser(ids.ownerA, "update ia_connect.connections set name = 'x' where id = $1 returning id", [
        ids.connectionB,
      ]),
    ).toEqual([]);
    expect(
      await db.asUser(
        ids.memberA,
        "update ia_connect.connections set name = 'x' where id = $1 returning id",
        [ids.connectionA],
      ),
    ).toEqual([]);
  });

  it("keeps save_connection away from signed-in users", async () => {
    await expect(
      db.asUser(
        ids.ownerA,
        'select ia_connect.save_connection($1, $2, null, \'{"connector_type":"gmail"}\')',
        [ids.ownerA, ids.orgA],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.asUser(ids.ownerA, "select ia_connect.remove_connection($1, $2, $3)", [
        ids.ownerA,
        ids.orgA,
        ids.connectionA,
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it("save_connection writes for a manager and the audit row carries the real user", async () => {
    const created = await one<{ id: string; organization_id: string; status: string }>(
      "select (c).id, (c).organization_id, (c).status from ia_connect.save_connection($1, $2, null, $3::jsonb) c",
      [
        ids.ownerA,
        ids.orgA,
        JSON.stringify({ connector_type: "gmail", name: "Posta", external_account_id: "a@test.it" }),
      ],
    );
    expect(created.organization_id).toBe(ids.orgA);
    expect(created.status).toBe("active");
    const inserted = await one<{ actor_type: string; actor_id: string; is_support_access: boolean }>(
      "select actor_type, actor_id, is_support_access from ia_connect.audit_log where action = 'connections.insert' and entity_id = $1",
      [created.id],
    );
    expect(inserted).toEqual({ actor_type: "user", actor_id: ids.ownerA, is_support_access: false });

    // Platform staff acting on a customer's connection: logged as admin, with support access.
    await db.asService("select ia_connect.save_connection($1, $2, $3, $4::jsonb)", [
      ids.admin,
      ids.orgA,
      created.id,
      JSON.stringify({ status: "disconnected" }),
    ]);
    const updated = await one<{
      actor_type: string;
      actor_id: string;
      is_support_access: boolean;
      data: { changed: string[] };
    }>(
      "select actor_type, actor_id, is_support_access, data from ia_connect.audit_log where action = 'connections.update' and entity_id = $1",
      [created.id],
    );
    expect(updated.actor_type).toBe("admin");
    expect(updated.actor_id).toBe(ids.admin);
    expect(updated.is_support_access).toBe(true);
    expect(updated.data.changed).toEqual(["status"]);

    // The setting is transaction-local: the next worker write is "automation" again.
    await db.asService("update ia_connect.connections set last_error = 'x' where id = $1", [created.id]);
    const last = await one<{ actor_type: string; actor_id: string | null }>(
      "select actor_type, actor_id from ia_connect.audit_log where action = 'connections.update' and entity_id = $1 order by created_at desc, (actor_id is null) desc limit 1",
      [created.id],
    );
    expect(last).toEqual({ actor_type: "automation", actor_id: null });
  });

  it("save_connection refuses an actor who does not manage the organization", async () => {
    const values = JSON.stringify({ connector_type: "gmail", name: "x" });
    for (const actor of [ids.memberA, ids.ownerB, null]) {
      await expect(
        db.asService("select ia_connect.save_connection($1, $2, null, $3::jsonb)", [actor, ids.orgA, values]),
      ).rejects.toThrow(/not allowed/);
    }
    // An update cannot reach into another organization either.
    await expect(
      db.asService('select ia_connect.save_connection($1, $2, $3, \'{"status":"disconnected"}\'::jsonb)', [
        ids.ownerA,
        ids.orgA,
        ids.connectionB,
      ]),
    ).rejects.toThrow(/not found/);
  });

  it("save_connection enforces the catalog and the plan (finding 10)", async () => {
    await db.asService(
      "update ia_connect.connector_types set allowed_plans = '{business}' where key = 'payment_stripe'",
    );
    await db.asService("update ia_connect.connector_types set is_enabled = false where key = 'ghl_social'");
    for (const type of ["payment_stripe", "ghl_social", "does_not_exist"]) {
      await expect(
        db.asService("select ia_connect.save_connection($1, $2, null, $3::jsonb)", [
          ids.ownerA,
          ids.orgA,
          JSON.stringify({ connector_type: type }),
        ]),
        type,
      ).rejects.toThrow(/not available/);
    }
  });

  it("allows one live connection per provider account across all organizations", async () => {
    const steal = JSON.stringify({
      connector_type: "whatsapp_meta",
      external_account_id: "phone-B",
      config: { phoneNumberId: "phone-B" },
    });
    await expect(
      db.asService("select ia_connect.save_connection($1, $2, null, $3::jsonb)", [
        ids.ownerA,
        ids.orgA,
        steal,
      ]),
    ).rejects.toThrow(/connections_external_account_unique/);
    // The same site can be read by two customers.
    for (const [owner, org] of [
      [ids.ownerA, ids.orgA],
      [ids.ownerB, ids.orgB],
    ]) {
      await db.asService("select ia_connect.save_connection($1, $2, null, $3::jsonb)", [
        owner,
        org,
        JSON.stringify({ connector_type: "scraper_site", external_account_id: "www.example.com" }),
      ]);
    }
    // Once the other organization disconnects, the account is free again.
    await db.asService(
      'select ia_connect.save_connection($1, $2, $3, \'{"status":"disconnected"}\'::jsonb)',
      [ids.ownerB, ids.orgB, ids.connectionB],
    );
    const moved = await one<{ id: string }>(
      "select (c).id from ia_connect.save_connection($1, $2, null, $3::jsonb) c",
      [ids.ownerA, ids.orgA, steal],
    );
    // …and the old one cannot come back while the new one is live.
    await expect(
      db.asService('select ia_connect.save_connection($1, $2, $3, \'{"status":"active"}\'::jsonb)', [
        ids.ownerB,
        ids.orgB,
        ids.connectionB,
      ]),
    ).rejects.toThrow(/connections_external_account_unique/);
    await db.asService("select ia_connect.remove_connection($1, $2, $3)", [ids.ownerA, ids.orgA, moved.id]);
    await db.asService('select ia_connect.save_connection($1, $2, $3, \'{"status":"active"}\'::jsonb)', [
      ids.ownerB,
      ids.orgB,
      ids.connectionB,
    ]);
  });
});

describe("finding 4: invitations need a confirmed email", () => {
  it("ignores a user whose email was never confirmed", async () => {
    await db.asUser(
      ids.ownerA,
      "insert into ia_connect.invitations (organization_id, email, role, invited_by) values ($1, 'vittima@test.it', 'org_owner', $2)",
      [ids.orgA, ids.ownerA],
    );
    // Anyone can sign up in the shared Auth with somebody else's address.
    const squatter = (
      await one<{ id: string }>("insert into auth.users (email) values ('vittima@test.it') returning id")
    ).id;
    const accepted = await db.asUser<{ n: number }>(squatter, "select ia_connect.accept_invitations() as n");
    expect(accepted[0]!.n).toBe(0);
    expect(await db.asUser(squatter, "select id from ia_connect.organizations")).toEqual([]);
    const invitation = await one<{ status: string }>(
      "select status from ia_connect.invitations where email = 'vittima@test.it'",
    );
    expect(invitation.status).toBe("pending");

    await db.asService("update auth.users set email_confirmed_at = now() where id = $1", [squatter]);
    const later = await db.asUser<{ n: number }>(squatter, "select ia_connect.accept_invitations() as n");
    expect(later[0]!.n).toBe(1);
  });
});

describe("finding 5: references stay inside one organization", () => {
  it("has no single-column foreign key left between customer tables", async () => {
    const rows = await db.asService<{ child: string; col: string; parent: string }>(
      `select c.conrelid::regclass::text as child, a.attname as col, c.confrelid::regclass::text as parent
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and c.connamespace = 'ia_connect'::regnamespace
         and array_length(c.conkey, 1) = 1
         and c.confrelid <> 'ia_connect.organizations'::regclass
         and exists (select 1 from pg_attribute x where x.attrelid = c.conrelid and x.attname = 'organization_id' and not x.attisdropped)
         and exists (select 1 from pg_attribute x where x.attrelid = c.confrelid and x.attname = 'organization_id' and not x.attisdropped)`,
    );
    expect(rows).toEqual([]);
  });

  it("refuses rows of organization A that point at organization B", async () => {
    const attempts: [string, string, unknown[]][] = [
      [
        "messages.conversation_id",
        "insert into ia_connect.messages (organization_id, conversation_id, direction, channel, content) values ($1, $2, 'in', 'whatsapp', 'testo piantato')",
        [ids.orgA, ids.conversationB],
      ],
      [
        "conversations.contact_id",
        "insert into ia_connect.conversations (organization_id, contact_id, channel) values ($1, $2, 'whatsapp')",
        [ids.orgA, ids.contactB],
      ],
      [
        "deals.contact_id",
        "insert into ia_connect.deals (organization_id, contact_id, title, stage_id) values ($1, $2, 'x', $3)",
        [ids.orgA, ids.contactB, ids.stageA],
      ],
      [
        "flow_versions.flow_id",
        "insert into ia_connect.flow_versions (organization_id, flow_id, version, definition, author_type) values ($1, $2, 99, '{}', 'user')",
        [ids.orgA, ids.flowB],
      ],
      [
        "flows.active_version_id",
        "update ia_connect.flows set active_version_id = $2 where id = $1",
        [ids.flowA, ids.versionB],
      ],
      [
        "approvals.flow_run_id",
        "insert into ia_connect.approvals (organization_id, flow_run_id, step_id, summary) values ($1, $2, 'ok', 'x')",
        [ids.orgA, ids.runB],
      ],
      [
        "events.connection_id",
        "insert into ia_connect.events (organization_id, type, connection_id, dedupe_key) values ($1, 'manual.test', $2, 'fk-1')",
        [ids.orgA, ids.connectionB],
      ],
      [
        "scrape_recipes.connection_id",
        "insert into ia_connect.scrape_recipes (organization_id, name, target_url, connection_id) values ($1, 'x', 'https://example.com', $2)",
        [ids.orgA, ids.connectionB],
      ],
      [
        "conversations.connection_id",
        "update ia_connect.conversations set connection_id = $2 where id = $1",
        [ids.conversationA, ids.connectionB],
      ],
    ];
    for (const [label, sql, params] of attempts) {
      await expect(db.asUser(ids.ownerA, sql, params), label).rejects.toThrow(
        /foreign key|version of this flow/,
      );
    }
  });

  it("keeps the ON DELETE behaviours: SET NULL clears the reference only, CASCADE still works", async () => {
    const connection = await one<{ id: string }>(
      "insert into ia_connect.connections (organization_id, connector_type, name) values ($1, 'gmail', 'da togliere') returning id",
      [ids.orgA],
    );
    const event = await one<{ id: string }>(
      "insert into ia_connect.events (organization_id, type, connection_id, dedupe_key) values ($1, 'mail.received', $2, 'fk-2') returning id",
      [ids.orgA, connection.id],
    );
    await db.asService("delete from ia_connect.connections where id = $1", [connection.id]);
    const left = await one<{ organization_id: string; connection_id: string | null }>(
      "select organization_id, connection_id from ia_connect.events where id = $1",
      [event.id],
    );
    expect(left).toEqual({ organization_id: ids.orgA, connection_id: null });
  });

  it("does not let a customer's job take one of the worker's dedupe keys", async () => {
    const insert = (key: string | null) =>
      db.asUser(
        ids.ownerA,
        "insert into ia_connect.scheduled_jobs (organization_id, kind, payload, run_at, dedupe_key) values ($1, 'verify_connection', $2::jsonb, now() + interval '10 years', $3)",
        [ids.orgA, JSON.stringify({ connection_id: ids.connectionA }), key],
      );
    for (const key of [`verify:${ids.connectionA}`, `poll:${ids.connectionB}`, `report:${ids.orgB}`, "x"]) {
      await expect(insert(key), key).rejects.toThrow(/row-level security/);
    }
    await insert(`user:verify-now:${ids.connectionA}:1`);
    await insert(null);
    await expect(
      db.asUser(
        ids.ownerA,
        "insert into ia_connect.scheduled_jobs (organization_id, kind, run_at, flow_run_id) values ($1, 'send_message', now(), $2)",
        [ids.orgA, ids.runA],
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("finding 7: reserved event types cannot be inserted by customers", () => {
  const insert = (user: string, type: string, extra = "") =>
    db.asUser(
      user,
      `insert into ia_connect.events (organization_id, type, payload, dedupe_key${extra ? ", status" : ""}) values ($1, $2, '{"from":"+393330000001","text":"ciao"}', $3${extra})`,
      [ids.orgA, type, `forged-${type}-${Math.random()}`],
    );

  it("refuses inbound messages, delivery statuses, payments and the other connector events", async () => {
    for (const type of [
      "whatsapp.message.received",
      "whatsapp.status.updated",
      "mail.received",
      "sms.received",
      "social.message.received",
      "social.lead.received",
      "payment.completed",
      "signature.completed",
      "scrape.item.found",
      "appointment.booked",
      "custom.",
      "anything",
    ]) {
      await expect(insert(ids.ownerA, type), type).rejects.toThrow(/row-level security/);
    }
  });

  it("accepts test events and the open business types, pending only, from managers only", async () => {
    for (const type of ["manual.test", "custom.richiesta_sito", ...OPEN_EVENT_TYPES])
      await insert(ids.ownerA, type);
    await expect(insert(ids.ownerA, "manual.test", ", 'processed'")).rejects.toThrow(/row-level security/);
    await expect(insert(ids.memberA, "manual.test")).rejects.toThrow(/row-level security/);
    await expect(insert(ids.ownerB, "manual.test")).rejects.toThrow(/row-level security/);
  });

  it("uses the same allow-list as packages/core", async () => {
    for (const type of [
      ...OPEN_EVENT_TYPES,
      "custom.a_b.c",
      "custom.",
      "custom.A",
      "manual.test",
      "whatsapp.message.received",
      "payment.completed",
      "order.created ",
    ]) {
      const row = await one<{ open: boolean }>("select ia_connect.is_open_event_type($1) as open", [type]);
      expect(row.open, type).toBe(isOpenEventType(type));
    }
  });
});

describe("finding 8: audit rows cannot be forged", () => {
  it("refuses direct inserts into audit_log", async () => {
    await expect(
      db.asUser(
        ids.memberA,
        "insert into ia_connect.audit_log (organization_id, actor_type, actor_id, action, is_support_access, created_at) values ($1, 'admin', $2, 'organization.export', true, now() - interval '1 year')",
        [ids.orgA, ids.memberA],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("log_action records who really acted", async () => {
    await db.asUser(
      ids.memberA,
      "select ia_connect.log_action($1, 'organization.export', 'organizations', $1, '{\"rows\": 3}')",
      [ids.orgA],
    );
    await db.asUser(ids.admin, "select ia_connect.log_action($1, 'organization.export')", [ids.orgA]);
    const rows = await db.asService<{
      actor_type: string;
      actor_id: string;
      is_support_access: boolean;
      fresh: boolean;
    }>(
      "select actor_type, actor_id, is_support_access, created_at > now() - interval '1 minute' as fresh from ia_connect.audit_log where action = 'organization.export' order by actor_type desc",
    );
    expect(rows).toEqual([
      { actor_type: "user", actor_id: ids.memberA, is_support_access: false, fresh: true },
      { actor_type: "admin", actor_id: ids.admin, is_support_access: true, fresh: true },
    ]);
  });

  it("log_action refuses outsiders, anonymous callers and trigger-like actions", async () => {
    await expect(
      db.asUser(ids.ownerB, "select ia_connect.log_action($1, 'organization.export')", [ids.orgA]),
    ).rejects.toThrow(/not allowed/);
    await expect(
      db.asUser("", "select ia_connect.log_action($1, 'organization.export')", [ids.orgA]),
    ).rejects.toThrow(/not allowed/);
    for (const action of ["connections.insert", "memberships.delete", "Some Text", "x"]) {
      await expect(
        db.asUser(ids.memberA, "select ia_connect.log_action($1, $2)", [ids.orgA, action]),
        action,
      ).rejects.toThrow(/invalid audit action/);
    }
  });
});

describe("finding 10: flow limits are enforced by the database", () => {
  it("requires the active version to be a version of that flow", async () => {
    await expect(
      db.asUser(ids.ownerA, "update ia_connect.flows set status = 'active' where id = $1", [ids.flowA]),
    ).rejects.toThrow(/needs an active version/);
    const other = await one<{ id: string }>(
      "insert into ia_connect.flows (organization_id, name) values ($1, 'Altro') returning id",
      [ids.orgA],
    );
    await expect(
      db.asUser(
        ids.ownerA,
        "update ia_connect.flows set active_version_id = $2, status = 'active' where id = $1",
        [other.id, ids.versionA],
      ),
    ).rejects.toThrow(/must be a version of this flow/);
    await expect(
      db.asUser(
        ids.ownerA,
        "insert into ia_connect.flows (organization_id, name, status) values ($1, 'Subito attivo', 'active')",
        [ids.orgA],
      ),
    ).rejects.toThrow(/needs an active version/);
  });

  it("stops at the plan's active_flows", async () => {
    await db.asService(
      `update ia_connect.plans set limits = limits || '{"active_flows": 2}' where key = 'starter'`,
    );
    const activate = async (name: string) => {
      const flow = await one<{ id: string }>(
        "insert into ia_connect.flows (organization_id, name) values ($1, $2) returning id",
        [ids.orgA, name],
      );
      const version = await one<{ id: string }>(
        "insert into ia_connect.flow_versions (organization_id, flow_id, version, definition, author_type) values ($1, $2, 1, '{}', 'user') returning id",
        [ids.orgA, flow.id],
      );
      return db.asUser(
        ids.ownerA,
        "update ia_connect.flows set active_version_id = $2, status = 'active' where id = $1 returning id",
        [flow.id, version.id],
      );
    };
    expect(await activate("uno")).toHaveLength(1);
    expect(await activate("due")).toHaveLength(1);
    await expect(activate("tre")).rejects.toThrow(/active_flows limit/);
    // An already active flow can still be edited; pausing one frees a place.
    await db.asUser(ids.ownerA, "update ia_connect.flows set description = 'x' where organization_id = $1", [
      ids.orgA,
    ]);
    await db.asUser(
      ids.ownerA,
      "update ia_connect.flows set status = 'paused' where organization_id = $1 and name = 'uno'",
      [ids.orgA],
    );
    expect(await activate("tre")).toHaveLength(1);
  });
});

describe("finding 11: no user is not the service role", () => {
  it("keeps delete_organization for the service role", async () => {
    for (const user of [ids.ownerA, ids.admin, ""]) {
      await expect(
        db.asUser(user, "select ia_connect.delete_organization($1)", [ids.orgA]),
        user || "anonymous",
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      db.asUser("", "select ia_connect.admin_delete_organization($1)", [ids.orgA]),
    ).rejects.toThrow(/not allowed/);
    expect(
      await db.asService("select id from ia_connect.organizations where id = $1", [ids.orgA]),
    ).toHaveLength(1);
  });

  it("answers quota_left only to members and to the service role", async () => {
    const ask = async (user: string) =>
      (
        await db.asUser<{ left: string | null }>(
          user,
          "select ia_connect.quota_left($1, 'messages') as left",
          [ids.orgA],
        )
      )[0]?.left ?? null;
    expect(await ask("")).toBeNull();
    expect(await ask(ids.ownerB)).toBeNull();
    expect(Number(await ask(ids.memberA))).toBe(1000);
    const service = await one<{ left: string }>("select ia_connect.quota_left($1, 'messages') as left", [
      ids.orgA,
    ]);
    expect(Number(service.left)).toBe(1000);
  });
});

describe("finding 12: support sessions cannot be reassigned", () => {
  it("freezes organization, admin and start", async () => {
    const session = (
      await db.asUser<{ id: string }>(
        ids.admin,
        "insert into ia_connect.support_sessions (organization_id, admin_user_id, reason) values ($1, $2, 'verifica') returning id",
        [ids.orgA, ids.admin],
      )
    )[0]!;
    for (const assignment of [
      `admin_user_id = '${ids.ownerA}'`,
      "started_at = now() - interval '1 year'",
      `organization_id = '${ids.orgB}'`,
    ]) {
      await expect(
        db.asUser(ids.admin, `update ia_connect.support_sessions set ${assignment} where id = $1`, [
          session.id,
        ]),
        assignment,
      ).rejects.toThrow(/cannot be reassigned|row-level security/);
    }
    const ended = await db.asUser(
      ids.admin,
      "update ia_connect.support_sessions set ended_at = now() where id = $1 returning id",
      [session.id],
    );
    expect(ended).toHaveLength(1);
  });
});

describe("finding 17: fairness and message history", () => {
  it("does not let members rewrite or delete messages, and still lets them mark one as failed", async () => {
    for (const assignment of [
      "content = 'mai detto'",
      "direction = 'out'",
      "external_id = 'x'",
      `conversation_id = '${ids.conversationB}'`,
    ]) {
      await expect(
        db.asUser(ids.memberA, `update ia_connect.messages set ${assignment} where id = $1`, [ids.messageA]),
        assignment,
      ).rejects.toThrow(/cannot be edited|foreign key/);
    }
    const marked = await db.asUser(
      ids.memberA,
      "update ia_connect.messages set delivery_status = 'failed', error = 'non partito' where id = $1 returning id",
      [ids.messageA],
    );
    expect(marked).toHaveLength(1);
    await expect(
      db.asUser(ids.memberA, "delete from ia_connect.messages where id = $1", [ids.messageA]),
    ).rejects.toThrow(/permission denied/);
    // The worker keeps full control.
    await db.asService("update ia_connect.messages set external_id = 'wamid.1' where id = $1", [
      ids.messageA,
    ]);
  });

  it("still removes conversations and messages with their contact", async () => {
    const contact = await one<{ id: string }>(
      "insert into ia_connect.contacts (organization_id, full_name) values ($1, 'Da cancellare') returning id",
      [ids.orgA],
    );
    const conversation = await one<{ id: string }>(
      "insert into ia_connect.conversations (organization_id, contact_id, channel) values ($1, $2, 'mail') returning id",
      [ids.orgA, contact.id],
    );
    await db.asService(
      "insert into ia_connect.messages (organization_id, conversation_id, direction, channel, content) values ($1, $2, 'in', 'mail', 'x')",
      [ids.orgA, conversation.id],
    );
    const deleted = await db.asUser(
      ids.memberA,
      "delete from ia_connect.contacts where id = $1 returning id",
      [contact.id],
    );
    expect(deleted).toHaveLength(1);
    const left = await one<{ n: number }>(
      "select count(*)::int as n from ia_connect.messages where conversation_id = $1",
      [conversation.id],
    );
    expect(left.n).toBe(0);
  });

  it("caps the pending jobs and events a single organization can queue", async () => {
    await db.asService("delete from ia_connect.scheduled_jobs where organization_id = $1", [ids.orgA]);
    await db.asService("delete from ia_connect.events where organization_id = $1", [ids.orgA]);
    const job = () =>
      db.asUser(
        ids.ownerA,
        "insert into ia_connect.scheduled_jobs (organization_id, kind, run_at) values ($1, 'simulate_flow', now())",
        [ids.orgA],
      );
    for (let i = 0; i < 50; i++) await job();
    await expect(job()).rejects.toThrow(/too many pending jobs/);
    // Another organization and the worker are not affected; finished jobs free the queue.
    await db.asUser(
      ids.ownerB,
      "insert into ia_connect.scheduled_jobs (organization_id, kind, run_at) values ($1, 'simulate_flow', now())",
      [ids.orgB],
    );
    await db.asService(
      "insert into ia_connect.scheduled_jobs (organization_id, kind, run_at, created_by) values ($1, 'report', now(), null)",
      [ids.orgA],
    );
    await db.asService("update ia_connect.scheduled_jobs set status = 'done' where organization_id = $1", [
      ids.orgA,
    ]);
    await job();

    const event = (n: number) =>
      db.asUser(
        ids.ownerA,
        "insert into ia_connect.events (organization_id, type, dedupe_key) values ($1, 'manual.test', $2)",
        [ids.orgA, `cap-${n}`],
      );
    for (let i = 0; i < 100; i++) await event(i);
    await expect(event(100)).rejects.toThrow(/too many pending events/);
    await db.asService(
      "insert into ia_connect.events (organization_id, type, dedupe_key) values ($1, 'mail.received', 'worker-1')",
      [ids.orgA],
    );
  });
});

describe("organization export", () => {
  it("does not include webhook tokens", async () => {
    const rows = await db.asUser<{ data: { connections: Record<string, unknown>[] } }>(
      ids.ownerA,
      "select ia_connect.export_organization($1) as data",
      [ids.orgA],
    );
    const connections = rows[0]!.data.connections;
    expect(connections.length).toBeGreaterThan(0);
    for (const connection of connections) {
      expect(connection).not.toHaveProperty("webhook_token");
      expect(connection).toHaveProperty("connector_type");
    }
    expect(JSON.stringify(rows[0]!.data)).not.toMatch(/webhook_token/);
  });
});
