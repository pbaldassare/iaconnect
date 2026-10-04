import { SECTORS } from "@ia-connect/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestDb, createTestDb } from "./db";

/**
 * Pins migration 20261004002000_access_requests.sql: anyone with a confirmed email can ask for
 * access, only a platform admin turns the request into an organization.
 */

let db: TestDb;
const ids = {} as Record<
  "admin" | "resellerAdmin" | "anna" | "bruno" | "carla" | "dario" | "unconfirmed" | "member" | "orgA",
  string
>;

interface RequestRow {
  id: string;
  user_id: string;
  full_name: string | null;
  company_name: string;
  sector: string;
  phone: string | null;
  message: string | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  organization_id: string | null;
}

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.asService<T>(sql, params))[0]!;
}

const REQUEST = "select * from ia_connect.request_access($1, $2, $3, $4, $5)";
function request(user: string, company = "Rossi Assicurazioni", extra: Partial<Record<string, string>> = {}) {
  return db.asUser<RequestRow>(user, REQUEST, [
    extra.full_name ?? "Anna Rossi",
    company,
    extra.sector ?? "insurance",
    extra.phone ?? "+39 333 0000000",
    extra.message ?? "Vorrei provare.",
  ]);
}
const DECIDE = "select * from ia_connect.decide_access_request($1, $2, $3, $4)";
function decide(
  user: string,
  requestId: string,
  approve: boolean,
  plan = "starter",
  note: string | null = null,
) {
  return db.asUser<RequestRow>(user, DECIDE, [requestId, approve, plan, note]);
}

beforeAll(async () => {
  db = await createTestDb();
  for (const name of ["admin", "resellerAdmin", "anna", "bruno", "carla", "dario", "member"] as const) {
    ids[name] = (
      await one<{ id: string }>(
        "insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id",
        [`${name}@test.it`],
      )
    ).id;
  }
  ids.unconfirmed = (
    await one<{ id: string }>("insert into auth.users (email) values ('unconfirmed@test.it') returning id")
  ).id;
  const reseller = (await one<{ id: string }>("select id from ia_connect.resellers where slug = 'default'"))
    .id;
  const plan = (await one<{ id: string }>("select id from ia_connect.plans where key = 'starter'")).id;
  ids.orgA = (
    await one<{ id: string }>(
      "insert into ia_connect.organizations (reseller_id, name, sector, plan_id) values ($1, 'orgA', 'insurance', $2) returning id",
      [reseller, plan],
    )
  ).id;
  await db.asService("insert into ia_connect.memberships (user_id, role) values ($1, 'platform_admin')", [
    ids.admin,
  ]);
  await db.asService(
    "insert into ia_connect.memberships (user_id, reseller_id, role) values ($1, $2, 'reseller_admin')",
    [ids.resellerAdmin, reseller],
  );
  await db.asService(
    "insert into ia_connect.memberships (user_id, organization_id, role) values ($1, $2, 'org_member')",
    [ids.member, ids.orgA],
  );
});

afterAll(() => db.close());

