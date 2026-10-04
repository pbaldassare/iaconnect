import { FlowDefinitionSchema, ScrapeRecipeSchema } from "@ia-connect/core";
import { describe, expect, it } from "vitest";
import { safeInternalLink } from "../src/lib/customer-labels";
import { type DemoTables, createDemoClient } from "../src/lib/demo/client";
import {
  DEMO_COLLEAGUE_ID,
  DEMO_ORG_ID,
  DEMO_USER_EMAILS,
  DEMO_USER_ID,
  buildDemoData,
  demoId,
} from "../src/lib/demo/fixtures";
import { isUuid } from "../src/lib/org-selection";

const NOW = new Date("2026-10-04T16:30:00.000Z");
const { tables, rpc } = buildDemoData(NOW);
type AnyRow = Record<string, unknown>;
const all = tables as Record<string, AnyRow[]>;
const DEMO_ID = /[0-9a-f]{8}-0000-4000-8000-[0-9a-f]{12}/g;

/** Every id a fixture row may point to: the rows themselves and the made-up users. */
const known = new Set<string>([DEMO_USER_ID, DEMO_COLLEAGUE_ID, demoId(4, 9)]);
for (const rows of Object.values(all))
  for (const row of rows) if (typeof row.id === "string") known.add(row.id);
const idsOf = (table: string) => new Set((all[table] ?? []).map((row) => row.id as string));

/** Column → table it must point to. `active_version_id` depends on the table that holds it. */
const FOREIGN: Record<string, string> = {
  organization_id: "organizations",
  reseller_id: "resellers",
  plan_id: "plans",
  contact_id: "contacts",
  deal_id: "deals",
  connection_id: "connections",
  conversation_id: "conversations",
  flow_id: "flows",
  flow_version_id: "flow_versions",
  flow_run_id: "flow_runs",
  origin_flow_run_id: "flow_runs",
  flow_run_step_id: "flow_run_steps",
  event_id: "events",
  stage_id: "deal_stages",
  from_stage_id: "deal_stages",
  to_stage_id: "deal_stages",
  template_id: "message_templates",
  recipe_id: "scrape_recipes",
  recipe_version_id: "scrape_recipe_versions",
};
const USER_COLUMNS = [
  "user_id",
  "assignee_user_id",
  "sent_by_user_id",
  "decided_by",
  "invited_by",
  "author_id",
  "created_by",
  "admin_user_id",
  "actor_id",
];

function walk(value: unknown, visit: (text: string) => void): void {
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) for (const item of value) walk(item, visit);
  else if (value && typeof value === "object") for (const item of Object.values(value)) walk(item, visit);
}