describe("request_access", () => {
  it("refuses anonymous callers and accounts whose email was never confirmed", async () => {
    await expect(request("")).rejects.toThrow(/not allowed/);
    await expect(request(ids.unconfirmed)).rejects.toThrow(/not confirmed/);
    expect(await db.asService("select id from ia_connect.access_requests")).toEqual([]);
  });

  it("creates a pending request with trimmed values", async () => {
    const [row] = await request(ids.anna, "  Rossi Assicurazioni  ", { phone: "  ", message: "" });
    expect(row).toMatchObject({
      user_id: ids.anna,
      full_name: "Anna Rossi",
      company_name: "Rossi Assicurazioni",
      sector: "insurance",
      phone: null,
      message: null,
      status: "pending",
      organization_id: null,
    });
  });

  it("lets the user change the request while it is pending, without creating a second one", async () => {
    const [row] = await request(ids.anna, "Rossi & Figli", { sector: "real_estate" });
    expect(row).toMatchObject({ company_name: "Rossi & Figli", sector: "real_estate", status: "pending" });
    const count = await one<{ n: number }>(
      "select count(*)::int as n from ia_connect.access_requests where user_id = $1",
      [ids.anna],
    );
    expect(count.n).toBe(1);
  });

  it("shows a user only their own request; the platform admin sees all; reseller admins none", async () => {
    await request(ids.bruno, "Bruno Shop", { sector: "ecommerce" });
    const mine = await db.asUser<RequestRow>(ids.anna, "select * from ia_connect.access_requests");
    expect(mine.map((row) => row.user_id)).toEqual([ids.anna]);
    const all = await db.asUser<RequestRow>(ids.admin, "select * from ia_connect.access_requests");
    expect(all.map((row) => row.user_id).sort()).toEqual([ids.anna, ids.bruno].sort());
    expect(await db.asUser(ids.resellerAdmin, "select * from ia_connect.access_requests")).toEqual([]);
    expect(await db.asUser(ids.member, "select * from ia_connect.access_requests")).toEqual([]);
  });

  it("cannot be written directly, not even one's own row", async () => {
    await expect(
      db.asUser(
        ids.carla,
        "insert into ia_connect.access_requests (user_id, company_name) values ($1, 'x y')",
        [ids.carla],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.asUser(ids.anna, "update ia_connect.access_requests set status = 'approved' where user_id = $1", [
        ids.anna,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.asUser(ids.anna, "delete from ia_connect.access_requests where user_id = $1", [ids.anna]),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses members of an organization and staff", async () => {
    await expect(request(ids.member)).rejects.toThrow(/already has access/);
    await expect(request(ids.admin)).rejects.toThrow(/already has access/);
    await expect(request(ids.resellerAdmin)).rejects.toThrow(/already has access/);
  });

  it("enforces the text limits and the sector list", async () => {
    await expect(request(ids.carla, "")).rejects.toThrow(/company name/);
    await expect(request(ids.carla, "   ")).rejects.toThrow(/company name/);
    await expect(request(ids.carla, "x")).rejects.toThrow(/company name/);
    await expect(request(ids.carla, "x".repeat(121))).rejects.toThrow(/company name/);
    await expect(request(ids.carla, "Carla Srl", { full_name: "x".repeat(121) })).rejects.toThrow(/too long/);
    await expect(request(ids.carla, "Carla Srl", { phone: "1".repeat(41) })).rejects.toThrow(/too long/);
    await expect(request(ids.carla, "Carla Srl", { message: "x".repeat(1001) })).rejects.toThrow(/too long/);
    await expect(request(ids.carla, "Carla Srl", { sector: "banking" })).rejects.toThrow(/unknown sector/);
    expect(
      await db.asService("select id from ia_connect.access_requests where user_id = $1", [ids.carla]),
    ).toEqual([]);
    // At the limit it passes.
    const [row] = await request(ids.carla, "x".repeat(120), { message: "x".repeat(1000) });
    expect(row!.status).toBe("pending");
  });

  it("accepts exactly the sectors of packages/core", async () => {
    const constraint = await one<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def from pg_constraint c
       where c.conrelid = 'ia_connect.access_requests'::regclass and c.conname = 'access_requests_sector_check'`,
    );
    const allowed = [...constraint.def.matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]).sort();
    expect(allowed).toEqual([...SECTORS].sort());
    for (const sector of SECTORS) {
      const [row] = await request(ids.dario, "Dario Srl", { sector });
      expect(row!.sector).toBe(sector);
    }
  });
});

describe("decide_access_request", () => {
  const requestOf = async (user: string) =>
    (await one<RequestRow>("select * from ia_connect.access_requests where user_id = $1", [user])).id;

  it("is refused to the requester, to other customers, to reseller admins and to anonymous callers", async () => {
    const id = await requestOf(ids.anna);
    for (const user of [ids.anna, ids.bruno, ids.member, ids.resellerAdmin, ""]) {
      await expect(decide(user, id, true), user).rejects.toThrow(/not allowed/);
    }
    const row = await one<RequestRow>("select * from ia_connect.access_requests where id = $1", [id]);
    expect(row.status).toBe("pending");
    expect(await db.asUser(ids.anna, "select id from ia_connect.organizations")).toEqual([]);
  });

  it("approval creates the organization and the owner membership, audited as the admin", async () => {
    const id = await requestOf(ids.anna);
    const [row] = await decide(ids.admin, id, true, "pro", "Benvenuti");
    expect(row).toMatchObject({ status: "approved", decided_by: ids.admin, decision_note: "Benvenuti" });
    expect(row!.decided_at).not.toBeNull();
    expect(row!.organization_id).not.toBeNull();

    const organization = await one<{
      name: string;
      sector: string;
      plan: string;
      reseller: string;
      status: string;
    }>(
      `select o.name, o.sector, p.key as plan, r.slug as reseller, o.status
       from ia_connect.organizations o
       join ia_connect.plans p on p.id = o.plan_id join ia_connect.resellers r on r.id = o.reseller_id
       where o.id = $1`,
      [row!.organization_id],
    );
    expect(organization).toEqual({
      name: "Rossi & Figli",
      sector: "real_estate",
      plan: "pro",
      reseller: "default",
      status: "active",
    });

    // The user now sees the organization and manages it; the defaults of a new organization exist.
    const visible = await db.asUser<{ id: string }>(ids.anna, "select id from ia_connect.organizations");
    expect(visible.map((o) => o.id)).toEqual([row!.organization_id]);
    const membership = await db.asUser<{ role: string }>(
      ids.anna,
      "select role from ia_connect.memberships where user_id = $1",
      [ids.anna],
    );
    expect(membership).toEqual([{ role: "org_owner" }]);
    const manages = await db.asUser<{ ok: boolean }>(ids.anna, "select ia_connect.can_manage_org($1) as ok", [
      row!.organization_id,
    ]);
    expect(manages[0]!.ok).toBe(true);
    const stages = await db.asUser(ids.anna, "select id from ia_connect.deal_stages");
    expect(stages.length).toBeGreaterThan(0);

    const audit = await db.asService<{ action: string; actor_type: string; actor_id: string }>(
      "select action, actor_type, actor_id from ia_connect.audit_log where organization_id = $1 and action in ('organizations.insert', 'memberships.insert', 'access_request.approve') order by action",
      [row!.organization_id],
    );
    expect(audit).toEqual([
      { action: "access_request.approve", actor_type: "admin", actor_id: ids.admin },
      { action: "memberships.insert", actor_type: "admin", actor_id: ids.admin },
      { action: "organizations.insert", actor_type: "admin", actor_id: ids.admin },
    ]);
  });

  it("refuses a second decision and a new request from the approved user", async () => {
    const id = await requestOf(ids.anna);
    await expect(decide(ids.admin, id, true)).rejects.toThrow(/already decided/);
    await expect(decide(ids.admin, id, false)).rejects.toThrow(/already decided/);
    await expect(request(ids.anna)).rejects.toThrow(/already has access/);
    const organizations = await one<{ n: number }>(
      "select count(*)::int as n from ia_connect.organizations where name = 'Rossi & Figli'",
    );
    expect(organizations.n).toBe(1);
  });

  it("an approved user who lost the membership cannot open the same request again", async () => {
    const id = await requestOf(ids.dario);
    const [approved] = await decide(ids.admin, id, true);
    await db.asService("delete from ia_connect.memberships where user_id = $1", [ids.dario]);
    await expect(request(ids.dario, "Dario Srl")).rejects.toThrow(/already approved/);
    // Deleting the organization keeps the request, without the reference.
    await db.asService("delete from ia_connect.organizations where id = $1", [approved!.organization_id]);
    const row = await one<RequestRow>("select * from ia_connect.access_requests where id = $1", [id]);
    expect(row).toMatchObject({ status: "approved", organization_id: null });
  });

  it("rejection keeps the note, creates nothing, and the user can submit again", async () => {
    const id = await requestOf(ids.bruno);
    const [rejected] = await decide(ids.admin, id, false, "starter", "Dati incompleti");
    expect(rejected).toMatchObject({
      status: "rejected",
      decided_by: ids.admin,
      decision_note: "Dati incompleti",
      organization_id: null,
    });
    expect(await db.asUser(ids.bruno, "select id from ia_connect.organizations")).toEqual([]);
    expect(await db.asUser(ids.bruno, "select id from ia_connect.memberships")).toEqual([]);
    const own = await db.asUser<RequestRow>(ids.bruno, "select * from ia_connect.access_requests");
    expect(own[0]).toMatchObject({ status: "rejected", decision_note: "Dati incompleti" });

    const [again] = await request(ids.bruno, "Bruno Shop Srl", { sector: "ecommerce" });
    expect(again).toMatchObject({
      id,
      status: "pending",
      company_name: "Bruno Shop Srl",
      decided_by: null,
      decided_at: null,
      decision_note: null,
    });
    const [approved] = await decide(ids.admin, id, true);
    expect(approved!.status).toBe("approved");
  });

  it("refuses an unknown or inactive plan, an unknown request and a note that is too long", async () => {
    const id = await requestOf(ids.carla);
    await expect(decide(ids.admin, id, true, "platinum")).rejects.toThrow(/unknown plan/);
    await db.asService("update ia_connect.plans set is_active = false where key = 'business'");
    await expect(decide(ids.admin, id, true, "business")).rejects.toThrow(/unknown plan/);
    await expect(decide(ids.admin, id, false, "starter", "x".repeat(1001))).rejects.toThrow(/too long/);
    await expect(decide(ids.admin, "00000000-0000-0000-0000-000000000000", true)).rejects.toThrow(
      /not found/,
    );
    const row = await one<RequestRow>("select * from ia_connect.access_requests where id = $1", [id]);
    expect(row.status).toBe("pending");
  });

  it("removes the request together with the auth user", async () => {
    const id = await requestOf(ids.carla);
    await db.asService("delete from auth.users where id = $1", [ids.carla]);
    expect(await db.asService("select id from ia_connect.access_requests where id = $1", [id])).toEqual([]);
  });
});

describe("the table next to the customer tables", () => {
  it("has row level security, a single select policy, and no write privilege for signed-in users", async () => {
    const policies = await db.asService<{ policyname: string; cmd: string }>(
      "select policyname, cmd from pg_policies where schemaname = 'ia_connect' and tablename = 'access_requests'",
    );
    expect(policies).toEqual([{ policyname: "request_read", cmd: "SELECT" }]);
    const privileges = await db.asService<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
       where table_schema = 'ia_connect' and table_name = 'access_requests' and grantee = 'authenticated'`,
    );
    expect(privileges.map((row) => row.privilege_type)).toEqual(["SELECT"]);
  });

  it("does not show a request to the other members of the organization it created", async () => {
    // organization_id here is "the organization this request became", not a tenant column:
    // a colleague invited later must not read the owner's request (phone, note).
    const anna = await one<RequestRow>("select * from ia_connect.access_requests where user_id = $1", [
      ids.anna,
    ]);
    await db.asService(
      "insert into ia_connect.memberships (user_id, organization_id, role) values ($1, $2, 'org_owner')",
      [ids.member, anna.organization_id],
    );
    expect(await db.asUser(ids.member, "select id from ia_connect.access_requests")).toEqual([]);
  });
});