describe("demo fixtures: consistency", () => {
  it("every table has rows with unique, uuid-shaped ids", () => {
    for (const [table, rows] of Object.entries(all)) {
      const ids = rows.flatMap((row) => (typeof row.id === "string" ? [row.id] : []));
      expect(new Set(ids).size, table).toBe(ids.length);
      for (const id of ids) expect(isUuid(id), `${table} ${id}`).toBe(true);
    }
  });

  it("every foreign key column points to an existing row", () => {
    for (const [table, rows] of Object.entries(all)) {
      for (const row of rows) {
        for (const [column, target] of Object.entries(FOREIGN)) {
          const value = row[column];
          if (value === null || value === undefined) continue;
          expect(idsOf(target).has(value as string), `${table}.${column} = ${value}`).toBe(true);
        }
        for (const column of USER_COLUMNS) {
          const value = row[column];
          if (value === null || value === undefined) continue;
          expect(known.has(value as string), `${table}.${column} = ${value}`).toBe(true);
        }
      }
    }
    for (const flow of all.flows!) {
      if (flow.active_version_id)
        expect(idsOf("flow_versions").has(flow.active_version_id as string)).toBe(true);
    }
    for (const recipe of all.scrape_recipes!) {
      expect(idsOf("scrape_recipe_versions").has(recipe.active_version_id as string)).toBe(true);
    }
  });

  it("every id written anywhere inside a row (JSON, links, texts) exists", () => {
    for (const [table, rows] of Object.entries(all)) {
      for (const row of rows) {
        walk(row, (text) => {
          for (const id of text.match(DEMO_ID) ?? [])
            expect(known.has(id), `${table}: ${id} in "${text}"`).toBe(true);
        });
      }
    }
  });

  it("everything belongs to the one demo organization", () => {
    expect(all.organizations).toHaveLength(1);
    for (const [table, rows] of Object.entries(all)) {
      for (const row of rows) {
        if ("organization_id" in row) expect(row.organization_id, table).toBe(DEMO_ORG_ID);
      }
    }
  });

  it("audit rows name an existing row of the table they mention", () => {
    for (const row of all.audit_log!) {
      if (!row.entity_type || !row.entity_id) continue;
      expect(idsOf(row.entity_type as string).has(row.entity_id as string), `${row.action}`).toBe(true);
    }
  });

  it("notification links are in-app pages", () => {
    for (const row of all.notifications!) {
      if (row.link) expect(safeInternalLink(row.link as string), String(row.link)).toBe(row.link);
    }
  });

  it("flow definitions pass the core schema and runs stand on steps that exist", () => {
    const steps = new Map<string, Set<string>>();
    for (const version of all.flow_versions!) {
      const parsed = FlowDefinitionSchema.safeParse(version.definition);
      expect(parsed.success, `flow version ${version.version} of ${version.flow_id}`).toBe(true);
      if (parsed.success) steps.set(version.id as string, new Set(parsed.data.steps.map((step) => step.id)));
    }
    const runs = new Map(all.flow_runs!.map((run) => [run.id as string, run]));
    for (const run of all.flow_runs!) {
      if (run.current_step_id) {
        expect(steps.get(run.flow_version_id as string)?.has(run.current_step_id as string)).toBe(true);
      }
    }
    for (const step of all.flow_run_steps!) {
      const run = runs.get(step.flow_run_id as string)!;
      expect(steps.get(run.flow_version_id as string)?.has(step.step_id as string), `${step.step_id}`).toBe(
        true,
      );
    }
    for (const approval of all.approvals!) {
      const run = runs.get(approval.flow_run_id as string)!;
      expect(steps.get(run.flow_version_id as string)?.has(approval.step_id as string)).toBe(true);
    }
    // One version of the pilot flow is authored by the AI.
    expect(all.flow_versions!.some((version) => version.author_type === "ai")).toBe(true);
  });

  it("scrape recipes pass the core schema", () => {
    for (const version of all.scrape_recipe_versions!) {
      expect(ScrapeRecipeSchema.safeParse(version.recipe).success).toBe(true);
    }
  });

  it("deals sit in existing stages and closed ones have a closing date", () => {
    const kinds = new Map(all.deal_stages!.map((stage) => [stage.id as string, stage.kind as string]));
    for (const deal of all.deals!) {
      const kind = kinds.get(deal.stage_id as string);
      expect(Boolean(deal.closed_at), String(deal.title)).toBe(kind !== "open");
    }
  });

  it("uses only made-up contact details", () => {
    for (const contact of all.contacts!) {
      for (const phone of contact.phones as string[]) expect(phone).toMatch(/^\+3933300000\d\d$/);
      for (const mail of contact.emails as string[]) expect(mail).toMatch(/\.example$/);
    }
    for (const mail of Object.values(DEMO_USER_EMAILS)) expect(mail).toMatch(/\.example$/);
    for (const invitation of all.invitations!) expect(invitation.email).toMatch(/\.example$/);
  });

  it("covers the states the pages are meant to show", () => {
    const statuses = (table: string, column = "status") => new Set(all[table]!.map((row) => row[column]));
    expect(statuses("connections")).toEqual(new Set(["active", "expired"]));
    expect(statuses("flows")).toEqual(new Set(["active", "paused", "draft"]));
    expect([...statuses("flow_runs")]).toEqual(expect.arrayContaining(["completed", "waiting", "failed"]));
    expect(statuses("flow_runs", "mode")).toEqual(new Set(["live", "simulation"]));
    expect([...statuses("message_templates", "approval_status")]).toEqual(
      expect.arrayContaining(["approved", "pending"]),
    );
    expect(statuses("approvals")).toEqual(new Set(["pending", "approved", "rejected"]));
    expect([...statuses("messages", "delivery_status")]).toContain("failed");
    expect(all.messages!.some((message) => message.ai_generated)).toBe(true);
    expect(all.messages!.some((message) => message.sent_by_user_id)).toBe(true);
    expect(all.messages!.some((message) => message.template_id)).toBe(true);
    expect(all.audit_log!.some((row) => row.is_support_access)).toBe(true);
    expect(all.scrape_runs!.some((row) => row.needed_repair)).toBe(true);
    expect(all.notifications!.some((row) => row.read_at === null)).toBe(true);
    expect(all.notifications!.some((row) => row.read_at !== null)).toBe(true);
    expect(all.contacts!.length).toBeGreaterThanOrEqual(14);
    expect(all.deals!.length).toBeGreaterThanOrEqual(12);
    expect(all.conversations!.length).toBeGreaterThanOrEqual(9);
  });
});

describe("demo fixtures: time", () => {
  it("is deterministic for a given moment and keeps its ids at any moment", () => {
    expect(buildDemoData(NOW).tables).toEqual(tables);
    const later = buildDemoData(new Date("2027-03-15T08:00:00.000Z")).tables as Record<string, AnyRow[]>;
    for (const [table, rows] of Object.entries(all)) {
      expect(
        later[table]!.map((row) => row.id ?? row.key),
        table,
      ).toEqual(rows.map((row) => row.id ?? row.key));
    }
  });

  it("never dates a past fact in the future", () => {
    for (const [table, rows] of Object.entries(all)) {
      for (const row of rows) {
        expect(new Date(row.created_at as string).getTime(), table).toBeLessThanOrEqual(NOW.getTime());
      }
    }
  });

  it("counts this month's usage in the current period", () => {
    for (const row of all.usage_counters!) expect(row.period).toBe("2026-10-01");
  });
});

describe("demo fixtures: read-only functions", () => {
  const client = createDemoClient(tables as DemoTables, rpc);
  it("quota_left answers from plan and counters", async () => {
    expect((await client.rpc("quota_left", { p_org: DEMO_ORG_ID, p_metric: "messages" })).data).toBe(790);
    expect((await client.rpc("quota_left", { p_org: DEMO_ORG_ID, p_metric: "ai_credits" })).data).toBe(1130);
  });
  it("exports answer with fixture data only", async () => {
    const contact = await client.rpc("export_contact", { p_contact: demoId(13, 1) });
    expect((contact.data as { contact: { full_name: string } }).contact.full_name).toBe("Marta Bellandi");
    expect((await client.rpc("export_organization", { p_org: DEMO_ORG_ID })).error).toBeNull();
  });
});
